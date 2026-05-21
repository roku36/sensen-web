// Pure deterministic reducer (cast-time model v2).
//
// One cast slot per player. Clicking a card immediately moves it from hand
// to the cast slot; after `cost` seconds elapse, the card's effect resolves,
// the card lands in the discard pile, and one new card is drawn to refill
// the hand. Damage / status / persistent powers are unchanged from v1 —
// only the interlock between "wanting to play" and "actually playing" is.

import {
  CardEffect,
  CardId,
  CardType,
  getCardDef,
} from "./cards";
import {
  cardFlag, INPUT_DRAW,
  INPUT_RESERVE_DRAW,
  INPUT_RESERVE_CARD_1, INPUT_RESERVE_CARD_2, INPUT_RESERVE_CARD_3,
  INPUT_RESERVE_CARD_4, INPUT_RESERVE_CARD_5, INPUT_RESERVE_CARD_6,
  INPUT_RESET_RESERVATIONS,
} from "./input";
import {
  BLOCK_HISTORY_SEC,
  DRAW_SEN_PER_CARD,
  DT,
  MAX_HAND_SIZE,
  PLAYED_TO_DISCARD,
  POISON_DECAY_SEN_PER_STEP,
  RESOLVED_HISTORY_MAX,
  SEC_PER_SEN,
  senToSec,
} from "./rules";
import { rangeU64 } from "./rng";
import type { GameState, PlayerState, QueueEntry } from "./state";

const enum DamageKind { Attack = 0, Power = 1, Thorns = 2 }

interface DamageMsg {
  target: 0 | 1; amount: number; source: 0 | 1 | null; kind: DamageKind; pierce?: number;
  // Effects applied ONLY IF some damage reached HP (Vuln/Weak/etc. that ride
  // along with an attack — if the hit was fully absorbed by block, they
  // don't apply). Filled by applyEffect when an Attack Combo is processed.
  onLand?: CardEffect[];
}
interface HealMsg { target: 0 | 1; amount: number }
interface DrawMsg { target: 0 | 1; count: number }
interface BlockMsg { target: 0 | 1; amount: number }
interface ThornsMsg { target: 0 | 1; amount: number }
interface PoisonMsg { target: 0 | 1; amount: number }
interface StrMsg { target: 0 | 1; amount: number }
interface VulnMsg { target: 0 | 1; duration: number }
interface WeakMsg { target: 0 | 1; duration: number }
interface AddStatusMsg { target: 0 | 1; cardId: CardId }

interface Bus {
  damage: DamageMsg[];
  heal: HealMsg[];
  draw: DrawMsg[];
  block: BlockMsg[];
  thorns: ThornsMsg[];
  poison: PoisonMsg[];
  strength: StrMsg[];
  vuln: VulnMsg[];
  weak: WeakMsg[];
  addStatus: AddStatusMsg[];
  cardPlayed: { player: 0 | 1; cardId: CardId; skipBlock: boolean }[];
  exhausted: { player: 0 | 1; cardId: CardId }[];
}

const newBus = (): Bus => ({
  damage: [], heal: [], draw: [], block: [], thorns: [], poison: [],
  strength: [], vuln: [], weak: [], addStatus: [],
  cardPlayed: [], exhausted: [],
});

const opp = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0);

// ── Time-based ticks: statuses, persistent powers, block decay ──

function tickStatus(p: PlayerState, dt: number) {
  if (p.vulnerableSecs > 0) p.vulnerableSecs = Math.max(0, p.vulnerableSecs - dt);
  if (p.weakSecs > 0) p.weakSecs = Math.max(0, p.weakSecs - dt);
  if (p.rage && p.rage.remaining > 0) p.rage.remaining = Math.max(0, p.rage.remaining - dt);
  if (p.demonForm) {
    p.demonForm.accumulated += p.demonForm.strengthPerSec * dt;
    if (p.demonForm.accumulated >= 1) {
      const gain = Math.floor(p.demonForm.accumulated);
      p.strength += gain;
      p.demonForm.accumulated -= gain;
    }
  }
}

function tickPowers(s: GameState, dt: number, bus: Bus) {
  for (const idx of [0, 1] as const) {
    const p = s.players[idx];
    if (p.metallicize && p.metallicize.blockPerSec > 0) {
      bus.block.push({ target: idx, amount: p.metallicize.blockPerSec * dt });
    }
    if (p.combust) {
      if (p.combust.selfPerSec > 0) {
        p.hp = Math.max(0, p.hp - p.combust.selfPerSec * dt);
      }
      if (p.combust.enemyPerSec > 0) {
        const o = s.players[opp(idx)];
        let rem = p.combust.enemyPerSec * dt;
        // Block is integer — only absorb whole units. Fractional remainder
        // bleeds into HP without flickering the block bar.
        const absorbedInt = Math.min(Math.floor(rem), o.block);
        if (absorbedInt > 0) {
          o.block -= absorbedInt;
          recordBlockChange(o, s.frame * DT);
        }
        rem -= absorbedInt;
        if (rem > 0) o.hp = Math.max(0, o.hp - rem);
      }
    }
    if (p.brutality) {
      if (p.brutality.selfPerSec > 0) {
        p.hp = Math.max(0, p.hp - p.brutality.selfPerSec * dt);
      }
      if (p.brutality.draw > 0 && p.brutality.interval > 0) {
        p.brutality.timer += dt;
        while (p.brutality.timer >= p.brutality.interval) {
          p.brutality.timer -= p.brutality.interval;
          drawCards(s, idx, p.brutality.draw, bus);
        }
      }
    }
  }
}

