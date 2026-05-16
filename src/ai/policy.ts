// AI policies for headless simulation.
//
// A Policy is a stateful function (factory + closure) called every sim frame
// for one side. It returns input flags (0 = do nothing). Most frames it
// should return 0; otherwise we'd flood inputs at 60Hz. Each policy keeps a
// local cooldown so it acts at a reasonable cadence (~6 frames = 10 Hz).
//
// Policies receive a seed for reproducibility: two batches with the same
// seed produce identical matches.

import { CardEffect, CardType, getCardDef } from "../sim/cards";
import { cardFlag, INPUT_DRAW } from "../sim/input";
import { DRAW_COST } from "../sim/rules";
import { GameState, PlayerState } from "../sim/state";

export type Policy = (state: GameState, side: 0 | 1) => number;
export type PolicyFactory = (seed?: number) => Policy;

const ACT_EVERY = 6; // frames between actions (= 10 actions/sec max)

// ── helpers ──────────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff;
  };
}

function playableIndices(p: PlayerState): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.hand.length; i++) {
    const d = getCardDef(p.hand[i]);
    if (!d || d.cost === 999) continue;
    const cost = p.corruption && d.cardType === CardType.Skill ? 0 : d.cost;
    if (p.cost >= cost) out.push(i);
  }
  return out;
}

// Score a card effect for offensive value (expected damage to opp).
function damageScore(e: CardEffect, p: PlayerState, o: PlayerState): number {
  switch (e.kind) {
    case "Damage": return effectiveDamage(e.amount, p, o, e.pierceBlock ?? 0);
    case "MultiHit": return effectiveDamage(e.damage, p, o, e.pierceBlock ?? 0) * e.hits;
    case "BodySlam": return effectiveDamage(p.block, p, o, 0);
    case "Combo": return e.effects.reduce((s, x) => s + damageScore(x, p, o), 0);
    default: return 0;
  }
}

function effectiveDamage(base: number, p: PlayerState, o: PlayerState, pierce: number): number {
  let dmg = base + p.strength;
  if (p.weakSecs > 0) dmg *= 0.75;
  if (o.vulnerableSecs > 0) dmg *= 1.5;
  dmg = Math.max(0, dmg);
  // Effective vs block: pierce fraction bypasses, rest is reduced by block.
  const direct = dmg * pierce;
  const blocked = Math.max(0, dmg * (1 - pierce) - o.block);
  return direct + blocked;
}

function blockScore(e: CardEffect): number {
  switch (e.kind) {
    case "Block": return e.amount;
    case "Combo": return e.effects.reduce((s, x) => s + blockScore(x), 0);
    case "DoubleBlock": return 1; // weight, value depends on current block
    default: return 0;
  }
}

function utilityScore(e: CardEffect): number {
  switch (e.kind) {
    case "Draw": return 2 * e.count;
    case "Strength": return 4 * e.amount;
    case "Vulnerable": return 3 * e.duration;
    case "Weak": return 2 * e.duration;
    case "Heal": return 0.5 * e.amount;
    case "Thorns": return 0.5 * e.amount;
    case "Combo": return e.effects.reduce((s, x) => s + utilityScore(x), 0);
    default: return 0;
  }
}

// ── policies ─────────────────────────────────────────────────────────────────

export const passive: PolicyFactory = () => () => 0;

export const random: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  let cd = 0;
  return (state, side) => {
    if (cd > 0) { cd--; return 0; }
    const p = state.players[side];
    cd = ACT_EVERY;
    const opts = playableIndices(p);
    // Sometimes draw, sometimes play random, sometimes wait.
    const roll = r();
    if (opts.length > 0 && roll < 0.55) {
      const i = opts[Math.floor(r() * opts.length)];
      return cardFlag(i) ?? 0;
    }
    if (p.cost >= DRAW_COST && p.hand.length < 8 && roll < 0.75) return INPUT_DRAW;
    return 0;
  };
};

// Always pick the highest-damage playable card; draw when hand empty.
export const greedyAttack: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  let cd = 0;
  return (state, side) => {
    if (cd > 0) { cd--; return 0; }
    const p = state.players[side], o = state.players[(side ^ 1) as 0 | 1];
    cd = ACT_EVERY;
    const opts = playableIndices(p);
    if (opts.length === 0) {
      if (p.cost >= DRAW_COST) return INPUT_DRAW;
      return 0;
    }
    let bestI = -1, bestScore = -1;
    for (const i of opts) {
      const def = getCardDef(p.hand[i])!;
      const s = damageScore(def.effect, p, o);
      if (s > bestScore || (s === bestScore && r() < 0.5)) { bestScore = s; bestI = i; }
    }
    if (bestI < 0 || bestScore <= 0) {
      // No attack available — play first non-status to cycle.
      return cardFlag(opts[0]) ?? 0;
    }
    return cardFlag(bestI) ?? 0;
  };
};

// Block when low on HP, attack otherwise.
export const greedyDefense: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  let cd = 0;
  return (state, side) => {
    if (cd > 0) { cd--; return 0; }
    const p = state.players[side], o = state.players[(side ^ 1) as 0 | 1];
    cd = ACT_EVERY;
    const opts = playableIndices(p);
    if (opts.length === 0) {
      if (p.cost >= DRAW_COST) return INPUT_DRAW;
      return 0;
    }
    const hpFrac = p.hp / p.hpMax;
    const wantBlock = hpFrac < 0.6 && p.block < 8;
    let bestI = opts[0], bestScore = -1;
    for (const i of opts) {
      const def = getCardDef(p.hand[i])!;
      const s = wantBlock
        ? blockScore(def.effect) * 2 + damageScore(def.effect, p, o)
        : damageScore(def.effect, p, o);
      if (s > bestScore || (s === bestScore && r() < 0.5)) { bestScore = s; bestI = i; }
    }
    return cardFlag(bestI) ?? 0;
  };
};

// Mix: lethal check → block when in danger → utility otherwise → damage.
export const heuristic: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  let cd = 0;
  return (state, side) => {
    if (cd > 0) { cd--; return 0; }
    const p = state.players[side], o = state.players[(side ^ 1) as 0 | 1];
    cd = ACT_EVERY;
    const opts = playableIndices(p);
    if (opts.length === 0) {
      if (p.cost >= DRAW_COST && p.hand.length < 6) return INPUT_DRAW;
      return 0;
    }
    const hpFrac = p.hp / p.hpMax;
    const oppNearDead = o.hp <= 15;
    const inDanger = hpFrac < 0.35;
    let bestI = opts[0], bestScore = -Infinity;
    for (const i of opts) {
      const def = getCardDef(p.hand[i])!;
      let s = 0;
      const dmg = damageScore(def.effect, p, o);
      const blk = blockScore(def.effect);
      const util = utilityScore(def.effect);
      if (oppNearDead) s = dmg * 5 + util;          // FINISH
      else if (inDanger) s = blk * 3 + dmg + util;   // SURVIVE
      else s = dmg * 1.5 + blk + util;               // BALANCED
      // Cost efficiency tiebreak
      s -= def.cost * 0.5;
      if (s > bestScore || (s === bestScore && r() < 0.5)) { bestScore = s; bestI = i; }
    }
    // Draw when nothing usable AND we have spare cost.
    if (bestScore <= 0 && p.cost >= DRAW_COST * 2 && p.hand.length < 5) return INPUT_DRAW;
    return cardFlag(bestI) ?? 0;
  };
};

export const policies: Record<string, PolicyFactory> = {
  passive, random, greedyAttack, greedyDefense, heuristic,
};
