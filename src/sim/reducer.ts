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
} from "./input";
import {
  BLOCK_HISTORY_SEC,
  DRAW_SEN_PER_CARD,
  DT,
  MAX_HAND_SIZE,
  PLAYED_TO_DISCARD,
  RESOLVED_HISTORY_MAX,
  SEC_PER_SEN,
  senToSec,
} from "./rules";
import { rangeU64 } from "./rng";
import type { GameState, PlayerState } from "./state";

const enum DamageKind { Attack = 0, Power = 1, Thorns = 2 }

interface DamageMsg { target: 0 | 1; amount: number; source: 0 | 1 | null; kind: DamageKind; pierce?: number }
interface HealMsg { target: 0 | 1; amount: number }
interface DrawMsg { target: 0 | 1; count: number }
interface BlockMsg { target: 0 | 1; amount: number }
interface ThornsMsg { target: 0 | 1; amount: number }
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
  strength: StrMsg[];
  vuln: VulnMsg[];
  weak: WeakMsg[];
  addStatus: AddStatusMsg[];
  cardPlayed: { player: 0 | 1; cardId: CardId }[];
  exhausted: { player: 0 | 1; cardId: CardId }[];
}

const newBus = (): Bus => ({
  damage: [], heal: [], draw: [], block: [], thorns: [],
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

        bus.cardPlayed.push({ player: idx, cardId: entry.cardId });
        if (countsAsExhaust) bus.exhausted.push({ player: idx, cardId: entry.cardId });
      }
      // Draw entries leave no history mark — the slot fills themselves
      // make the action visible in the hand row.
    }
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
function queueCardImmediate(p: PlayerState, slotIndex: number, now: number): boolean {
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
  if (p.queue.length === 0) p.castStartedAt = Math.max(p.castStartedAt, now);
  p.queue.push({ kind: "card", cardId, duration });
  return true;
}

const RESERVE_FLAGS = [
  INPUT_RESERVE_CARD_1, INPUT_RESERVE_CARD_2, INPUT_RESERVE_CARD_3,
  INPUT_RESERVE_CARD_4, INPUT_RESERVE_CARD_5, INPUT_RESERVE_CARD_6,
];

function applyInput(s: GameState, idx: 0 | 1, flags: number) {
  if (flags === 0) return;
  const p = s.players[idx];
  const now = s.frame * DT;

  // Reservation inputs first — these don't immediately add to queue, just
  // set the auto-play target. They still count as "the player has acted"
  // for the opened-at gate.
  if ((flags & INPUT_RESERVE_DRAW) !== 0) {
    p.reservation = { kind: "draw" };
    if (p.openedAt === null) p.openedAt = now;
  }
  for (let i = 0; i < 6; i++) {
    if ((flags & RESERVE_FLAGS[i]) !== 0) {
      p.reservation = { kind: "card", slotIndex: i };
      if (p.openedAt === null) p.openedAt = now;
    }
  }

  // Draw button: queue a draw entry immediately.
  if ((flags & INPUT_DRAW) !== 0) {
    if (applyDrawAction(p, now)) {
      if (p.openedAt === null) p.openedAt = now;
    }
  }

  // Direct card play.
  for (let i = 0; i < MAX_HAND_SIZE; i++) {
    const flag = cardFlag(i);
    if (flag === null) continue;
    if ((flags & flag) === 0) continue;
    if (queueCardImmediate(p, i, now)) {
      if (p.openedAt === null) p.openedAt = now;
    }
    break;
  }
}

// Auto-fire reservation when the trigger condition is met:
//   - reservation.kind === "draw": queue empty AND there's an empty slot
//   - reservation.kind === "card" without prereq: queue empty
//   - reservation.kind === "card" with prereq>0: queue remaining == prereq
//   - reservation.kind === "default": treat as "draw if possible else
//       leftmost playable card"
// If the action succeeds, the reservation collapses back to "default" so the
// next idle moment re-evaluates from scratch (the Draw default).
function tickReservation(s: GameState, now: number) {
  for (const idx of [0, 1] as const) {
    const p = s.players[idx];
    if (p.queue.length === 0) {
      tryFireOnQueueEmpty(p, now);
    } else if (p.reservation.kind === "card") {
      const cardId = p.hand[p.reservation.slotIndex];
      if (cardId !== null && cardId !== undefined) {
        const def = getCardDef(cardId);
        const prereqSec = def ? senToSec(def.prereqQueueTime ?? 0) : 0;
        if (prereqSec > 0) {
          // Fire when queue remaining ≈ prereq (within one frame's DT).
          const remaining = queueRemainingTime(p, now);
          if (remaining <= prereqSec + DT / 2 && remaining >= prereqSec - DT / 2) {
            if (queueCardImmediate(p, p.reservation.slotIndex, now)) {
              p.reservation = { kind: "default" };
            }
          }
        }
      }
    }
  }
}

