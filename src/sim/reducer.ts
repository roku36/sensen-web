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
  FRAMES_PER_SEN,
  MAX_HAND_SIZE,
  PLAYED_TO_DISCARD,
  POISON_DECAY_SEN_PER_STEP,
  RENZAN_MAX_BONUS,
  RESOLVED_HISTORY_MAX,
  RETSU_SEN_BONUS,
  SEC_PER_SEN,
  senToSec,
  SUDDEN_DEATH_RAMP_SEN,
  SUDDEN_DEATH_START_SEN,
} from "./rules";
import { rangeU64 } from "./rng";
import { isSurgeSen } from "./events";
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

// 熟成 tick: cards with matureInto transform after sitting in hand for
// matureSen 閃. Age tracking is centralized HERE — handAgeCard remembers
// which card each count refers to, so any slot change (play, draw fill,
// effect draw) resets the age implicitly on the next frame instead of
// every hand-write site needing to know about aging.
//
// RESERVED slots are FROZEN: a reserved card is committed to the plan,
// and reservations never fail (game law) — so a reserved bloom must not
// rot out from under its own reservation. Flip side: reserving a dying
// card deliberately stops its clock, at the price of commitment.
function tickMaturing(p: PlayerState) {
  let reservedSlots: Set<number> | null = null;
  for (const r of p.reservations) {
    if (r.kind !== "card") continue;
    if (reservedSlots === null) reservedSlots = new Set();
    reservedSlots.add(r.slotIndex);
  }
  for (let i = 0; i < p.hand.length; i++) {
    const c = p.hand[i];
    if (c === null || p.handAgeCard[i] !== c) {
      p.handAgeCard[i] = c;
      p.handAge[i] = 0;
      continue;
    }
    if (reservedSlots !== null && reservedSlots.has(i)) continue; // frozen
    p.handAge[i]++;
    const def = getCardDef(c);
    if (def?.matureInto !== undefined && (def.matureSen ?? 0) > 0
        && p.handAge[i] >= (def.matureSen ?? 0) * FRAMES_PER_SEN) {
      p.hand[i] = def.matureInto;
      p.handAgeCard[i] = def.matureInto;
      p.handAge[i] = 0;
    }
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
        // 連閃: one more card resolved without a draw in between. The
        // count INCLUDES this card; its own damage (processed later this
        // frame) gets +（renzan−1）, so the first card of a chain is flat.
        p.renzan += 1;
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
      if (entry.kind === "draw") {
        // 連閃 reset: a Draw resolving breaks the card chain. Refill costs
        // momentum, not just the draw's cast time.
        p.renzan = 0;
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

// How many empty slots a Draw at position `drawResIdx` in the reservation
// list will see when it fires. Walks the reservations in order: each
// preceding CARD reservation will free its slot (count it as future-empty);
// each preceding DRAW reservation will CONSUME the currently-empty slots
// (clear them). Used by the Draw button + ghost preview so a draw planned
// after 3 card reservations is shown as a 3-card draw, not 0.
//
// drawResIdx === reservations.length means "if I appended a draw RIGHT
// NOW, how many slots would it draw into?" — used by the Draw button.
export function futureEmptyAtDrawPosition(p: PlayerState, drawResIdx: number): number {
  const empties = new Set<number>();
  const queueDrawReserved = reservedSlotSet(p);
  for (let i = 0; i < p.hand.length; i++) {
    if (p.hand[i] === null && !queueDrawReserved.has(i)) empties.add(i);
  }
  for (let i = 0; i < drawResIdx && i < p.reservations.length; i++) {
    const r = p.reservations[i];
    if (r.kind === "card") {
      empties.add(r.slotIndex); // becomes empty when this card fires
    } else {
      empties.clear(); // an earlier draw will consume all currently-empty slots
    }
  }
  return empties.size;
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

// ── Exact-timing helpers (integer frames; 1閃 = FRAMES_PER_SEN frames) ──
// Card costs / prereqs are authored in WHOLE 閃, and the sim's true integer
// clock is the FRAME. Durations and castStartedAt are all frame-aligned
// seconds, so dividing by DT and rounding recovers exact integers — no FP
// drift, no DT/2 tolerance hacks, and no ceil-to-閃 inflation (a head with
// 5.0s left is 300 frames, NOT "2閃": ceil'ing made the gate accept heavies
// that could never get their full prereq, so they confirmed instantly with
// a short chain instead of exactly prereq閃 before their cast).

/** Remaining cast chain in FRAMES. Decrements by exactly 1 per frame. */
export function queueRemainingFrames(p: PlayerState, now: number): number {
  if (p.queue.length === 0) return 0;
  let total = 0;
  for (const q of p.queue) total += Math.round(q.duration / DT);
  const elapsed = Math.max(0, Math.round((now - p.castStartedAt) / DT));
  return Math.max(0, total - elapsed);
}

/**
 * Total cast cost (in WHOLE 閃) of reservations[0..endIdx). Draw entries
 * are sized with futureEmptyAtDrawPosition — the same slot-walk that
 * applyDrawAction performs at fire time — so the gate, the scheduler and
 * the actual fire all agree even when preceding card reservations free up
 * slots before a draw fires. (Counting "currently empty slots" here was a
 * bug: it shifted the heavy's atomic-fire moment whenever a draw sat in
 * the setup chain.)
 */
export function reservationSetupSen(p: PlayerState, endIdx: number): number {
  let total = 0;
  for (let i = 0; i < endIdx && i < p.reservations.length; i++) {
    const r = p.reservations[i];
    if (r.kind === "card") {
      const c = p.hand[r.slotIndex];
      const d = c !== null && c !== undefined ? getCardDef(c) : null;
      if (d) total += d.cost;
    } else {
      total += futureEmptyAtDrawPosition(p, i) * DRAW_SEN_PER_CARD;
    }
  }
  return total;
}

/**
 * Feasibility gate for appending hand[slotIndex] as a NEW reservation.
 * Single source of truth shared by the sim (toggleCardReservation), the
 * AI policy and the UI's clickable check — a click the UI allows is never
 * silently dropped by the sim, and vice versa.
 *
 * Heavy cards (prereqQueueTime > 0):
 *   - as the FIRST reservation they fire against the live queue chain
 *     (mechanism 1), so the chain must REALLY have ≥ prereq remaining;
 *   - behind other reservations their chain at fire time is exactly the
 *     setup built from those reservations (mechanism 2).
 */
export function canReserveCard(p: PlayerState, slotIndex: number, now: number): boolean {
  const cardId = p.hand[slotIndex];
  if (cardId === null || cardId === undefined) return false;
  const def = getCardDef(cardId);
  if (!def || def.cost >= 900) return false;
  const prereqSen = def.prereqQueueTime ?? 0;
  if (prereqSen === 0) return true;
  if (p.reservations.length === 0) {
    return queueRemainingFrames(p, now) >= prereqSen * FRAMES_PER_SEN;
  }
  return reservationSetupSen(p, p.reservations.length) >= prereqSen;
}

// Move the card in hand[slotIndex] into the cast queue NOW. Returns false
// only if the slot is empty/unplayable. Prereq timing is NOT re-checked
// here: the reservation gate (canReserveCard) decides feasibility at click
// time and the scheduler (tickReservationOnce) decides the exact fire
// frame — once they say fire, the fire must succeed, or an accepted
// reservation could strand forever (spec: reservations never fail).
function queueCardImmediate(p: PlayerState, slotIndex: number, now: number, bus: Bus): boolean {
  const cardId = p.hand[slotIndex];
  if (cardId === null || cardId === undefined) return false;
  const def = getCardDef(cardId);
  if (!def) return false;
  if (def.cost >= 900) return false;
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

// LEFT-click on a card: TOGGLE its reservation. If already reserved,
// cascade-release from that position (drop later entries too). Otherwise
// append, with the heavy-card cumulative committed-time gate. This makes
// cancellation discoverable through the same click the user already uses
// to reserve, without needing right-click (which can be hijacked by the
// browser's native context menu, page extensions, etc).
function toggleCardReservation(p: PlayerState, slotIndex: number, now: number): boolean {
  const existing = p.reservations.findIndex(
    (r) => r.kind === "card" && r.slotIndex === slotIndex,
  );
  if (existing >= 0) {
    p.reservations.length = existing;
    return true;
  }
  if (!canReserveCard(p, slotIndex, now)) return false;
  p.reservations.push({ kind: "card", slotIndex });
  return true;
}

// LEFT-click on the Draw button: append a draw reservation.
//
// Always succeeds (even if a draw is already in the queue OR in the
// reservation list). The classic "no-op draw" — one with zero future-empty
// slots at fire time — is auto-DROPPED by tickReservationOnce when its
// turn comes, so spammy duplicates clean themselves up. Blocking here
// silently swallowed legitimate clicks (e.g., "queue another draw on top
// of the one currently casting"), which the player read as broken.
function appendDrawReservation(p: PlayerState): boolean {
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

  // Right-click on a card → cascade-release (same as toggling an
  // already-reserved card: drop that entry AND everything after it).
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

  // Left-click on a card → TOGGLE reservation (first match only).
  for (let i = 0; i < MAX_HAND_SIZE; i++) {
    const flag = cardFlag(i);
    if (flag === null) continue;
    if ((flags & flag) === 0) continue;
    if (toggleCardReservation(p, i, now)) opened = true;
    break;
  }

  if (opened && p.openedAt === null) p.openedAt = now;
}

// Auto-fire reservations. Walks the manual list head-first; fires when the
// head's trigger condition is met (queue empty for non-prereq, queue
// remaining == prereq for prereq cards). Falls back to "default" (Draw or
// leftmost playable) only when the manual list is EMPTY.
function tickReservation(s: GameState, now: number, bus: Bus) {
  const predictMode = s.predictMode ?? false;
  for (const idx of [0, 1] as const) {
    const p = s.players[idx];
    // Loop: a fire may make the next reservation eligible (cascade through
    // same-frame fires). Bounded for safety.
    for (let safety = 0; safety < 8; safety++) {
      if (!tickReservationOnce(p, now, bus, predictMode)) break;
    }
  }
}

function tickReservationOnce(p: PlayerState, now: number, bus: Bus, predictMode: boolean): boolean {
  // Forced default: never leave the player idle. When nothing is reserved
  // AND the queue is empty:
  //   - if there's an empty slot we can draw into → push a Draw
  //   - else (hand full of cards) → push the leftmost playable card
  // So the queue is always doing SOMETHING.
  //
  // SKIPPED in predict mode: the future graph would otherwise show cards
  // the player never authored (auto-Draw, auto-leftmost-playable), and
  // that drives the read of "what will happen" away from "what I planned".
  // In predict mode the projection ends at the player's explicit plan.
  if (!predictMode && p.reservations.length === 0 && p.queue.length === 0) {
    if (hasEmptyOpenSlot(p)) {
      p.reservations.push({ kind: "draw" });
    } else {
      const idx = leftmostPlayableSlot(p, now);
      if (idx >= 0) p.reservations.push({ kind: "card", slotIndex: idx });
    }
  }
  if (p.reservations.length === 0) return false;

  // ── Heavy-card scheduling ──
  //
  // Game spec (per player's wording):
  //   • Reservation order is sacred — heavy never overtakes preceding.
  //   • Reservations never fail; once accepted by the gate they fire.
  //   • Nothing "confirms early" — preceding stays cancellable until
  //     the chain actually NEEDS it for the heavy's prereq.
  //
  // Three firing mechanisms, all 閃-unit:
  //
  // (1) Heavy at HEAD with chain ≤ prereq:
  //       fire heavy (queue draws down to the heavy's prereq depth).
  //
  // (2) Non-prereq at head WITH a heavy later in the reservation list:
  //       - wait while chain > 0 (preceding stays untouched).
  //       - when chain == 0 (queue empty): compare remaining setupSen
  //         (cost of every reservation BEFORE the heavy, in 閃) against
  //         the heavy's prereqSen.
  //           setupSen >  prereqSen → surplus. Fire JUST the head card
  //             alone (queue-empty advance). This drains it one 閃
  //             later, then setupSen has decreased and we re-check.
  //           setupSen == prereqSen → ATOMIC fire: push every reservation
  //             up to AND including the heavy into the queue, in order,
  //             in the same frame. Heavy's prereq is then met exactly:
  //             chain after preceding = 0 + setupSen = prereqSen.
  //
  // (3) Non-prereq at head with NO heavy in reservation:
  //       fire when queue empty (normal one-at-a-time advance).
  //
  // The gate at toggleCardReservation enforces feasibility upstream so
  // setupSen < prereqSen never reaches mech (2) (would be a dead-stuck
  // heavy).
  const head = p.reservations[0];
  if (head.kind === "card") {
    const cardId = p.hand[head.slotIndex];
    if (cardId === null || cardId === undefined) {
      p.reservations.shift();
      return true;
    }
    const def = getCardDef(cardId);
    if (!def || def.cost >= 900) {
      p.reservations.shift();
      return true;
    }
    const prereqSen = def.prereqQueueTime ?? 0;

    if (prereqSen > 0) {
      // (1) Heavy at head: fire at the EXACT frame the chain drains down
      // to the prereq. queueRemainingFrames is an integer that decrements
      // by exactly 1 per frame, so the == crossing always exists; <= also
      // catches any rollback-replay edge so an accepted reservation can
      // never strand.
      if (queueRemainingFrames(p, now) <= prereqSen * FRAMES_PER_SEN) {
        if (queueCardImmediate(p, head.slotIndex, now, bus)) {
          p.reservations.shift();
          return true;
        }
      }
      return false;
    }

    // Non-prereq head. Look for the FIRST heavy later in reservations.
    let heavyIdx = -1;
    let heavyPrereq = 0;
    for (let i = 1; i < p.reservations.length; i++) {
      const r = p.reservations[i];
      if (r.kind !== "card") continue;
      const c = p.hand[r.slotIndex];
      const d = c != null && c !== undefined ? getCardDef(c) : null;
      if (d && (d.prereqQueueTime ?? 0) > 0) {
        heavyIdx = i;
        heavyPrereq = d.prereqQueueTime ?? 0;
        break;
      }
    }

    if (heavyIdx === -1) {
      // (3) No heavy in plan — normal one-at-a-time advance.
      if (p.queue.length === 0) {
        if (queueCardImmediate(p, head.slotIndex, now, bus)) {
          p.reservations.shift();
          return true;
        }
      }
      return false;
    }

    // (2) Heavy in reservation. Wait for queue to empty before deciding.
    if (p.queue.length > 0) return false;

    // Queue empty. setupSen = cost of reservations [0..heavyIdx-1], with
    // draw entries sized exactly as applyDrawAction will see them.
    const setupSen = reservationSetupSen(p, heavyIdx);

    if (setupSen > heavyPrereq) {
      // Surplus — fire JUST the head card alone, reducing setupSen by
      // its cost. The heavy still sits in reservations cancellable.
      if (queueCardImmediate(p, head.slotIndex, now, bus)) {
        p.reservations.shift();
        return true;
      }
      return false;
    }
    if (setupSen === heavyPrereq) {
      // Exact match — atomic fire everything up to and including the heavy.
      for (let i = 0; i < heavyIdx; i++) {
        const r = p.reservations[i];
        if (r.kind === "card") {
          queueCardImmediate(p, r.slotIndex, now, bus);
        } else {
          applyDrawAction(p, now);
        }
      }
      const heavyRes = p.reservations[heavyIdx];
      if (heavyRes.kind === "card") {
        queueCardImmediate(p, heavyRes.slotIndex, now, bus);
      }
      p.reservations.splice(0, heavyIdx + 1);
      return true;
    }
    // setupSen < heavyPrereq: stuck (would only happen if the gate let
    // through a non-fireable plan). Bail out so we don't loop.
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
    const prereqSen = def.prereqQueueTime ?? 0;
    if (prereqSen > 0 && queueRemainingFrames(p, now) < prereqSen * FRAMES_PER_SEN) continue;
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

// 整数ダメージを返す。弱体・脆弱はどちらも防御側にかかり、被ダメージが増える。
//   - 弱体（防御側）:   被ダメージ ×2
//   - 脆弱（防御側）:   被ダメージ ×1.5
//   - 連閃（攻撃側）:   連続発動2枚目以降 +1ずつ（上限 RENZAN_MAX_BONUS）
function attackDamage(base: number, attacker: PlayerState, defender: PlayerState | null): number {
  const renzanBonus = Math.min(RENZAN_MAX_BONUS, Math.max(0, attacker.renzan - 1));
  let dmg = base + attacker.strength + renzanBonus;
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
  // 烈閃: attacks resolving during a surge 閃 hit harder. Applied ONCE per
  // card (to its first damage message), so multi-hits don't multiply it.
  const surge = isSurgeSen(s.matchSeed, Math.floor(s.frame / FRAMES_PER_SEN));
  while (bus.cardPlayed.length > 0 || bus.exhausted.length > 0) {
    const played = bus.cardPlayed.splice(0, bus.cardPlayed.length);
    const exhausted = bus.exhausted.splice(0, bus.exhausted.length);

    for (const ev of played) {
      const def = getCardDef(ev.cardId);
      if (!def) continue;
      const damageStart = bus.damage.length;
      applyEffect(s, ev.player, def.effect, bus, ev.skipBlock);
      if (surge) {
        // First ATTACK-kind message only — self-damage riders (瀉血 etc.)
        // must not get the bonus.
        for (let di = damageStart; di < bus.damage.length; di++) {
          const dm = bus.damage[di];
          if (dm.kind === DamageKind.Attack && dm.source === ev.player) {
            dm.amount += RETSU_SEN_BONUS;
            break;
          }
        }
      }
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
  for (const p of s.players) tickMaturing(p);
  // サドンデス: from 第SUDDEN_DEATH_START_SEN閃, both players burn every
  // 閃 boundary (block ignored), escalating — every match ends. Purely
  // symmetric; frame-exact so it's identical for both peers.
  if (s.frame % FRAMES_PER_SEN === 0) {
    const sen = s.frame / FRAMES_PER_SEN;
    if (sen >= SUDDEN_DEATH_START_SEN) {
      const dmg = 1 + Math.floor((sen - SUDDEN_DEATH_START_SEN) / SUDDEN_DEATH_RAMP_SEN);
      for (const p of s.players) p.hp = Math.max(0, p.hp - dmg);
    }
  }

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
