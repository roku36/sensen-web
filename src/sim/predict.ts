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

import { step } from "./reducer";
import { DT } from "./rules";
import { snapshot, GameState } from "./state";

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
  let lastBlock0 = s.players[0].block;
  let lastBlock1 = s.players[1].block;
  let lastPoison0 = s.players[0].poison;
  let lastPoison1 = s.players[1].poison;

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
    const b0 = s.players[0].block;
    const b1 = s.players[1].block;
    if (b0 !== lastBlock0) { out.p0Block.push({ t, block: b0 }); lastBlock0 = b0; }
    if (b1 !== lastBlock1) { out.p1Block.push({ t, block: b1 }); lastBlock1 = b1; }
    const po0 = s.players[0].poison;
    const po1 = s.players[1].poison;
    if (po0 !== lastPoison0) { out.p0Poison.push({ t, poison: po0 }); lastPoison0 = po0; }
    if (po1 !== lastPoison1) { out.p1Poison.push({ t, poison: po1 }); lastPoison1 = po1; }
    // Pierce detection: HP dropped on this frame. Attribute to attack only
    // if block ALSO dropped on this frame OR was 0 going in (i.e., the hit
    // had nowhere to be absorbed). Otherwise it's poison/combust ticks.
    const hpLost0 = beforeHp0 - s.players[0].hp;
    if (hpLost0 > 0 && (beforeBlock0 === 0 || s.players[0].block < beforeBlock0)) {
      // Subtract poison-tick contribution (if any).
      const poisonTick = beforePoison0; // poison damages BEFORE its own decrement
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
  // Final horizon cap so the UI can flatline to the right edge.
  const finalT = (s.frame - startFrame) * DT;
  if (out.p0Block[out.p0Block.length - 1].t < finalT) out.p0Block.push({ t: finalT, block: lastBlock0 });
  if (out.p1Block[out.p1Block.length - 1].t < finalT) out.p1Block.push({ t: finalT, block: lastBlock1 });
  if (out.p0Poison[out.p0Poison.length - 1].t < finalT) out.p0Poison.push({ t: finalT, poison: lastPoison0 });
  if (out.p1Poison[out.p1Poison.length - 1].t < finalT) out.p1Poison.push({ t: finalT, poison: lastPoison1 });

  return out;
}
