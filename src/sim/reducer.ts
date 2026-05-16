// Pure deterministic reducer. Both peers run the identical logic on identical
// inputs to converge on identical state. This is what makes rollback work.
//
// Port of src/game/{cost,deck,effect,health,status,input_buffer}.rs collapsed
// into one fixed-step function: step(state, [p0input, p1input], dt) -> state.

import {
  CardEffect,
  CardId,
  CardType,
  getCardDef,
} from "./cards";
import { cardFlag, INPUT_DRAW } from "./input";
import {
  BLOCK_DECAY_RATE,
  DRAW_COST,
  DRAW_COUNT,
  DT,
  MAX_HAND_SIZE,
  PLAYED_TO_DISCARD,
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

// ── Tick (status durations + persistent powers + block decay + acceleration + cost) ──

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

function tickAcceleration(p: PlayerState, dt: number) {
  if (p.accelRemaining > 0) {
    p.accelRemaining -= dt;
    if (p.accelRemaining <= 0) {
      p.costRate = Math.max(0, p.costRate - p.accelBonusRate);
      p.accelBonusRate = 0;
      p.accelRemaining = 0;
    }
  }
}

const accumulateCost = (p: PlayerState, dt: number) => {
  p.cost += p.costRate * dt;
};

// ── Input handling ──

function applyInput(s: GameState, idx: 0 | 1, flags: number, bus: Bus) {
  if (flags === 0) return;
  const p = s.players[idx];

  // Draw: flat 1-cost.
  if ((flags & INPUT_DRAW) !== 0) {
    if (p.cost >= DRAW_COST) {
      p.cost -= DRAW_COST;
      bus.draw.push({ target: idx, count: DRAW_COUNT });
    }
  }

  // First card-flag wins.
  for (let i = 0; i < MAX_HAND_SIZE; i++) {
    const flag = cardFlag(i);
    if (flag === null) continue;
    if ((flags & flag) === 0) continue;
    const cardId = p.hand[i];
    if (cardId === undefined) break;
    const def = getCardDef(cardId);
    if (!def) break;

    const cost = (p.corruption && def.cardType === CardType.Skill) ? 0 : def.cost;
    if (p.cost < cost) break;
    p.cost -= cost;
    playCard(s, idx, i, bus);
    break;
  }
}

// ── Deck / hand / discard ──

// Public deal helper (used by init to give the opening hand without spending cost).
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
  p.deck[idx] = p.deck[last]; // swap_remove
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

function playCard(s: GameState, idx: 0 | 1, handIndex: number, bus: Bus) {
  const p = s.players[idx];
  if (handIndex >= p.hand.length) return;
  const cardId = p.hand[handIndex];
  p.hand.splice(handIndex, 1);

  const def = getCardDef(cardId);
  if (!def) return;

  // Disposition: powers stay attached (vanish from circulation), exhausting
  // cards are removed permanently from this match, otherwise → discard pile
  // (Slay-style cycling). Corruption forces every skill to exhaust.
  let goToDiscard = PLAYED_TO_DISCARD;
  let countsAsExhaust = false;
  if (def.cardType === CardType.Power) { goToDiscard = false; }
  if (def.exhausts || def.effect.kind === "Exhaust") { goToDiscard = false; countsAsExhaust = true; }
  if (def.cardType === CardType.Skill && p.corruption) { goToDiscard = false; countsAsExhaust = true; }

  if (goToDiscard) p.discard.push(cardId);

  bus.cardPlayed.push({ player: idx, cardId });
  if (countsAsExhaust) bus.exhausted.push({ player: idx, cardId });
}

// ── Card effect resolution ──

function attackDamage(base: number, attacker: PlayerState, defender: PlayerState | null): number {
  // Slay-style: +1 Strength = +1 damage per attack-hit (flat additive).
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
      p.costRate += effect.bonusRate;
      if (p.accelRemaining > 0) {
        p.accelBonusRate += effect.bonusRate;
        p.accelRemaining = Math.max(p.accelRemaining, effect.duration);
      } else {
        p.accelBonusRate = effect.bonusRate;
        p.accelRemaining = Math.max(0, effect.duration);
      }
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
      // Handled by deck system (card already excluded from deck).
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
  // Drain card-played and exhausted queues. Each can re-enqueue further effects.
  // Loop until both are empty (bounded by cards in hand).
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

// ── Health / damage / block / juggernaut / thorns ──

function processBlockGains(s: GameState, bus: Bus) {
  // Juggernaut fires a Damage on block-gain.
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
    const p = s.players[m.target];
    p.thorns = Math.max(0, p.thorns + m.amount);
  }
}

function processDamage(s: GameState, bus: Bus) {
  // Damage may queue thorns (which queue more damage), so loop.
  while (bus.damage.length > 0) {
    const m = bus.damage.shift()!;
    const target = s.players[m.target];
    const total = Math.max(0, m.amount);
    // pierce: fraction that skips block entirely (FiendFire 50%, Reaper 100%).
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


// ── The frame step. Mutates `s` in place. Order matches Rust GameplaySystems. ──

export function step(s: GameState, p0Input: number, p1Input: number, dt: number = DT): GameState {
  if (s.result !== 0) {
    s.frame++;
    return s;
  }

  const bus = newBus();

  // Tick: status durations, persistent powers, block decay, acceleration, cost.
  for (const p of s.players) {
    tickStatus(p, dt);
  }
  tickPowers(s, dt, bus);
  for (const p of s.players) {
    tickBlockDecay(p, dt);
    tickAcceleration(p, dt);
    accumulateCost(p, dt);
  }

  // Input.
  applyInput(s, 0, p0Input, bus);
  applyInput(s, 1, p1Input, bus);

  // Effect / deck / health resolution loop until no more messages.
  // tickPowers may have queued block messages. Settle them first.
  let safety = 0;
  while (
    bus.cardPlayed.length || bus.exhausted.length ||
    bus.draw.length || bus.damage.length || bus.heal.length ||
    bus.block.length || bus.thorns.length ||
    bus.strength.length || bus.vuln.length || bus.weak.length || bus.addStatus.length
  ) {
    if (++safety > 256) break; // bounded by cards in hand + chained effects
    processCardPlayed(s, bus);
    processStatusBus(s, bus);
    processBlockGains(s, bus);
    processDamage(s, bus);
    processHeal(s, bus);
    processDraw(s, bus);
  }

  // Game-over check.
  if (s.players[0].hp <= 0 && s.players[1].hp <= 0) s.result = 3;
  else if (s.players[0].hp <= 0) s.result = 2;
  else if (s.players[1].hp <= 0) s.result = 1;

  s.frame++;
  return s;
}
