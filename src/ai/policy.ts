// AI policies — a strategic LADDER for the cast-time model.
//
// Each level adds exactly ONE strategic concept on top of the previous,
// so the ladder doubles as documentation of what "playing well" means in
// this game:
//
//   Lv1 ランダム   — legal moves at random. Baseline.
//   Lv2 テンポ型   — value-per-閃 greed: every 閃 of cast time should buy
//                    the most damage/block possible. No opponent reading.
//   Lv3 読み型     — reads the opponent's PUBLIC queue (the core mechanic):
//                    when do their attacks land, how much will pierce my
//                    decaying block? Blocks just-in-time instead of early
//                    (block decays 1/閃 — early block is wasted block),
//                    takes lethal when available, and protects its 連閃
//                    chain by not drawing while momentum is up. Also plans
//                    one commitment DEEPER (3 vs 2) — deep enough to build
//                    a setup chain and land heavy (prereq) cards, which
//                    Lv1/Lv2 structurally cannot reserve.
//   Lv4 先読み型   — rollout search: actually runs the deterministic
//                    reducer several 閃 into the future for each candidate
//                    action and picks the best outcome. The sim IS the
//                    evaluation function, so every mechanic (連閃, poison
//                    ticks, block decay, heavy-card scheduling) is priced
//                    in automatically.
//
// Reservations are LOCAL information by design — these policies only read
// the opponent's queue/visible state, never their reservation list.
//
// A policy is a per-frame function returning 0 (nothing) or an input flag.
// Policies receive a seed for reproducibility (used by tie-breaks).

import { CardEffect, getCardDef } from "../sim/cards";
import { isSurgeSen } from "../sim/events";
import { cardFlag, INPUT_DRAW, INPUT_RESET_RESERVATIONS } from "../sim/input";
import { canReserveCard, queueRemainingFrames, reservationSetupSen, step } from "../sim/reducer";
import { DT, FRAMES_PER_SEN, RENZAN_MAX_BONUS, RETSU_SEN_BONUS, SEC_PER_SEN } from "../sim/rules";
import { GameState, PlayerState, snapshot } from "../sim/state";

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
  // CRITICAL: skip slots that are already in the manual reservation list.
  // With left-click TOGGLE semantics, returning the same cardFlag for an
  // already-reserved slot would CANCEL the reservation — causing the AI
  // to oscillate (reserve → cancel → reserve → …) every single frame.
  const reservedSlots = new Set<number>();
  for (const r of p.reservations) {
    if (r.kind === "card") reservedSlots.add(r.slotIndex);
  }
  for (let i = 0; i < p.hand.length; i++) {
    if (reservedSlots.has(i)) continue;
    // canReserveCard is the SIM's own reservation gate (empty slot, status
    // junk, heavy-card prereq feasibility). Using it directly means the AI
    // never clicks something the sim would reject — a mismatch here would
    // make the AI spam doomed clicks every frame.
    if (!canReserveCard(p, i, now)) continue;
    out.push(i);
  }
  return out;
}

// Total committed actions = currently in queue + waiting in reservation
// list. Used as the AI's "I've already planned enough" cap so it doesn't
// keep stuffing cards into reservations every frame.
function committedCount(p: PlayerState): number {
  let n = 0;
  for (const q of p.queue) if (q.kind === "card") n++;
  for (const r of p.reservations) if (r.kind === "card") n++;
  return n;
}

// True if pressing Draw is sensible: an empty non-reserved slot exists and
// no draw is already queued/reserved.
function shouldDraw(p: PlayerState, playableCount: number): boolean {
  for (const q of p.queue) if (q.kind === "draw") return false;
  for (const r of p.reservations) if (r.kind === "draw") return false;
  const reserved = new Set<number>();
  for (const q of p.queue) {
    if (q.kind === "draw") {
      for (let k = q.drawFilledCount; k < q.drawSlots.length; k++) reserved.add(q.drawSlots[k]);
    }
  }
  for (const r of p.reservations) if (r.kind === "card") reserved.add(r.slotIndex);
  let emptyCount = 0;
  for (let i = 0; i < p.hand.length; i++) {
    if (p.hand[i] === null && !reserved.has(i)) emptyCount++;
  }
  if (emptyCount === 0) return false;
  return emptyCount >= 2 || playableCount === 0;
}