// Block decays in DISCRETE 1-unit steps, one tick per 閃. nextBlockDecayAt is
// the sim time at which the next decrement fires. When the block hits 0,
// the timer is paused (set to Infinity) until a gain re-arms it.
function tickBlockDecay(p: PlayerState, now: number) {
  if (p.barricade) return;
  while (p.block > 0 && now >= p.nextBlockDecayAt) {
    p.block -= 1;
    p.nextBlockDecayAt += SEC_PER_SEN;
    // Record at FRAME time (not the scheduled time) so all blockHistory
    // entries share a single grid — consistent left-shift per render
    // instead of timestamps drifting against the queue's own time axis.
    recordBlockChange(p, now);
  }
  if (p.block <= 0) p.nextBlockDecayAt = Infinity;
}

// Append (now, current block) to the per-player blockHistory ring. Used by
// the UI to draw the PAST portion of the block trajectory — without this,
// the past area would just be "flat at the current block value" and shift
// every time block changed (the bug we're fixing).
function recordBlockChange(p: PlayerState, now: number) {
  const last = p.blockHistory[p.blockHistory.length - 1];
  if (last && last.t === now) {
    // Same-frame change: overwrite, don't stack duplicates.
    last.block = p.block;
    return;
  }
  if (last && last.block === p.block) return; // no-op write
  p.blockHistory.push({ t: now, block: p.block });
  const cutoff = now - BLOCK_HISTORY_SEC;
  // Always keep at least one anchor entry that's <= cutoff (so the area
  // from cutoff-to-NOW can be drawn from a known starting block).
  while (p.blockHistory.length > 2 && p.blockHistory[1].t < cutoff) {
    p.blockHistory.shift();
  }
}

// Re-arm the block decay timer after a block change. Called from
// processBlockGains for gains and from processDamage when block is reduced
// but not zeroed.
function armBlockDecay(p: PlayerState, now: number) {
  if (p.block <= 0) { p.nextBlockDecayAt = Infinity; return; }
  if (!isFinite(p.nextBlockDecayAt) || p.nextBlockDecayAt <= now) {
    p.nextBlockDecayAt = now + SEC_PER_SEN;
  }
}

// Poison ticks once per 閃: deal (poison) HP damage IGNORING block,
// decrement poison by 1.
function tickPoison(p: PlayerState, now: number) {
  while (p.poison > 0 && now >= p.nextPoisonDecayAt) {
    p.hp = Math.max(0, p.hp - p.poison);
    p.poison -= 1;
    p.nextPoisonDecayAt += SEC_PER_SEN * POISON_DECAY_SEN_PER_STEP;
  }
  if (p.poison <= 0) p.nextPoisonDecayAt = Infinity;
}

function armPoisonDecay(p: PlayerState, now: number) {
  if (p.poison <= 0) { p.nextPoisonDecayAt = Infinity; return; }
  if (!isFinite(p.nextPoisonDecayAt) || p.nextPoisonDecayAt <= now) {
    p.nextPoisonDecayAt = now + SEC_PER_SEN * POISON_DECAY_SEN_PER_STEP;
  }
}

// ── Cast queue: resolve head when its duration elapses, advance start time ──

function tickCasting(s: GameState, now: number, bus: Bus) {
  for (const idx of [0, 1] as const) {
    const p = s.players[idx];
    while (p.queue.length > 0) {
      const entry = p.queue[0];
      // Mid-cast slot fills for an active draw entry: each second of the
      // cast lets the next reserved slot pop a card from the deck.
      if (entry.kind === "draw") {
        const elapsed = now - p.castStartedAt;
        // Each slot fills 1 閃 after the previous: slot k at (k+1)*SEC_PER_SEN.
        const targetFilled = Math.min(entry.drawSlots.length, Math.floor(elapsed / SEC_PER_SEN));
        while (entry.drawFilledCount < targetFilled) {
          const slot = entry.drawSlots[entry.drawFilledCount];
          const c = drawOneFromDeck(p);
          if (c === null) break; // deck + discard both empty
          // If the slot has been re-filled by a card-effect draw mid-wait,
          // drop the card into any other open slot, else discard.
          if (p.hand[slot] === null) {
            p.hand[slot] = c;
          } else {
            const alt = nextOpenSlot(p);
            if (alt >= 0) p.hand[alt] = c; else p.discard.push(c);
          }
          entry.drawFilledCount++;
          // Status-card triggers (Evolve / FireBreathing) still apply.
          const def = getCardDef(c);
          if (def && def.cardType === CardType.Status) {
            if (p.evolve && p.evolve.drawOnStatus > 0) drawCards(s, idx, p.evolve.drawOnStatus, bus);
            if (p.fireBreathing && p.fireBreathing.damageOnStatusDraw > 0) {
              bus.damage.push({
                target: opp(idx),
                amount: p.fireBreathing.damageOnStatusDraw,
                source: idx,
                kind: DamageKind.Power,
              });
            }
          }
        }
      }

      // Block-on-cast-start: if this card has Block effects and we haven't
      // applied them yet, do it NOW. (See applyBlockOnStart for the gather
      // logic.) Only attacks/utilities still wait until the cast finishes.
      if (entry.kind === "card" && !entry.blockApplied) {
        const def = getCardDef(entry.cardId);
        if (def) applyBlockOnStart(idx, def.effect, bus);
        entry.blockApplied = true;
      }

      // Has this entry's duration fully elapsed? If not, stop draining.
      if (now - p.castStartedAt < entry.duration) break;
      p.queue.shift();
      // Advance by exactly the consumed duration so carry-over time rolls
      // into the next entry.
      p.castStartedAt += entry.duration;

      if (entry.kind === "card") {
        // Stamp it as resolved for the UI history.
        p.resolvedCards.push({
          cardId: entry.cardId,
          duration: entry.duration,
          resolvedAt: p.castStartedAt,
        });
        if (p.resolvedCards.length > RESOLVED_HISTORY_MAX) {
          p.resolvedCards.splice(0, p.resolvedCards.length - RESOLVED_HISTORY_MAX);
        }
        const def = getCardDef(entry.cardId);
        if (!def) continue;

        let goToDiscard = PLAYED_TO_DISCARD;
        let countsAsExhaust = false;
        if (def.cardType === CardType.Power) { goToDiscard = false; }
        if (def.exhausts || def.effect.kind === "Exhaust") { goToDiscard = false; countsAsExhaust = true; }
        if (def.cardType === CardType.Skill && p.corruption) { goToDiscard = false; countsAsExhaust = true; }
        if (goToDiscard) p.discard.push(entry.cardId);

        // skipBlock: block already fired at cast start, don't apply again.
        bus.cardPlayed.push({ player: idx, cardId: entry.cardId, skipBlock: true });
        if (countsAsExhaust) bus.exhausted.push({ player: idx, cardId: entry.cardId });
      }
      // Draw entries leave no history mark — the slot fills themselves
      // make the action visible in the hand row.
    }
  }
}

