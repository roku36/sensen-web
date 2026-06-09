// Headless self-play runner for the AI lab dashboard.
//
// Runs a full deterministic match (no rendering, no session) between a
// tested AI level and the Lv1 baseline, recording every non-zero input so
// the match can be replayed byte-for-byte in the existing ReplayViewer.

import { policies } from "../ai/policy";
import { Replay } from "../replay/format";
import { createTestDeck } from "../sim/cards";
import { initGame } from "../sim/init";
import { step } from "../sim/reducer";

export const LAB_FRAME_CAP = 5400; // 90s of sim time

export interface LabMatch {
  id: string;
  /** Tested level key (lv1..lv4). Opponent is always lv1. */
  level: string;
  /** Which side the tested level played (alternates to cancel side advantage). */
  side: 0 | 1;
  /** Sim result: 0 timeout, 1 p0 win, 2 p1 win, 3 draw. */
  result: number;
  /** Outcome from the TESTED level's perspective. */
  won: boolean;
  draw: boolean;
  finalFrame: number;
  recordedAt: number;
  replay: Replay;
}

/** Run one headless match: `level` (on `side`) vs lv1. Deterministic per seed. */
export function runLabMatch(level: string, seed: bigint, side: 0 | 1): LabMatch {
  const deck = createTestDeck();
  const s = initGame({ matchSeed: seed, hpMax: 80, deckP0: deck, deckP1: deck });
  const seedNum = Number(seed & 0xffffn);
  const tested = (policies[level] ?? policies.lv1)(seedNum ^ 0x1111);
  const baseline = policies.lv1(seedNum ^ 0x2222);
  const p0 = side === 0 ? tested : baseline;
  const p1 = side === 0 ? baseline : tested;

  const inputs: Replay["inputs"] = [];
  for (let f = 0; f < LAB_FRAME_CAP && s.result === 0; f++) {
    const i0 = p0(s, 0);
    const i1 = p1(s, 1);
    if (i0 !== 0) inputs.push({ f: s.frame, s: 0, flags: i0 });
    if (i1 !== 0) inputs.push({ f: s.frame, s: 1, flags: i1 });
    step(s, i0, i1);
  }

  // Timeout fallback: decide the lab outcome by remaining HP (the replay
  // keeps result=0 — that's what actually happened in the sim).
  let winnerSide: 0 | 1 | null = null;
  if (s.result === 1) winnerSide = 0;
  else if (s.result === 2) winnerSide = 1;
  else if (s.result === 0) {
    const d = s.players[0].hp - s.players[1].hp;
    winnerSide = d === 0 ? null : d > 0 ? 0 : 1;
  }

  const replay: Replay = {
    version: 1,
    matchSeed: seed.toString(16),
    hpMax: 80,
    deckP0: deck,
    deckP1: deck,
    inputs,
    finalFrame: s.frame,
    result: s.result,
    recordedAt: Date.now(),
  };
  return {
    id: `${level}-${seed.toString(16)}-${side}`,
    level,
    side,
    result: s.result,
    won: winnerSide === side,
    draw: winnerSide === null,
    finalFrame: s.frame,
    recordedAt: replay.recordedAt,
    replay,
  };
}