// Look up a card def from a (possibly empty) slot.
const slotDef = (p: PlayerState, i: number) => {
  const c = p.hand[i];
  return c === null ? null : getCardDef(c);
};

// ── combat model (mirrors reducer.attackDamage — the OLD policy model had
//    Weak backwards and didn't know about 連閃, so the AI mispriced every
//    attack) ──

function simDamage(base: number, p: PlayerState, o: PlayerState): number {
  const renzanBonus = Math.min(RENZAN_MAX_BONUS, Math.max(0, p.renzan - 1));
  let dmg = base + p.strength + renzanBonus;
  if (o.weakSecs > 0) dmg *= 2;
  if (o.vulnerableSecs > 0) dmg += Math.floor(dmg / 2); // 脆弱: 整数+50%
  return Math.max(0, dmg);
}

function damageOf(e: CardEffect, p: PlayerState, o: PlayerState): number {
  switch (e.kind) {
    case "Damage": return simDamage(e.amount, p, o);
    case "MultiHit": return simDamage(e.damage, p, o) * e.hits;
    case "BodySlam": return simDamage(p.block, p, o);
    case "Combo": return e.effects.reduce((s, x) => s + damageOf(x, p, o), 0);
    default: return 0;
  }
}

function blockOf(e: CardEffect, p?: PlayerState): number {
  switch (e.kind) {
    case "Block": return e.amount;
    case "DoubleBlock": return p ? p.block : 5;
    case "Combo": return e.effects.reduce((s, x) => s + blockOf(x, p), 0);
    default: return 0;
  }
}

function utilityOf(e: CardEffect): number {
  switch (e.kind) {
    case "Draw": return 2 * e.count;
    case "Strength": return 4 * e.amount;
    case "Vulnerable": return 3 * e.duration;
    case "Weak": return 2 * e.duration;
    case "Poison": return 1.2 * e.amount;
    case "Heal": return 0.5 * e.amount;
    case "Thorns": return 0.5 * e.amount;
    case "Combo": return e.effects.reduce((s, x) => s + utilityOf(x), 0);
    default: return 0;
  }
}

// ── threat model (Lv3+): the opponent's PUBLIC queue tells us exactly
//    when their attacks land. Reservations are local — not read. ──

interface Threat { t: number; dmg: number }

function incomingAttacks(o: PlayerState, me: PlayerState, now: number): Threat[] {
  const out: Threat[] = [];
  let end = o.castStartedAt;
  for (const q of o.queue) {
    end += q.duration;
    if (q.kind !== "card") continue;
    const def = getCardDef(q.cardId);
    if (!def) continue;
    const dmg = damageOf(def.effect, o, me);
    if (dmg > 0) out.push({ t: end - now, dmg });
  }
  return out;
}

// ── Lv0: passive ──

export const passive: PolicyFactory = () => () => 0;

// ── Lv1: random legal move ──

export const lv1Random: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  return (state, side) => {
    const p = state.players[side];
    if (committedCount(p) >= 2) return 0;
    const opts = playableIndices(p, state.frame * DT);
    if (shouldDraw(p, opts.length)) return INPUT_DRAW;
    if (opts.length === 0) return 0;
    return cardFlag(opts[Math.floor(r() * opts.length)]) ?? 0;
  };
};

// ── Lv2: tempo greed — best immediate value per 閃 of cast time ──