// Walk an effect tree and emit only Block events onto the bus. Used at
// cast-start for card heads.
function applyBlockOnStart(idx: 0 | 1, effect: CardEffect, bus: Bus) {
  switch (effect.kind) {
    case "Block":
      bus.block.push({ target: idx, amount: effect.amount });
      break;
    case "Combo":
      for (const sub of effect.effects) applyBlockOnStart(idx, sub, bus);
      break;
    default:
      // non-block effect: skip at start, will fire at resolve
  }
}

// Per-frame draw timer: when sim time crosses nextDrawAt and the hand isn't
// full, draw 1 and re-arm with (handSize + 1) seconds. Hand size 6 → no draws
// (the timer is pushed forward to "now" so it doesn't bank). Card-effect
// draws (受け流し etc.) bypass this and just call drawCards directly.
// Apply a Draw action: snapshot every currently-empty non-reserved slot
// and APPEND a draw entry to the cast queue. Duration = N * DRAW_SEC_PER_CARD
// where N is the number of targets. Slots fill sequentially during the
// entry's cast (handled in tickCasting). No-op if no eligible slots OR if
// a draw is already queued (one Draw at a time per player).
function applyDrawAction(p: PlayerState, now: number): boolean {
  // Refuse if there's already a draw entry in the queue.
  for (const q of p.queue) if (q.kind === "draw") return false;
  const reserved = reservedSlotSet(p);
  const eligible: number[] = [];
  for (let i = 0; i < p.hand.length; i++) {
    if (p.hand[i] === null && !reserved.has(i)) eligible.push(i);
  }
  if (eligible.length === 0) return false;
  const duration = senToSec(eligible.length * DRAW_SEN_PER_CARD);
  if (p.queue.length === 0) p.castStartedAt = Math.max(p.castStartedAt, now);
  p.queue.push({
    kind: "draw",
    drawSlots: eligible,
    drawFilledCount: 0,
    duration,
  });
  return true;
}

// Set of slot indices currently reserved by a queued draw entry.
export function reservedSlotSet(p: PlayerState): Set<number> {
  const out = new Set<number>();
  for (const q of p.queue) {
    if (q.kind !== "draw") continue;
    // Skip slots already filled within this entry; only the not-yet-filled
    // tail is still "reserved".
    for (let k = q.drawFilledCount; k < q.drawSlots.length; k++) out.add(q.drawSlots[k]);
  }
  return out;
}

// ── Input handling: clicking a card adds it to the END of the queue ──
//
// You can keep clicking to queue more cards (committing to a multi-cast
// plan). The opponent sees your queue too — that's the whole point of the
// mechanic: visible commitment they can read and respond to.

// Actual remaining cast time (in seconds) for everything currently in the
// queue. Head's remaining = duration - (now - castStartedAt); tail entries
// contribute their full duration. Used to gate prereqQueueTime cards: a
// finisher with prereq=6 needs at least 6 sec of pending work in the queue
// at the moment of attempted play.
export function queueRemainingTime(p: PlayerState, now: number): number {
  if (p.queue.length === 0) return 0;
  let total = Math.max(0, p.queue[0].duration - (now - p.castStartedAt));
  for (let i = 1; i < p.queue.length; i++) total += p.queue[i].duration;
  return total;
}

/** @deprecated retained for source compat; same as queueRemainingTime. */
export function queueTotalCost(p: PlayerState, now: number = 0): number {
  return queueRemainingTime(p, now);
}

