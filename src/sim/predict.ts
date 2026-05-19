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
// playable) still fires inside the sim, which is what we want — the user
// has already opted into that behavior.

import { step } from "./reducer";
import { DT } from "./rules";
import { snapshot, GameState } from "./state";

export interface BlockSample {
  /** Sim seconds RELATIVE to `from.frame * DT` (i.e., 0 = now). */
  t: number;
  block: number;
}

export interface PredictResult {
  p0: BlockSample[];
  p1: BlockSample[];
  /** When the predicted match would end (frame at which result became non-0), or null. */
  endsAtFrame: number | null;
}

/**
 * Snapshot `from` and run the reducer forward up to `horizonSec` seconds,
 * collecting block-change samples for each player. Returns sparse samples
 * (only frames where block actually changed) plus a final cap at horizon.
 *
 * Cost: ~horizonSec * 60 step() calls. For ~30 sec horizons that's ~1800
 * frames of sim; on modern hardware this is a few ms — call once per UI
 * frame and the cache layer above can decide whether to reuse.
 */
export function predictForward(from: GameState, horizonSec: number): PredictResult {
  const s = snapshot(from);
  const startFrame = s.frame;
  const startSec = startFrame * DT;
  const stopFrame = startFrame + Math.ceil(horizonSec / DT);

  const p0: BlockSample[] = [{ t: 0, block: s.players[0].block }];
  const p1: BlockSample[] = [{ t: 0, block: s.players[1].block }];
  let last0 = s.players[0].block;
  let last1 = s.players[1].block;
  let endsAtFrame: number | null = null;

  while (s.frame < stopFrame) {
    const wasPlaying = s.result === 0;
    step(s, 0, 0);
    if (wasPlaying && s.result !== 0) endsAtFrame = s.frame;
    const now0 = s.players[0].block;
    const now1 = s.players[1].block;
    if (now0 !== last0) {
      p0.push({ t: s.frame * DT - startSec, block: now0 });
      last0 = now0;
    }
    if (now1 !== last1) {
      p1.push({ t: s.frame * DT - startSec, block: now1 });
      last1 = now1;
    }
  }
  // Final horizon cap (so the UI can draw a flat segment to the right edge).
  const finalT = (s.frame - startFrame) * DT;
  if (p0[p0.length - 1].t < finalT) p0.push({ t: finalT, block: last0 });
  if (p1[p1.length - 1].t < finalT) p1.push({ t: finalT, block: last1 });

  return { p0, p1, endsAtFrame };
}