export const lv2Tempo: PolicyFactory = (seed = 1) => {
  const r = mulberry32(seed);
  return (state, side) => {
    const p = state.players[side], o = state.players[(side ^ 1) as 0 | 1];
    if (committedCount(p) >= 2) return 0;
    const opts = playableIndices(p, state.frame * DT);
    if (shouldDraw(p, opts.length)) return INPUT_DRAW;
    if (opts.length === 0) return 0;
    let bestI = opts[0], bestS = -Infinity;
    for (const i of opts) {
      const def = slotDef(p, i)!;
      const t = Math.max(1, def.cost);
      const s = (damageOf(def.effect, p, o) * 1.2 + blockOf(def.effect, p) * 0.8 + utilityOf(def.effect)) / t;
      if (s > bestS || (s === bestS && r() < 0.5)) { bestS = s; bestI = i; }
    }
    return cardFlag(bestI) ?? 0;
  };
};

// ── Lv3: tactical — queue reading, just-in-time block, lethal, 連閃 ──

// holdMaturing: treat 熟成 cards as investments — keep them out of the
// ordinary value-greed picks while other plays exist (lethal and the
// timed-block emergency can still spend them). Exposed as a parameter so
// the balance harness can measure the HOLD strategy's value by toggling
// it; gameplay levels always use the default (true).
export const lv3Tactical: (seed?: number, holdMaturing?: boolean) => Policy = (seed = 1, holdMaturing = true) => {
  const r = mulberry32(seed);
  return (state, side) => {
    const p = state.players[side], o = state.players[(side ^ 1) as 0 | 1];
    // Commitment discipline: plan 2 deep by default — deeper plans cost
    // the flexibility that just-in-time blocking depends on (committing 3
    // blind was MEASURABLY worse: 2/10 vs Lv2 in the ladder). The 3rd
    // slot is reserved for one thing only: completing a HEAVY play when
    // the setup is already in place and no threat is incoming.
    const committed = committedCount(p);
    if (committed >= 3) return 0;
    const now = state.frame * DT;
    const opts = playableIndices(p, now);

    // ① Lethal: if a single card finishes them through block, take it.
    let bestDmgIdx = -1, bestDmg = 0;
    for (const i of opts) {
      const def = slotDef(p, i)!;
      const dmg = damageOf(def.effect, p, o);
      if (dmg > bestDmg) { bestDmg = dmg; bestDmgIdx = i; }
    }
    if (bestDmgIdx >= 0 && bestDmg >= o.hp + o.block) return cardFlag(bestDmgIdx) ?? 0;

    // ② Threat read: when do their queued attacks land, and how much gets
    // through my block AFTER decay (block loses 1/閃)? Only worry about
    // hits inside a ~3閃 planning window past my own chain.
    const threats = incomingAttacks(o, p, now);
    const applySec = queueRemainingFrames(p, now) * DT; // when my next card's block goes up
    let unblocked = 0;
    for (const th of threats) {
      if (th.t > applySec + 3 * SEC_PER_SEN) continue;
      const myBlockThen = Math.max(0, p.block - Math.floor(th.t / SEC_PER_SEN));
      unblocked += Math.max(0, th.dmg - myBlockThen);
    }
    if (unblocked > 0) {
      // Pick the block card whose value SURVIVES until the hits land —
      // just-in-time blocking, not panic blocking.
      let bi = -1, bv = 0;
      for (const i of opts) {
        const def = slotDef(p, i)!;
        const b = blockOf(def.effect, p);
        if (b <= 0) continue;
        let v = 0;
        for (const th of threats) {
          if (th.t < applySec) continue; // lands before my block is up
          const decayed = Math.max(0, b - Math.floor((th.t - applySec) / SEC_PER_SEN));
          v += Math.min(th.dmg, decayed);
        }
        if (v > bv) { bv = v; bi = i; }
      }
      if (bi >= 0 && bv >= 3) return cardFlag(bi) ?? 0;
    }

    // ③ 使用期限 (use-it-or-lose-it): a card whose NEXT form is junk is
    // rotting — once it's within 1.5閃 of dying, play the most valuable
    // one NOW. This ranks ABOVE the commitment-discipline gate: saving a
    // dying bloom is exactly what the 3rd commitment slot is for (without
    // this ordering, blooms rotted away during busy stretches — measured
    // in self-play).
    const rotPending = (i: number) => {
      const d = slotDef(p, i)!;
      if (d.matureInto === undefined) return false;
      const next = getCardDef(d.matureInto);
      return next !== undefined && next.cost >= 900;
    };
    let rotI = -1, rotV = 0;
    for (const i of opts) {
      if (!rotPending(i)) continue;
      const d = slotDef(p, i)!;
      const remain = (d.matureSen ?? 0) * FRAMES_PER_SEN - (p.handAge[i] ?? 0);
      if (remain > 1.5 * FRAMES_PER_SEN) continue;
      const v = damageOf(d.effect, p, o) + blockOf(d.effect, p);
      if (v > rotV) { rotV = v; rotI = i; }
    }
    if (rotI >= 0) return cardFlag(rotI) ?? 0;

    // ④ Third commitment: ONLY to land a heavy (prereq) card whose setup
    // is complete, and only while nothing is incoming. Otherwise stay at
    // 2 and keep the block-reaction slot open.
    if (committed >= 2) {
      if (unblocked > 0) return 0;
      let hi = -1, hv = 0;
      for (const i of opts) {
        const def = slotDef(p, i)!;
        if ((def.prereqQueueTime ?? 0) <= 0) continue;
        const v = damageOf(def.effect, p, o) + blockOf(def.effect, p);
        if (v > hv) { hv = v; hi = i; }
      }
      return hi >= 0 ? (cardFlag(hi) ?? 0) : 0;
    }

    // ⑤ 連閃 protection: while momentum is up and we still hold playable
    // cards, do NOT draw (a resolving draw resets the chain).
    if (shouldDraw(p, opts.length) && !(p.renzan >= 2 && opts.length > 0)) return INPUT_DRAW;
    if (opts.length === 0) return 0;

    // ⑥ Otherwise: corrected value-per-閃 greed, with 熟成 strategy:
    //   hold (default) — keep upgrade-pending cards out of the greed pool
    //     while other plays exist; a card about to ROT must be spent.
    //   spend (holdMaturing=false, balance-harness arm) — play seeds on
    //     sight. The PURE opposite strategy, so the harness measures the
    //     value of waiting as the gap between the two arms.
    const isUpgradePending = (i: number) => {
      const d = slotDef(p, i)!;
      if (d.matureInto === undefined) return false;
      const next = getCardDef(d.matureInto);
      return next !== undefined && next.cost < 900;
    };
    let pool = opts;
    if (holdMaturing) {
      const nonHold = opts.filter((i) => !isUpgradePending(i));
      if (nonHold.length > 0) pool = nonHold;
    } else {
      const seeds = opts.filter(isUpgradePending);
      if (seeds.length > 0) pool = seeds;
    }
    // 烈閃合わせ: estimate when each candidate would RESOLVE (after my
    // queue + reservations + its own cast) and credit attacks that land
    // inside a surge 閃. Same read a human makes from the gold bands.
    const queueRemF = queueRemainingFrames(p, now);
    const resvSen = reservationSetupSen(p, p.reservations.length);
    let bestI = pool[0], bestS = -Infinity;
    for (const i of pool) {
      const def = slotDef(p, i)!;
      const t = Math.max(1, def.cost);
      let dmg = damageOf(def.effect, p, o);
      if (dmg > 0) {
        const resolveFrame = state.frame + queueRemF + (resvSen + def.cost) * FRAMES_PER_SEN;
        if (isSurgeSen(state.matchSeed, Math.floor(resolveFrame / FRAMES_PER_SEN))) {
          dmg += RETSU_SEN_BONUS;
        }
      }
      const s = (dmg * 1.3 + blockOf(def.effect, p) * 0.7 + utilityOf(def.effect)) / t;
      if (s > bestS || (s === bestS && r() < 0.5)) { bestS = s; bestI = i; }
    }
    return cardFlag(bestI) ?? 0;
  };
};