// Try to queue the card in hand[slotIndex] immediately. Returns true on
// success. Returns false if the slot is empty, the card is unplayable, or
// the prereq isn't currently satisfied.
function queueCardImmediate(p: PlayerState, slotIndex: number, now: number, bus: Bus): boolean {
  const cardId = p.hand[slotIndex];
  if (cardId === null || cardId === undefined) return false;
  const def = getCardDef(cardId);
  if (!def) return false;
  if (def.cost >= 900) return false;
  const prereq = senToSec(def.prereqQueueTime ?? 0);
  if (prereq > 0 && queueRemainingTime(p, now) < prereq) return false;
  let duration = senToSec(def.cost);
  if (p.corruption && def.cardType === CardType.Skill) duration = 0;
  p.hand[slotIndex] = null;
  const wasEmpty = p.queue.length === 0;
  if (wasEmpty) p.castStartedAt = Math.max(p.castStartedAt, now);
  const entry: QueueEntry = { kind: "card", cardId, duration, blockApplied: false };
  p.queue.push(entry);
  // Block-on-cast-start: if THIS card is now the head (queue was empty
  // before push), apply its Block effects immediately.
  if (wasEmpty) {
    applyBlockOnStart(p.handle as 0 | 1, def.effect, bus);
    entry.blockApplied = true;
  }
  return true;
}

const RESERVE_FLAGS = [
  INPUT_RESERVE_CARD_1, INPUT_RESERVE_CARD_2, INPUT_RESERVE_CARD_3,
  INPUT_RESERVE_CARD_4, INPUT_RESERVE_CARD_5, INPUT_RESERVE_CARD_6,
];

// Cumulative cast time committed to the future (queue remaining + sum of
// the reservation list's durations). Used to gate heavy-card reservations.
function committedTime(p: PlayerState, now: number): number {
  let total = queueRemainingTime(p, now);
  for (const r of p.reservations) {
    if (r.kind === "card") {
      const c = p.hand[r.slotIndex];
      if (c === null || c === undefined) continue;
      const d = getCardDef(c);
      if (!d) continue;
      total += senToSec(d.cost);
    } else {
      // Draw entry: pessimistic — count current empties (slots may shift
      // by fire time but this is just a UI gate, sim re-checks at fire).
      let n = 0;
      for (const c of p.hand) if (c === null) n++;
      total += senToSec(n * DRAW_SEN_PER_CARD);
    }
  }
  return total;
}

// LEFT-click on a card: append a card reservation. Heavy cards check the
// cumulative committed time against the prereq.
function appendCardReservation(p: PlayerState, slotIndex: number, now: number): boolean {
  // Already reserved? No-op (left-click on already-reserved card does nothing;
  // right-click is the way to cascade-release).
  for (const r of p.reservations) {
    if (r.kind === "card" && r.slotIndex === slotIndex) return false;
  }
  const cardId = p.hand[slotIndex];
  if (cardId === null || cardId === undefined) return false;
  const def = getCardDef(cardId);
  if (!def || def.cost >= 900) return false;
  const prereqSec = senToSec(def.prereqQueueTime ?? 0);
  if (prereqSec > 0 && committedTime(p, now) < prereqSec) return false;
  p.reservations.push({ kind: "card", slotIndex });
  return true;
}

// LEFT-click on the Draw button: append a draw reservation.
function appendDrawReservation(p: PlayerState): boolean {
  // No-op if there's already a trailing draw reservation (avoids spam).
  const last = p.reservations[p.reservations.length - 1];
  if (last && last.kind === "draw") return false;
  p.reservations.push({ kind: "draw" });
  return true;
}

// RIGHT-click on a card: cascade-release from that slot's reservation
// onward (entries AFTER it in the list are also dropped).
function cascadeReleaseCard(p: PlayerState, slotIndex: number) {
  const idx = p.reservations.findIndex(
    (r) => r.kind === "card" && r.slotIndex === slotIndex,
  );
  if (idx >= 0) p.reservations.length = idx;
}

function applyInput(s: GameState, idx: 0 | 1, flags: number, _bus: Bus) {
  void _bus;
  if (flags === 0) return;
  const p = s.players[idx];
  const now = s.frame * DT;
  let opened = false;

  // Space key OR right-click on Draw → clear all manual reservations.
  if ((flags & INPUT_RESET_RESERVATIONS) !== 0 || (flags & INPUT_RESERVE_DRAW) !== 0) {
    p.reservations.length = 0;
    opened = true;
  }

  // Right-click on a card → cascade-release.
  for (let i = 0; i < 6; i++) {
    if ((flags & RESERVE_FLAGS[i]) !== 0) {
      cascadeReleaseCard(p, i);
      opened = true;
    }
  }

  // Left-click on Draw button → append draw reservation.
  if ((flags & INPUT_DRAW) !== 0) {
    if (appendDrawReservation(p)) opened = true;
  }

  // Left-click on a card → append card reservation (first match only).
  for (let i = 0; i < MAX_HAND_SIZE; i++) {
    const flag = cardFlag(i);
    if (flag === null) continue;
    if ((flags & flag) === 0) continue;
    if (appendCardReservation(p, i, now)) opened = true;
    break;
  }

  if (opened && p.openedAt === null) p.openedAt = now;
}

// Auto-fire reservations. Walks the manual list head-first; fires when the
// head's trigger condition is met (queue empty for non-prereq, queue
// remaining == prereq for prereq cards). Falls back to "default" (Draw or
// leftmost playable) only when the manual list is EMPTY.
function tickReservation(s: GameState, now: number, bus: Bus) {
  for (const idx of [0, 1] as const) {
    const p = s.players[idx];
    // Loop: a fire may make the next reservation eligible (cascade through
    // same-frame fires). Bounded for safety.
    for (let safety = 0; safety < 8; safety++) {
      if (!tickReservationOnce(p, now, bus)) break;
    }
  }
}

