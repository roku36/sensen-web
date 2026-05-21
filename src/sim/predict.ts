// Future prediction = "run the actual reducer forward from a snapshot".
//
// The UI never re-implements sim logic. It calls predictForward() and gets
// per-frame samples of whatever state it wants to graph. New card effects,
// new powers, status decay, auto-reservation, anything that the reducer
// can do — all of it is reflected in the prediction automatically because
// it's the same reducer.
//
// Inputs are zeroed: we predict "what happens if neither player presses
// anything new right now". Auto-reservation (default Draw / leftmost
// playable + the player's own manual reservation list) still fires inside
// the sim, which is what we want — the user has already opted into that.
//
// Block / poison samples are emitted on a FIXED 0.5閃 grid relative to
// the start frame (plus the t=0 anchor and any transition during a grid
// interval). This stabilises what the UI receives — between grid points
// the data is constant, so any visual flicker is purely a rendering
// concern (positions still scroll smoothly as nowSec advances).

import { step } from "./reducer";
import { DT, SEC_PER_SEN } from "./rules";
import { snapshot, GameState } from "./state";

// Sample grid: one block/poison sample every 0.5 閃.
const SAMPLE_GRID_SEC = SEC_PER_SEN / 2;

export interface BlockSample {
  /** Sim seconds RELATIVE to `from.frame * DT` (i.e., 0 = now). */
  t: number;
  block: number;
}

export interface PoisonSample {
  t: number;
  poison: number;
}

export interface PierceEvent {
  /** Sim seconds RELATIVE to now (>= 0). */
  t: number;
  /** HP lost on this frame (after block absorbed what it could). */
  hpLost: number;
}

export interface PredictResult {
  p0Block: BlockSample[];
  p1Block: BlockSample[];
  p0Poison: PoisonSample[];
  p1Poison: PoisonSample[];
  /** Frames where opp's attack landed HP damage on p0 (block insufficient). */
  p0Pierces: PierceEvent[];
  p1Pierces: PierceEvent[];
  /** When the predicted match would end, or null. */
  endsAtFrame: number | null;
}

/**
 * Snapshot `from` and run the reducer forward up to `horizonSec` seconds.
 * Collects sparse block-change samples per player + HP-drop events (used
 * by the UI to draw "this attack landed and HURT" marks outside the block
 * band).
 *
 * HP drop is attributed to "attack pierce" only when the defender's block
 * also dropped to 0 OR was already 0 on that frame; otherwise we attribute
 * to passive damage (poison, combust, brutality) and skip the pierce mark.
 */
export function predictForward(from: GameState, horizonSec: number): PredictResult {
  const s = snapshot(from);
  const startFrame = s.frame;
  const startSec = startFrame * DT;
  const stopFrame = startFrame + Math.ceil(horizonSec / DT);

  const out: PredictResult = {
    p0Block: [{ t: 0, block: s.players[0].block }],
    p1Block: [{ t: 0, block: s.players[1].block }],
    p0Poison: [{ t: 0, poison: s.players[0].poison }],
    p1Poison: [{ t: 0, poison: s.players[1].poison }],
    p0Pierces: [],
    p1Pierces: [],
    endsAtFrame: null,
  };
  // The latest grid index emitted for each (player, channel). We emit a
  // new sample only after the sim has crossed the NEXT grid boundary.
  let p0BlockGridIdx = 0;
  let p1BlockGridIdx = 0;
  let p0PoisonGridIdx = 0;
  let p1PoisonGridIdx = 0;

  while (s.frame < stopFrame) {
    const beforeHp0 = s.players[0].hp;
    const beforeHp1 = s.players[1].hp;
    const beforeBlock0 = s.players[0].block;
    const beforeBlock1 = s.players[1].block;
    const beforePoison0 = s.players[0].poison;
    const beforePoison1 = s.players[1].poison;
    const wasPlaying = s.result === 0;
    step(s, 0, 0);
    if (wasPlaying && s.result !== 0) out.endsAtFrame = s.frame;
    const t = s.frame * DT - startSec;
    // Emit one block/poison sample per 0.5 閃 boundary crossed. We use the
    // CURRENT-frame values: between grid points the visualization is
    // step-constant, which matches the reducer (block decays in whole
    // units on 閃 boundaries anyway).
    const gridIdx = Math.floor(t / SAMPLE_GRID_SEC + 1e-9);
    if (gridIdx > p0BlockGridIdx) {
      out.p0Block.push({ t: gridIdx * SAMPLE_GRID_SEC, block: s.players[0].block });
      p0BlockGridIdx = gridIdx;
    }
    if (gridIdx > p1BlockGridIdx) {
      out.p1Block.push({ t: gridIdx * SAMPLE_GRID_SEC, block: s.players[1].block });
      p1BlockGridIdx = gridIdx;
    }
    if (gridIdx > p0PoisonGridIdx) {
      out.p0Poison.push({ t: gridIdx * SAMPLE_GRID_SEC, poison: s.players[0].poison });
      p0PoisonGridIdx = gridIdx;
    }
    if (gridIdx > p1PoisonGridIdx) {
      out.p1Poison.push({ t: gridIdx * SAMPLE_GRID_SEC, poison: s.players[1].poison });
      p1PoisonGridIdx = gridIdx;
    }
    // Pierce detection: HP dropped on this frame and block also took a hit
    // (or was already 0). Stays frame-precise so the red mark appears at
    // the exact resolution moment, not snapped to a grid line.
    const hpLost0 = beforeHp0 - s.players[0].hp;
    if (hpLost0 > 0 && (beforeBlock0 === 0 || s.players[0].block < beforeBlock0)) {
      const poisonTick = beforePoison0;
      const attackHp = Math.max(0, hpLost0 - (s.players[0].poison < beforePoison0 ? poisonTick : 0));
      if (attackHp > 0) out.p0Pierces.push({ t, hpLost: attackHp });
    }
    const hpLost1 = beforeHp1 - s.players[1].hp;
    if (hpLost1 > 0 && (beforeBlock1 === 0 || s.players[1].block < beforeBlock1)) {
      const poisonTick = beforePoison1;
      const attackHp = Math.max(0, hpLost1 - (s.players[1].poison < beforePoison1 ? poisonTick : 0));
      if (attackHp > 0) out.p1Pierces.push({ t, hpLost: attackHp });
    }
  }
  // Horizon cap.
  const finalT = (s.frame - startFrame) * DT;
  const cap = (arr: { t: number; block?: number; poison?: number }[], v: number, key: "block" | "poison") => {
    const last = arr[arr.length - 1];
    if (last.t < finalT) {
      arr.push(key === "block" ? { t: finalT, block: v } as never : { t: finalT, poison: v } as never);
    }
  };
  cap(out.p0Block, s.players[0].block, "block");
  cap(out.p1Block, s.players[1].block, "block");
  cap(out.p0Poison, s.players[0].poison, "poison");
  cap(out.p1Poison, s.players[1].poison, "poison");
  return out;
}