// ── Lv4: rollout planner — the deterministic sim IS the evaluator ──
//
// Each candidate action is applied to a snapshot, then the future is
// played out with BOTH sides driven by Lv3 — evaluating "what happens if
// everyone keeps playing competently", not "what happens if everyone goes
// limp" (an autopilot opponent model made Lv4 systematically overcommit,
// because nothing in its imagined future ever punished deep commitments).

// 8閃 horizon: long enough for a heavy play (2閃 setup + 2-3閃 cast) to
// actually RESOLVE inside the evaluation window — at 5閃 the planner kept
// paying for setups whose payoff it never saw.
const ROLLOUT_FRAMES = 8 * SEC_PER_SEN * 60;
const THINK_INTERVAL = 90;                   // re-plan at most every 1.5s
// A branch must beat the Lv3 baseline by this margin (≈HP) to override
// it — the eval is an approximation, and deviating on noise-level
// differences traded confirmed-good moves for speculative ones.
const DEVIATE_MARGIN = 1.5;

function rolloutScore(s: GameState, side: 0 | 1): number {
  const me = s.players[side], op = s.players[(side ^ 1) as 0 | 1];
  if (s.result !== 0) {
    if (s.result === 3) return 0;
    return (s.result === side + 1 ? 1 : -1) * 10000;
  }
  let handCards = 0;
  for (const c of me.hand) if (c !== null) handCards++;
  return (me.hp - op.hp)
    + 0.4 * (me.block - op.block)
    + 1.5 * (me.strength - op.strength)
    + 0.8 * (op.poison - me.poison)
    + 0.7 * me.renzan          // chain momentum keeps paying past the horizon
    + 0.3 * handCards;         // cards in hand = options
}