function tickReservationOnce(p: PlayerState, now: number, bus: Bus): boolean {
  if (p.reservations.length > 0) {
    const head = p.reservations[0];
    if (head.kind === "card") {
      const cardId = p.hand[head.slotIndex];
      if (cardId === null || cardId === undefined) {
        // Slot was emptied somehow; drop this reservation and try the next.
        p.reservations.shift();
        return true;
      }
      const def = getCardDef(cardId);
      if (!def || def.cost >= 900) {
        p.reservations.shift();
        return true;
      }
      const prereqSec = senToSec(def.prereqQueueTime ?? 0);
      if (prereqSec > 0) {
        const remaining = queueRemainingTime(p, now);
        if (remaining <= prereqSec + DT / 2 && remaining >= prereqSec - DT / 2) {
          if (queueCardImmediate(p, head.slotIndex, now, bus)) {
            p.reservations.shift();
            return true;
          }
        }
        return false;
      }
      // Non-prereq: fire when queue empty.
      if (p.queue.length === 0) {
        if (queueCardImmediate(p, head.slotIndex, now, bus)) {
          p.reservations.shift();
          return true;
        }
      }
      return false;
    }
    // head.kind === "draw"
    if (p.queue.length !== 0) return false;
    if (applyDrawAction(p, now)) {
      p.reservations.shift();
      return true;
    }
    // Couldn't draw (no empty slots) — drop and try the next reservation.
    p.reservations.shift();
    return true;
  }
  // Default forced reservation: Draw if there's space, else leftmost playable.
  if (p.queue.length !== 0) return false;
  if (hasEmptyOpenSlot(p)) {
    applyDrawAction(p, now);
    return true;
  }
  const slot = leftmostPlayableSlot(p, now);
  if (slot >= 0) return queueCardImmediate(p, slot, now, bus);
  return false;
}

function hasEmptyOpenSlot(p: PlayerState): boolean {
  const reserved = reservedSlotSet(p);
  for (let i = 0; i < p.hand.length; i++) {
    if (p.hand[i] === null && !reserved.has(i)) return true;
  }
  return false;
}

function leftmostPlayableSlot(p: PlayerState, now: number): number {
  for (let i = 0; i < p.hand.length; i++) {
    const c = p.hand[i];
    if (c === null || c === undefined) continue;
    const def = getCardDef(c);
    if (!def || def.cost >= 900) continue;
    const prereq = senToSec(def.prereqQueueTime ?? 0);
    if (prereq > 0 && queueRemainingTime(p, now) < prereq) continue;
    return i;
  }
  return -1;
}

// Lose condition: hand is full of UNPLAYABLE cards (no empties, no slot
// holds a card that could ever be played given current state). When this
// happens we forfeit the match for that player.
function isStuck(p: PlayerState): boolean {
  if (p.queue.length > 0) return false; // queue still resolving
  for (let i = 0; i < p.hand.length; i++) {
    const c = p.hand[i];
    if (c === null) return false; // empty slot → can Draw
    const def = getCardDef(c);
    if (!def) continue;
    if (def.cost < 900) return false; // a playable card exists
  }
  return true;
}

// ── Deck / hand / discard ──

// Initial deal: fill empty slots starting from index 0. Used by initGame to
// seed the opening hand (and only there — runtime fills go through the Draw
// action / drawCards card effect).
export function dealCards(p: PlayerState, count: number) {
  for (let n = 0; n < count; n++) {
    const slot = nextOpenSlot(p);
    if (slot < 0) break;
    if (p.deck.length === 0 && p.discard.length > 0) reshuffleDiscardIntoDeck(p);
    const c = drawOneFromDeck(p);
    if (c === null) break;
    p.hand[slot] = c;
  }
}

function shuffleDeck(p: PlayerState) {
  if (p.deck.length < 2) return;
  for (let i = p.deck.length - 1; i >= 1; i--) {
    const j = Number(rangeU64(p.rng, BigInt(i + 1)));
    const tmp = p.deck[i]; p.deck[i] = p.deck[j]; p.deck[j] = tmp;
  }
}

function reshuffleDiscardIntoDeck(p: PlayerState) {
  if (p.discard.length === 0) return;
  p.deck.push(...p.discard);
  p.discard.length = 0;
  shuffleDeck(p);
}

function drawOneFromDeck(p: PlayerState): CardId | null {
  if (p.deck.length === 0 && p.discard.length > 0) reshuffleDiscardIntoDeck(p);
  if (p.deck.length === 0) return null;
  const idx = Number(rangeU64(p.rng, BigInt(p.deck.length)));
  const last = p.deck.length - 1;
  const out = p.deck[idx];
  p.deck[idx] = p.deck[last];
  p.deck.pop();
  return out;
}

// Lowest empty slot not reserved by an active draw entry. Returns -1 if full.
function nextOpenSlot(p: PlayerState): number {
  const reserved = reservedSlotSet(p);
  for (let i = 0; i < p.hand.length; i++) {
    if (p.hand[i] === null && !reserved.has(i)) return i;
  }
  return -1;
}

