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
import { cardFlag } from "./input";
import {
  BLOCK_DECAY_RATE,
  DT,
  MAX_HAND_SIZE,
  nextDrawDelaySec,
  PLAYED_TO_DISCARD,
  RESOLVED_HISTORY_MAX,
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
        const absorbed = Math.min(rem, o.block);
        o.block = Math.max(0, o.block - absorbed);
        rem -= absorbed;
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

function tickBlockDecay(p: PlayerState, dt: number) {
  if (p.barricade || p.block <= 0) return;
  p.block = Math.max(0, p.block - BLOCK_DECAY_RATE * dt);
}

// ── Cast queue: resolve head when its duration elapses, advance start time ──

function tickCasting(s: GameState, now: number, bus: Bus) {
  for (const idx of [0, 1] as const) {
    const p = s.players[idx];
    // Drain as many queue heads as have fully elapsed this frame.
    while (p.queue.length > 0 && now - p.castStartedAt >= p.queue[0].duration) {
      const entry = p.queue.shift()!;
      // Advance by exactly the consumed duration so carry-over time rolls
      // into the next entry (no time lost between back-to-back casts).
      p.castStartedAt += entry.duration;
      // Stamp it as resolved for the UI history. resolvedAt is the moment
      // the card finished casting (the slot's old endTime).
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

      // Disposition: powers vanish, exhausters disappear, else → discard.
      let goToDiscard = PLAYED_TO_DISCARD;
      let countsAsExhaust = false;
      if (def.cardType === CardType.Power) { goToDiscard = false; }
      if (def.exhausts || def.effect.kind === "Exhaust") { goToDiscard = false; countsAsExhaust = true; }
      if (def.cardType === CardType.Skill && p.corruption) { goToDiscard = false; countsAsExhaust = true; }
      if (goToDiscard) p.discard.push(entry.cardId);

      bus.cardPlayed.push({ player: idx, cardId: entry.cardId });
      if (countsAsExhaust) bus.exhausted.push({ player: idx, cardId: entry.cardId });
      // (No auto-refill: the per-player draw timer handles refills.)
    }
  }
}

// Per-frame draw timer: when sim time crosses nextDrawAt and the hand isn't
// full, draw 1 and re-arm with (handSize + 1) seconds. Hand size 6 → no draws
// (the timer is pushed forward to "now" so it doesn't bank). Card-effect
// draws (受け流し etc.) bypass this and just call drawCards directly.
// Draw timer rules ("sensible spec"):
//   - nextDrawAt / drawTimerTotal are ONLY rewritten when a draw fires
//     (success or retry-at-MAX). Queuing/playing a card never resets them
//     mid-cycle, so the UI water-fill bar advances monotonically.
//   - When the timer fires and hand < MAX: draw one, schedule next at
//     (now + (handSize + 1)).
//   - When the timer fires and hand == MAX: skip the draw and retry in 1s;
//     the next play will let the queued retry fire shortly after.
function tickDrawTimer(s: GameState, now: number, bus: Bus) {
  for (const idx of [0, 1] as const) {
    const p = s.players[idx];
    let safety = 0;
    while (now >= p.nextDrawAt && ++safety < 8) {
      if (p.hand.length >= MAX_HAND_SIZE) {
        // Hand full: try again in 1s. The slot UI is hidden at this size,
        // so the temporary 1s denominator never shows.
        p.nextDrawAt = now + 1;
        p.drawTimerTotal = 1;
        break;
      }
      const before = p.hand.length;
      drawCards(s, idx, 1, bus);
      const after = p.hand.length;
      if (after === before) break; // deck + discard both empty
      const delay = nextDrawDelaySec(after);
      p.nextDrawAt += delay;
      p.drawTimerTotal = delay;
    }
  }
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

function applyInput(s: GameState, idx: 0 | 1, flags: number) {
  if (flags === 0) return;
  const p = s.players[idx];
  const now = s.frame * DT;

  for (let i = 0; i < MAX_HAND_SIZE; i++) {
    const flag = cardFlag(i);
    if (flag === null) continue;
    if ((flags & flag) === 0) continue;
    const cardId = p.hand[i];
    if (cardId === undefined) break;
    const def = getCardDef(cardId);
    if (!def) break;
    if (def.cost >= 900) break; // status junk — unplayable

    // Prereq gate: required queued cast time must already be committed
    // (actual REMAINING time — once setup cards finish, the prereq vanishes).
    const prereq = def.prereqQueueTime ?? 0;
    if (prereq > 0 && queueRemainingTime(p, now) < prereq) break;

    let duration = def.cost;
    if (p.corruption && def.cardType === CardType.Skill) duration = 0;

    // Move card from hand → end of queue.
    p.hand.splice(i, 1);
    if (p.queue.length === 0) p.castStartedAt = now;
    p.queue.push({ cardId, duration });
    break;
  }
}

// ── Deck / hand / discard ──

export function dealCards(p: PlayerState, count: number) {
  let remaining = count;
  while (remaining > 0) {
    if (p.hand.length >= MAX_HAND_SIZE) break;
    remaining--;
    if (p.deck.length === 0 && p.discard.length > 0) {
      p.deck.push(...p.discard);
      p.discard.length = 0;
      shuffleDeck(p);
    }
    const c = drawOne(p);
    if (c === null) break;
    p.hand.push(c);
  }
}

function shuffleDeck(p: PlayerState) {
  if (p.deck.length < 2) return;
  for (let i = p.deck.length - 1; i >= 1; i--) {
    const j = Number(rangeU64(p.rng, BigInt(i + 1)));
    const tmp = p.deck[i]; p.deck[i] = p.deck[j]; p.deck[j] = tmp;
  }
}

function drawOne(p: PlayerState): CardId | null {
  if (p.deck.length === 0) return null;
  const idx = Number(rangeU64(p.rng, BigInt(p.deck.length)));
  const last = p.deck.length - 1;
  const out = p.deck[idx];
  p.deck[idx] = p.deck[last];
  p.deck.pop();
  return out;
}

function drawCards(s: GameState, idx: 0 | 1, count: number, bus: Bus) {
  const p = s.players[idx];
  let remaining = count;
  while (remaining > 0) {
    if (p.hand.length >= MAX_HAND_SIZE) break;
    remaining--;
    if (p.deck.length === 0 && p.discard.length > 0) {
      p.deck.push(...p.discard);
      p.discard.length = 0;
      shuffleDeck(p);
    }
    const c = drawOne(p);
    if (c === null) break;
    p.hand.push(c);

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

function attackDamage(base: number, attacker: PlayerState, defender: PlayerState | null): number {
  let dmg = base + attacker.strength;
  if (attacker.weakSecs > 0) dmg *= 0.75;
  if (defender && defender.vulnerableSecs > 0) dmg *= 1.5;
  return Math.max(0, dmg);
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
  while (bus.block.length > 0) {
    const m = bus.block.shift()!;
    const p = s.players[m.target];
    p.block = Math.max(0, p.block + m.amount);
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
  while (bus.damage.length > 0) {
    const m = bus.damage.shift()!;
    const target = s.players[m.target];
    const total = Math.max(0, m.amount);
    const pierce = Math.max(0, Math.min(1, m.pierce ?? 0));
    const directHp = total * pierce;
    let blockable = total * (1 - pierce);
    const absorbed = Math.min(blockable, target.block);
    target.block -= absorbed;
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
  for (const p of s.players) tickBlockDecay(p, dt);

  // 2. Cast slots: anything completing this frame resolves now.
  tickCasting(s, now, bus);

  // 2b. Timer-based card draws (fire after resolves so the new hand size
  // accounts for any post-cast hand changes from this frame).
  tickDrawTimer(s, now, bus);

  // 3. Inputs: start new casts (no-op if already casting).
  applyInput(s, 0, p0Input);
  applyInput(s, 1, p1Input);

  // 4. Drain effect / draw / damage chains until quiescent.
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

  // 5. Game over?
  if (s.players[0].hp <= 0 && s.players[1].hp <= 0) s.result = 3;
  else if (s.players[0].hp <= 0) s.result = 2;
  else if (s.players[1].hp <= 0) s.result = 1;

  s.frame++;
  return s;
}