function tryFireOnQueueEmpty(p: PlayerState, now: number) {
  let action: "draw" | { kind: "card"; slot: number } | "none" = "none";
  if (p.reservation.kind === "draw") {
    action = "draw";
  } else if (p.reservation.kind === "card") {
    const cardId = p.hand[p.reservation.slotIndex];
    if (cardId !== null && cardId !== undefined) {
      const def = getCardDef(cardId);
      if (def && def.cost < 900 && (def.prereqQueueTime ?? 0) === 0) {
        action = { kind: "card", slot: p.reservation.slotIndex };
      }
    }
  } else {
    // Default: prefer Draw if there's an empty non-reserved slot, else the
    // leftmost playable card with no prereq.
    if (hasEmptyOpenSlot(p)) {
      action = "draw";
    } else {
      const slot = leftmostPlayableSlot(p, now);
      if (slot >= 0) action = { kind: "card", slot };
    }
  }
  if (action === "draw") {
    applyDrawAction(p, now);
    if (p.reservation.kind === "draw") p.reservation = { kind: "default" };
  } else if (action !== "none") {
    if (queueCardImmediate(p, action.slot, now)) {
      if (p.reservation.kind === "card") p.reservation = { kind: "default" };
    }
  }
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

// Returns INTEGER damage. The ×0.75 / ×1.5 multipliers from weak/vuln are
// rounded immediately so block (an integer) absorbs an integer number of
// units — keeps every block update step-clean.
function attackDamage(base: number, attacker: PlayerState, defender: PlayerState | null): number {
  let dmg = base + attacker.strength;
  if (attacker.weakSecs > 0) dmg *= 0.75;
  if (defender && defender.vulnerableSecs > 0) dmg *= 1.5;
  return Math.max(0, Math.round(dmg));
}

function applyEffect(
  s: GameState,
  idx: 0 | 1,
  effect: CardEffect,
  bus: Bus,
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
      bus.block.push({ target: idx, amount: effect.amount });
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
    case "Combo":
      for (const e of effect.effects) applyEffect(s, idx, e, bus);
      break;
  }
}

function processCardPlayed(s: GameState, bus: Bus) {
  while (bus.cardPlayed.length > 0 || bus.exhausted.length > 0) {
    const played = bus.cardPlayed.splice(0, bus.cardPlayed.length);
    const exhausted = bus.exhausted.splice(0, bus.exhausted.length);

    for (const ev of played) {
      const def = getCardDef(ev.cardId);
      if (!def) continue;
      applyEffect(s, ev.player, def.effect, bus);
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

    if (m.kind === DamageKind.Attack && m.source !== null && m.source !== m.target && target.thorns > 0 && m.amount > 0) {
      bus.damage.push({
        target: m.source,
        amount: target.thorns,
        source: m.target,
        kind: DamageKind.Thorns,
      });
    }
    if (m.kind === DamageKind.Power && m.source === m.target && m.amount > 0 && target.rupture) {
      target.strength += target.rupture.strengthOnSelfDmg;
    }
  }
}

function processHeal(s: GameState, bus: Bus) {
  while (bus.heal.length > 0) {
    const m = bus.heal.shift()!;
    const p = s.players[m.target];
    p.hp = Math.min(p.hpMax, p.hp + m.amount);
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

  // 2. Cast slots: card casts resolve, draw-entry slots fill sequentially.
  tickCasting(s, now, bus);

  // 3. Inputs: explicit plays / reservations.
  applyInput(s, 0, p0Input);
  applyInput(s, 1, p1Input);

  // 4. Reservation auto-fire: if a player's queue is empty (or the prereq
  // condition for a card reservation is met), append the reserved action.
  tickReservation(s, now);

  // 5. Drain effect / draw / damage chains until quiescent.
  let safety = 0;
  while (
    bus.cardPlayed.length || bus.exhausted.length ||
    bus.draw.length || bus.damage.length || bus.heal.length ||
    bus.block.length || bus.thorns.length ||
    bus.strength.length || bus.vuln.length || bus.weak.length || bus.addStatus.length
  ) {
    if (++safety > 256) break;
    processCardPlayed(s, bus);
    processStatusBus(s, bus);
    processBlockGains(s, bus);
    processDamage(s, bus);
    processHeal(s, bus);
    processDraw(s, bus);
  }
  // Re-arm block decay for both players (idempotent if block unchanged).
  for (const p of s.players) armBlockDecay(p, now);

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