// Card-effect draws (受け流し etc.). These bypass the Draw action's per-card
// cost — they're earned by an effect, so they fill instantly. They go into
// non-reserved empty slots, NEVER stealing a pendingDraw target.
function drawCards(s: GameState, idx: 0 | 1, count: number, bus: Bus) {
  const p = s.players[idx];
  let remaining = count;
  while (remaining > 0) {
    const slot = nextOpenSlot(p);
    if (slot < 0) break;
    remaining--;
    const c = drawOneFromDeck(p);
    if (c === null) break;
    p.hand[slot] = c;

    const def = getCardDef(c);
    if (def && def.cardType === CardType.Status) {
      if (p.evolve && p.evolve.drawOnStatus > 0) remaining += p.evolve.drawOnStatus;
      if (p.fireBreathing && p.fireBreathing.damageOnStatusDraw > 0) {
        bus.damage.push({
          target: opp(idx),
          amount: p.fireBreathing.damageOnStatusDraw,
          source: idx,
          kind: DamageKind.Power,
        });
      }
    }
  }
}

// ── Card effect resolution ──

// Returns INTEGER damage. Multipliers (weak / vulnerable) are applied to
// the DEFENDER (target takes more) and rounded so block absorbs whole
// integer units.
//   - Weak on defender:        damage ×2
//   - Vulnerable on defender:  damage ×1.5
function attackDamage(base: number, attacker: PlayerState, defender: PlayerState | null): number {
  let dmg = base + attacker.strength;
  if (defender && defender.weakSecs > 0) dmg *= 2;
  if (defender && defender.vulnerableSecs > 0) dmg *= 1.5;
  return Math.max(0, Math.round(dmg));
}

function applyEffect(
  s: GameState,
  idx: 0 | 1,
  effect: CardEffect,
  bus: Bus,
  /** When true, skip Block effects — they've already fired at cast start. */
  skipBlock = false,
) {
  const p = s.players[idx];
  const o = s.players[opp(idx)];
  switch (effect.kind) {
    case "Damage":
      bus.damage.push({ target: opp(idx), amount: attackDamage(effect.amount, p, o), source: idx, kind: DamageKind.Attack, pierce: effect.pierceBlock ?? 0 });
      break;
    case "MultiHit": {
      const each = attackDamage(effect.damage, p, o);
      for (let i = 0; i < effect.hits; i++) {
        bus.damage.push({ target: opp(idx), amount: each, source: idx, kind: DamageKind.Attack, pierce: effect.pierceBlock ?? 0 });
      }
      break;
    }
    case "Heal":
      bus.heal.push({ target: idx, amount: effect.amount });
      break;
    case "Draw":
      bus.draw.push({ target: idx, count: effect.count });
      break;
    case "Block":
      if (!skipBlock) bus.block.push({ target: idx, amount: effect.amount });
      break;
    case "Poison":
      bus.poison.push({ target: opp(idx), amount: effect.amount });
      break;
    case "Counter":
      // Pure marker effect — actual reflection is detected by inspecting
      // the queue head in processDamage. Nothing to do at resolve.
      break;
    case "Thorns":
      bus.thorns.push({ target: idx, amount: effect.amount });
      break;
    case "Strength":
      bus.strength.push({ target: idx, amount: effect.amount });
      break;
    case "Vulnerable":
      bus.vuln.push({ target: opp(idx), duration: effect.duration });
      break;
    case "SelfVulnerable":
      bus.vuln.push({ target: idx, duration: effect.duration });
      break;
    case "Weak":
      bus.weak.push({ target: opp(idx), duration: effect.duration });
      break;
    case "Accelerate":
      // No-op in cast-time model. The old meaning (cost regen boost) doesn't
      // map cleanly here. Cards that had this effect (Bloodletting/SeeingRed
      // /Offering/Dropkick/Berserk) are weaker than intended for now; will
      // redesign as e.g. "next cast is N× faster" in a follow-up.
      break;
    case "BodySlam":
      bus.damage.push({ target: opp(idx), amount: attackDamage(p.block, p, o), source: idx, kind: DamageKind.Attack });
      break;
    case "Bloodletting":
      if (effect.amount < 0) {
        bus.damage.push({ target: idx, amount: -effect.amount, source: idx, kind: DamageKind.Power });
      } else {
        bus.heal.push({ target: idx, amount: effect.amount });
      }
      break;
    case "DoubleBlock":
      bus.block.push({ target: idx, amount: p.block });
      break;
    case "DoubleStrength":
      bus.strength.push({ target: idx, amount: p.strength });
      break;
    case "Rage":
      p.rage = { blockPerAttack: effect.blockPerAttack, remaining: 10 };
      break;
    case "Metallicize":
      p.metallicize = { blockPerSec: effect.blockPerSecond };
      break;
    case "Combust":
      p.combust = { selfPerSec: effect.selfDmgPerSec, enemyPerSec: effect.enemyDmgPerSec };
      break;
    case "DemonForm":
      p.demonForm = { strengthPerSec: effect.strengthPerSecond, accumulated: 0 };
      break;
    case "Barricade":
      p.barricade = true;
      break;
    case "Juggernaut":
      p.juggernaut = { damageOnBlock: effect.damageOnBlock };
      break;
    case "DarkEmbrace":
      p.darkEmbrace = { drawOnExhaust: effect.draw };
      break;
    case "Evolve":
      p.evolve = { drawOnStatus: effect.draw };
      break;
    case "FeelNoPain":
      p.feelNoPain = { blockOnExhaust: effect.block };
      break;
    case "FireBreathing":
      p.fireBreathing = { damageOnStatusDraw: effect.damage };
      break;
    case "Rupture":
      p.rupture = { strengthOnSelfDmg: effect.strength };
      break;
    case "Corruption":
      p.corruption = true;
      break;
    case "Brutality":
      p.brutality = { selfPerSec: effect.selfDmgPerSec, draw: effect.draw, interval: effect.drawInterval, timer: 0 };
      break;
    case "Exhaust":
      // Card vanishes (handled by disposition logic in tickCasting).
      break;
    case "AddStatus":
      bus.addStatus.push({ target: idx, cardId: effect.cardId });
      break;
    case "Combo": {
      // No-debuff-on-blocked: if the combo contains attack damage AND
      // conditional debuffs (Vuln/Weak/Poison/AddStatus), the debuffs
      // ride along the FIRST damage message as `onLand` — they only
      // apply if some damage reached HP. Non-attack sub-effects (Block,
      // Heal, Draw, etc.) fire unconditionally.
      const isDamaging = (e: CardEffect) =>
        e.kind === "Damage" || e.kind === "MultiHit" || e.kind === "BodySlam";
      const isCondDebuff = (e: CardEffect) =>
        e.kind === "Vulnerable" || e.kind === "Weak" ||
        e.kind === "Poison" || e.kind === "AddStatus";
      const hasAttack = effect.effects.some(isDamaging);
      if (hasAttack) {
        const conditionals: CardEffect[] = [];
        const damageStart = bus.damage.length;
        for (const sub of effect.effects) {
          if (isCondDebuff(sub)) conditionals.push(sub);
          else applyEffect(s, idx, sub, bus, skipBlock);
        }
        if (conditionals.length > 0 && bus.damage.length > damageStart) {
          // Attach to the FIRST damage message produced by this combo.
          const dm = bus.damage[damageStart];
          dm.onLand = (dm.onLand ?? []).concat(conditionals);
        }
      } else {
        for (const sub of effect.effects) applyEffect(s, idx, sub, bus, skipBlock);
      }
      break;
    }
  }
}