export const lv4Planner: PolicyFactory = (seed = 1) => {
  let nextThink = -1;
  const brain = lv3Tactical(seed); // anchored baseline — Lv4 is Lv3-plus
  return (state, side) => {
    const p = state.players[side];
    if (committedCount(p) >= 3) return 0;

    // Anchor: what would Lv3 do right now? Lv4 never plays WORSE than
    // this — the rollout only arbitrates between the baseline and a few
    // structurally different branches (big block / heavy / draw / wait).
    const baseline = brain(state, side);
    if (state.frame < nextThink && baseline === 0) return 0;
    nextThink = state.frame + THINK_INTERVAL;
    const now = state.frame * DT;

    // Branch candidates: baseline first (ties keep it), then the biggest
    // block, the biggest heavy, draw, and wait — only ones the sim gate
    // actually accepts, deduped.
    const o = state.players[(side ^ 1) as 0 | 1];
    let bestBlockFlag: number | null = null, bb = 0;
    let bestHeavyFlag: number | null = null, bh = 0;
    const reservedSlots = new Set<number>();
    for (const r of p.reservations) if (r.kind === "card") reservedSlots.add(r.slotIndex);
    for (let i = 0; i < p.hand.length; i++) {
      if (reservedSlots.has(i)) continue;
      if (!canReserveCard(p, i, now)) continue;
      const def = slotDef(p, i)!;
      const b = blockOf(def.effect, p);
      if (b > bb) { bb = b; bestBlockFlag = cardFlag(i); }
      if ((def.prereqQueueTime ?? 0) > 0) {
        const v = damageOf(def.effect, p, o) + blockOf(def.effect, p);
        if (v > bh) { bh = v; bestHeavyFlag = cardFlag(i); }
      }
    }
    const candidates: number[] = [baseline];
    for (const c of [bestBlockFlag, bestHeavyFlag, INPUT_DRAW, 0]) {
      if (c !== null && !candidates.includes(c)) candidates.push(c);
    }
    // Lv4's unique move: PLAN REVISION. Reservations are cancellable by
    // design — if the rollout says "scrap the current plan and rebuild"
    // clearly beats riding it out, press the reset. No other level ever
    // cancels.
    if (p.reservations.length > 0) candidates.push(INPUT_RESET_RESERVATIONS);
    if (candidates.length === 1) return baseline;

    // Roll each branch forward with the REAL reducer. The OPPONENT is
    // played by a fresh Lv3 (an autopilot enemy model made overcommitting
    // look free); our own side adds no further manual actions so the
    // branch's contribution stays isolated. Baseline wins ties.
    // Deterministic: same state → same rollouts → same choice.
    // Roll each branch forward with BOTH sides played by fresh Lv3
    // instances — "force this action now, then everyone keeps playing
    // competently". A frozen self-model systematically undervalued
    // chains/setups; an autopilot opponent made overcommitting look free.
    // The baseline anchor + tie-keeps-baseline prevents the wash-out
    // degeneracy (all-equal scores) from ever choosing "do nothing".
    let best = baseline, bestScore = -Infinity, baselineScore = -Infinity;
    for (const input of candidates) {
      const sim = snapshot(state);
      step(sim, side === 0 ? input : 0, side === 1 ? input : 0);
      const mySim = lv3Tactical(33), oppSim = lv3Tactical(11);
      const me0 = side === 0;
      for (let f = 0; f < ROLLOUT_FRAMES && sim.result === 0; f++) {
        const mi = mySim(sim, side);
        const oi = oppSim(sim, (side ^ 1) as 0 | 1);
        step(sim, me0 ? mi : oi, me0 ? oi : mi);
      }
      const sc = rolloutScore(sim, side);
      if (input === baseline) baselineScore = sc;
      if (sc > bestScore) { bestScore = sc; best = input; }
    }
    // Deviate from the Lv3 baseline only on a CLEAR win — noise-level
    // differences keep the confirmed-good move.
    if (best !== baseline && bestScore < baselineScore + DEVIATE_MARGIN) return baseline;
    return best;
  };
};

