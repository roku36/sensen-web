// AI policies for the cast-time model (v2).
//
// A policy is a per-frame function. It returns 0 (do nothing) or a card-flag
// bit (start casting that hand index). When the player is already casting,
// the policy always returns 0 — the cast slot IS the cooldown, no need for
// a manual delay.
//
// Policies receive a seed for reproducibility (used by tie-breaks).

import { CardEffect, getCardDef } from "../sim/cards";
import { cardFlag } from "../sim/input";
import { queueRemainingTime } from "../sim/reducer";
import { DT } from "../sim/rules";
import { GameState, PlayerState } from "../sim/state";

export type Policy = (state: GameState, side: 0 | 1) => number;
export type PolicyFactory = (seed?: number) => Policy;

// ── helpers ──

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

function playableIndices(p: PlayerState, now: number): number[] {
  const out: number[] = [];
  const queued = queueRemainingTime(p, now);
  for (let i = 0; i < p.hand.length; i++) {
    const d = getCardDef(p.hand[i]);
    if (!d) continue;
    if (d.cost >= 900) continue; // status junk
    if ((d.prereqQueueTime ?? 0) > queued) continue; // not enough setup
    out.push(i);
  }
  return out;
}

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
  const direct = dmg * pierce;
  const blocked = Math.max(0, dmg * (1 - pierce) - o.block);
  return direct + blocked;
}

function blockScore(e: CardEffect): number {
  switch (e.kind) {
    case "Block": return e.amount;
    case "Combo": return e.effects.reduce((s, x) => s + blockScore(x), 0);
    case "DoubleBlock": return 1;
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

// ── policies ──

export const passive: PolicyFactory = () => () => 0;

export const random: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  return (state, side) => {
    const p = state.players[side];
    // Lookahead: queue up to MAX_AI_QUEUE cards. With 1 you'd get
    // single-slot behavior; 2 lets the AI commit to a short combo and
    // makes the queue actually visible during play.
    if (p.queue.length >= 2) return 0;
    const opts = playableIndices(p, state.frame * DT);
    if (opts.length === 0) return 0;
    return cardFlag(opts[Math.floor(r() * opts.length)]) ?? 0;
  };
};

// Highest damage-per-second pick (value-per-time matters in cast model).
export const greedyAttack: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  return (state, side) => {
    const p = state.players[side], o = state.players[(side ^ 1) as 0 | 1];
    // Lookahead: queue up to MAX_AI_QUEUE cards. With 1 you'd get
    // single-slot behavior; 2 lets the AI commit to a short combo and
    // makes the queue actually visible during play.
    if (p.queue.length >= 2) return 0;
    const opts = playableIndices(p, state.frame * DT);
    if (opts.length === 0) return 0;
    let bestI = opts[0], bestScore = -Infinity;
    for (const i of opts) {
      const def = getCardDef(p.hand[i])!;
      const t = Math.max(0.1, def.cost);
      const s = damageScore(def.effect, p, o) / t;
      if (s > bestScore || (s === bestScore && r() < 0.5)) { bestScore = s; bestI = i; }
    }
    return cardFlag(bestI) ?? 0;
  };
};

// Block when HP is low, attack otherwise.
export const greedyDefense: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  return (state, side) => {
    const p = state.players[side], o = state.players[(side ^ 1) as 0 | 1];
    // Lookahead: queue up to MAX_AI_QUEUE cards. With 1 you'd get
    // single-slot behavior; 2 lets the AI commit to a short combo and
    // makes the queue actually visible during play.
    if (p.queue.length >= 2) return 0;
    const opts = playableIndices(p, state.frame * DT);
    if (opts.length === 0) return 0;
    const wantBlock = p.hp / p.hpMax < 0.6 && p.block < 8;
    let bestI = opts[0], bestScore = -Infinity;
    for (const i of opts) {
      const def = getCardDef(p.hand[i])!;
      const t = Math.max(0.1, def.cost);
      const s = wantBlock
        ? (blockScore(def.effect) * 2 + damageScore(def.effect, p, o)) / t
        : damageScore(def.effect, p, o) / t;
      if (s > bestScore || (s === bestScore && r() < 0.5)) { bestScore = s; bestI = i; }
    }
    return cardFlag(bestI) ?? 0;
  };
};

// Combined: lethal → survive → maximize value-per-second.
export const heuristic: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  return (state, side) => {
    const p = state.players[side], o = state.players[(side ^ 1) as 0 | 1];
    // Lookahead: queue up to MAX_AI_QUEUE cards. With 1 you'd get
    // single-slot behavior; 2 lets the AI commit to a short combo and
    // makes the queue actually visible during play.
    if (p.queue.length >= 2) return 0;
    const opts = playableIndices(p, state.frame * DT);
    if (opts.length === 0) return 0;
    const hpFrac = p.hp / p.hpMax;
    const oppNearDead = o.hp <= 15;
    const inDanger = hpFrac < 0.35;
    let bestI = opts[0], bestScore = -Infinity;
    for (const i of opts) {
      const def = getCardDef(p.hand[i])!;
      const t = Math.max(0.1, def.cost);
      const dmg = damageScore(def.effect, p, o);
      const blk = blockScore(def.effect);
      const util = utilityScore(def.effect);
      let raw = 0;
      if (oppNearDead) raw = dmg * 5 + util;
      else if (inDanger) raw = blk * 3 + dmg + util;
      else raw = dmg * 1.5 + blk + util;
      const s = raw / t;
      if (s > bestScore || (s === bestScore && r() < 0.5)) { bestScore = s; bestI = i; }
    }
    return cardFlag(bestI) ?? 0;
  };
};

export const policies: Record<string, PolicyFactory> = {
  passive, random, greedyAttack, greedyDefense, heuristic,
};