function processCardPlayed(s: GameState, bus: Bus) {
  while (bus.cardPlayed.length > 0 || bus.exhausted.length > 0) {
    const played = bus.cardPlayed.splice(0, bus.cardPlayed.length);
    const exhausted = bus.exhausted.splice(0, bus.exhausted.length);

    for (const ev of played) {
      const def = getCardDef(ev.cardId);
      if (!def) continue;
      applyEffect(s, ev.player, def.effect, bus, ev.skipBlock);
      if (def.cardType === CardType.Attack) {
        const p = s.players[ev.player];
        if (p.rage && p.rage.remaining > 0) {
          bus.block.push({ target: ev.player, amount: p.rage.blockPerAttack });
        }
      }
    }
    for (const ev of exhausted) {
      const p = s.players[ev.player];
      if (p.darkEmbrace && p.darkEmbrace.drawOnExhaust > 0) {
        bus.draw.push({ target: ev.player, count: p.darkEmbrace.drawOnExhaust });
      }
      if (p.feelNoPain && p.feelNoPain.blockOnExhaust > 0) {
        bus.block.push({ target: ev.player, amount: p.feelNoPain.blockOnExhaust });
      }
    }
  }
}

function processBlockGains(s: GameState, bus: Bus) {
  const now = s.frame * DT;
  while (bus.block.length > 0) {
    const m = bus.block.shift()!;
    const p = s.players[m.target];
    const before = p.block;
    p.block = Math.max(0, Math.round(p.block + m.amount));
    if (p.block !== before) recordBlockChange(p, now);
    if (p.juggernaut) {
      bus.damage.push({
        target: opp(m.target),
        amount: p.juggernaut.damageOnBlock,
        source: m.target,
        kind: DamageKind.Power,
      });
    }
  }
  while (bus.thorns.length > 0) {
    const m = bus.thorns.shift()!;
    s.players[m.target].thorns = Math.max(0, s.players[m.target].thorns + m.amount);
  }
}

function processDamage(s: GameState, bus: Bus) {
  const now = s.frame * DT;
  while (bus.damage.length > 0) {
    const m = bus.damage.shift()!;
    const target = s.players[m.target];
    const total = Math.max(0, m.amount);
    const pierce = Math.max(0, Math.min(1, m.pierce ?? 0));
    const directHp = total * pierce;
    let blockable = total * (1 - pierce);
    const absorbed = Math.min(blockable, target.block);
    const beforeBlock = target.block;
    target.block = Math.max(0, Math.round(target.block - absorbed));
    if (target.block !== beforeBlock) recordBlockChange(target, now);
    blockable -= absorbed;
    const remaining = blockable + directHp;
    if (remaining > 0) target.hp = Math.max(0, target.hp - remaining);

    // No-debuff-on-blocked: ride-along effects (Vuln/Weak/Poison/AddStatus
    // attached to an attack combo) fire ONLY if some damage actually
    // reached HP. Fully-absorbed hits leave the target unaffected.
    if (m.onLand && m.onLand.length > 0 && remaining > 0 && m.source !== null) {
      for (const onLand of m.onLand) applyEffect(s, m.source, onLand, bus);
    }

    // Thorns reflection (attacker took an attack → take thorns damage back).
    if (m.kind === DamageKind.Attack && m.source !== null && m.source !== m.target && target.thorns > 0 && m.amount > 0) {
      bus.damage.push({
        target: m.source,
        amount: target.thorns,
        source: m.target,
        kind: DamageKind.Thorns,
      });
    }
    // Counter card: if defender's queue head is a Counter card AND this was
    // an attack from a separate source, reflect 2× back to attacker. The
    // amount reflected is the ORIGINAL damage value (before block).
    if (m.kind === DamageKind.Attack && m.source !== null && m.source !== m.target && m.amount > 0
        && target.queue.length > 0 && target.queue[0].kind === "card") {
      const headDef = getCardDef(target.queue[0].cardId);
      if (headDef && hasCounterEffect(headDef.effect)) {
        bus.damage.push({
          target: m.source,
          amount: m.amount * 2,
          source: m.target,
          kind: DamageKind.Power,
        });
      }
    }
    if (m.kind === DamageKind.Power && m.source === m.target && m.amount > 0 && target.rupture) {
      target.strength += target.rupture.strengthOnSelfDmg;
    }
  }
}

