// Headless match runner. Drives the deterministic reducer directly with two
// AI policies — no browser, no network, no rendering. ~1000 matches/sec on
// a typical laptop; suitable for balance reports over tens of thousands of
// matchups.

import { CardId } from "../sim/cards";
import { initGame } from "../sim/init";
import { step } from "../sim/reducer";
import { GameState } from "../sim/state";
import { Policy } from "./policy";

export interface MatchOptions {
  matchSeed: bigint;
  hpMax?: number;
  deckP0: CardId[];
  deckP1: CardId[];
  /** Cap so a stalled match (passive vs passive) doesn't loop forever. */
  maxFrames?: number;
  policyP0: Policy;
  policyP1: Policy;
}

export interface MatchResult {
  winner: 0 | 1 | "draw" | "timeout";
  frames: number;
  finalHp: [number, number];
  /** HP damage actually inflicted on each side (hpMax - hp). */
  damageTaken: [number, number];
  /** Total cards played by each side. */
  cardPlayCount: [number, number];
  /** Detail log of every play: (frame, side, cardId). */
  plays: { f: number; s: 0 | 1; c: CardId }[];
}

export function runMatch(opts: MatchOptions): MatchResult {
  const hpMax = opts.hpMax ?? 80;
  const maxFrames = opts.maxFrames ?? 60 * 180; // 3 minutes
  const s = initGame({
    matchSeed: opts.matchSeed, hpMax,
    deckP0: opts.deckP0, deckP1: opts.deckP1,
  });

  const plays: { f: number; s: 0 | 1; c: CardId }[] = [];
  const cardPlayCount: [number, number] = [0, 0];

  while (s.result === 0 && s.frame < maxFrames) {
    const before0 = s.players[0].hand.slice();
    const before1 = s.players[1].hand.slice();

    const i0 = opts.policyP0(s, 0);
    const i1 = opts.policyP1(s, 1);
    step(s, i0, i1);

    // Detect a card play per side (hand shrank by 1).
    detectPlay(s, 0, before0, plays, cardPlayCount);
    detectPlay(s, 1, before1, plays, cardPlayCount);
  }

  return {
    winner: s.result === 0 ? "timeout" : s.result === 1 ? 0 : s.result === 2 ? 1 : "draw",
    frames: s.frame,
    finalHp: [s.players[0].hp, s.players[1].hp],
    damageTaken: [hpMax - s.players[0].hp, hpMax - s.players[1].hp],
    cardPlayCount,
    plays,
  };
}

function detectPlay(
  s: GameState,
  side: 0 | 1,
  before: CardId[],
  plays: { f: number; s: 0 | 1; c: CardId }[],
  count: [number, number],
) {
  const after = s.players[side].hand;
  if (after.length !== before.length - 1) return;
  let removed: CardId | undefined;
  for (let j = 0; j < before.length; j++) {
    if (after[j] !== before[j]) { removed = before[j]; break; }
  }
  if (removed === undefined) removed = before[before.length - 1];
  plays.push({ f: s.frame, s: side, c: removed });
  count[side]++;
}

export interface BatchSummary {
  n: number;
  p0wins: number;
  p1wins: number;
  draws: number;
  timeouts: number;
  avgFrames: number;
  avgDamageInflictedP0: number; // by p0 to p1
  avgDamageInflictedP1: number;
  durationMs: number;
}

export function runBatch(
  n: number,
  factory: (matchSeed: bigint) => MatchOptions,
): { matches: MatchResult[]; summary: BatchSummary } {
  const t0 = Date.now();
  const matches: MatchResult[] = [];
  for (let i = 0; i < n; i++) {
    matches.push(runMatch(factory(BigInt(i) + 1n)));
  }
  let p0w = 0, p1w = 0, draws = 0, timeouts = 0;
  let frames = 0, dmgP0 = 0, dmgP1 = 0;
  for (const m of matches) {
    if (m.winner === 0) p0w++;
    else if (m.winner === 1) p1w++;
    else if (m.winner === "draw") draws++;
    else timeouts++;
    frames += m.frames;
    dmgP0 += m.damageTaken[1];
    dmgP1 += m.damageTaken[0];
  }
  return {
    matches,
    summary: {
      n, p0wins: p0w, p1wins: p1w, draws, timeouts,
      avgFrames: frames / n,
      avgDamageInflictedP0: dmgP0 / n,
      avgDamageInflictedP1: dmgP1 / n,
      durationMs: Date.now() - t0,
    },
  };
}