// ── registry ──
// Legacy keys (random/greedyAttack/greedyDefense/heuristic) are aliases so
// a stored localStorage selection from an older build keeps working.

export const policies: Record<string, PolicyFactory> = {
  passive,
  lv1: lv1Random,
  lv2: lv2Tempo,
  lv3: lv3Tactical,
  lv4: lv4Planner,
  random: lv1Random,
  greedyAttack: lv2Tempo,
  greedyDefense: lv2Tempo,
  heuristic: lv3Tactical,
};

// Display metadata — single source of truth for every screen that names
// AI levels (Title picker, gameplay header, lab dashboard).
export const AI_LEVELS: { key: string; label: string; desc: string }[] = [
  { key: "passive", label: "なし",          desc: "相手は何もしない (練習用)" },
  { key: "lv1",     label: "Lv1 ランダム",  desc: "出せる手から無作為にプレイ" },
  { key: "lv2",     label: "Lv2 テンポ型",  desc: "閃あたりの価値効率だけで選ぶ" },
  { key: "lv3",     label: "Lv3 読み型",    desc: "相手キューを読み、着弾に合わせてブロック" },
  { key: "lv4",     label: "Lv4 先読み型",  desc: "数閃先までシミュレートして最善手 (最強)" },
];

// Legacy stored keys (pre-ladder builds) → current level keys.
const LEGACY_KEYS: Record<string, string> = {
  random: "lv1", greedyDefense: "lv2", greedyAttack: "lv2", heuristic: "lv3",
};

/** Normalize a stored AI key: legacy aliases map to the current level key. */
export function normalizeAiKey(key: string): string {
  if (AI_LEVELS.some((l) => l.key === key)) return key;
  return LEGACY_KEYS[key] ?? "lv3";
}

/** Level key → display label (legacy keys normalized first). */
export function aiLabel(key: string): string {
  const k = normalizeAiKey(key);
  return AI_LEVELS.find((l) => l.key === k)?.label ?? k;
}