function hasCounterEffect(e: CardEffect): boolean {
  if (e.kind === "Counter") return true;
  if (e.kind === "Combo") return e.effects.some(hasCounterEffect);
  return false;
}

function processPoison(s: GameState, bus: Bus) {
  const now = s.frame * DT;
  while (bus.poison.length > 0) {
    const m = bus.poison.shift()!;
    const t = s.players[m.target];
    t.poison = Math.max(0, t.poison + m.amount);
    armPoisonDecay(t, now);
  }
}

function processHeal(s: GameState, bus: Bus) {
  while (bus.heal.length > 0) {
    const m = bus.heal.shift()!;
    const p = s.players[m.target];
    p.hp = Math.min(p.hpMax, p.hp + m.amount);
    // Heal also cures poison (up to amount stacks). User spec:
    // 「治療系のカードによってなくすことができる」.
    if (p.poison > 0 && m.amount > 0) {
      p.poison = Math.max(0, p.poison - m.amount);
      if (p.poison <= 0) p.nextPoisonDecayAt = Infinity;
    }
  }
}

function processStatusBus(s: GameState, bus: Bus) {
  while (bus.strength.length > 0) {
    const m = bus.strength.shift()!;
    s.players[m.target].strength += m.amount;
  }
  while (bus.vuln.length > 0) {
    const m = bus.vuln.shift()!;
    s.players[m.target].vulnerableSecs = Math.max(0, s.players[m.target].vulnerableSecs + m.duration);
  }
  while (bus.weak.length > 0) {
    const m = bus.weak.shift()!;
    s.players[m.target].weakSecs = Math.max(0, s.players[m.target].weakSecs + m.duration);
  }
  while (bus.addStatus.length > 0) {
    const m = bus.addStatus.shift()!;
    s.players[m.target].discard.push(m.cardId);
  }
}

function processDraw(s: GameState, bus: Bus) {
  while (bus.draw.length > 0) {
    const m = bus.draw.shift()!;
    drawCards(s, m.target, m.count, bus);
  }
}

// ── The frame step. Mutates `s` in place. ──

export function step(s: GameState, p0Input: number, p1Input: number, dt: number = DT): GameState {
  if (s.result !== 0) {
    s.frame++;
    return s;
  }
  const now = s.frame * DT;
  const bus = newBus();

  // 1. Time-based ticks.
  for (const p of s.players) tickStatus(p, dt);
  tickPowers(s, dt, bus);
  for (const p of s.players) tickBlockDecay(p, now);
  for (const p of s.players) tickPoison(p, now);

  // 2. Cast slots: card casts resolve, draw-entry slots fill sequentially.
  tickCasting(s, now, bus);

  // 3. Inputs: explicit plays / reservations (mutate p.reservations etc.).
  applyInput(s, 0, p0Input, bus);
  applyInput(s, 1, p1Input, bus);

  // 4. Reservation auto-fire: walk each player's manual reservation list
  // head-first, OR fall back to forced default (Draw / leftmost playable).
  tickReservation(s, now, bus);

  // 5. Drain effect / draw / damage chains until quiescent.
  let safety = 0;
  while (
    bus.cardPlayed.length || bus.exhausted.length ||
    bus.draw.length || bus.damage.length || bus.heal.length ||
    bus.block.length || bus.thorns.length || bus.poison.length ||
    bus.strength.length || bus.vuln.length || bus.weak.length || bus.addStatus.length
  ) {
    if (++safety > 256) break;
    processCardPlayed(s, bus);
    processStatusBus(s, bus);
    processBlockGains(s, bus);
    processDamage(s, bus);
    processHeal(s, bus);
    processPoison(s, bus);
    processDraw(s, bus);
  }
  // Re-arm block decay for both players (idempotent if block unchanged).
  for (const p of s.players) armBlockDecay(p, now);
  for (const p of s.players) armPoisonDecay(p, now);

  // 6. Game over? HP zero OR hand stuck with no playable card and no empties.
  const p0Stuck = isStuck(s.players[0]);
  const p1Stuck = isStuck(s.players[1]);
  if (p0Stuck && p1Stuck) s.result = 3;
  else if (p0Stuck) s.result = 2;
  else if (p1Stuck) s.result = 1;
  else if (s.players[0].hp <= 0 && s.players[1].hp <= 0) s.result = 3;
  else if (s.players[0].hp <= 0) s.result = 2;
  else if (s.players[1].hp <= 0) s.result = 1;

  s.frame++;
  return s;
}
