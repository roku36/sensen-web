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
// Block / poison samples are emitted whenever the value CHANGES — that
// way the sample's relative-to-now `t` matches the actual event time in
// the sim, and the UI polygon scrolls left smoothly with the queue chips
// instead of being snapped to an artificial grid.

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
  /**
   * Absolute sim seconds of the snapshot this prediction was computed from.
   * Sample `t`s are relative to THIS time, not to "now". The sim is
   * deterministic and autonomous (zero inputs), so a trajectory computed at
   * baseSec stays valid until the underlying state actually changes — the
   * UI converts with `rel = (baseSec + t) - now` each render instead of
   * re-simulating every frame.
   */
  baseSec: number;
  p0Block: BlockSample[];
  p1Block: BlockSample[];
  p0Poison: PoisonSample[];
  p1Poison: PoisonSample[];
  /** Frames where opp's attack landed HP damage on p0 (block insufficient). */
  p0Pierces: PierceEvent[];
  p1Pierces: PierceEvent[];
  /**
   * Per-reservation CONFIRM times: p0ResFires[i] is the sim time (relative
   * to baseSec) at which reservations[i] (index at snapshot time) leaves
   * the list — fired into the queue or self-dropped. Reservations only
   * shrink head-first under zero inputs, so the k-th removal IS index k.
   * Used by the UI to mark when a ghost chip will lock in (確定).
   */
  p0ResFires: number[];
  p1ResFires: number[];
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
  // オートパイロット廃止後、シムと予測の意味論は完全に一致する:
  // 無入力の未来 = プレイヤーの明示的なプランだけが進行する未来。
  const startFrame = s.frame;
  const startSec = startFrame * DT;
  const stopFrame = startFrame + Math.ceil(horizonSec / DT);

  const out: PredictResult = {
    baseSec: startSec,
    p0Block: [{ t: 0, block: s.players[0].block }],
    p1Block: [{ t: 0, block: s.players[1].block }],
    p0Poison: [{ t: 0, poison: s.players[0].poison }],
    p1Poison: [{ t: 0, poison: s.players[1].poison }],
    p0Pierces: [],
    p1Pierces: [],
    p0ResFires: [],
    p1ResFires: [],
    endsAtFrame: null,
  };
  let last0 = s.players[0].block;
  let last1 = s.players[1].block;
  let lastPo0 = s.players[0].poison;
  let lastPo1 = s.players[1].poison;

  while (s.frame < stopFrame) {
    const beforeHp0 = s.players[0].hp;
    const beforeHp1 = s.players[1].hp;
    const beforeBlock0 = s.players[0].block;
    const beforeBlock1 = s.players[1].block;
    const beforePoison0 = s.players[0].poison;
    const beforePoison1 = s.players[1].poison;
    const beforeRes0 = s.players[0].reservations.length;
    const beforeRes1 = s.players[1].reservations.length;
    const wasPlaying = s.result === 0;
    step(s, 0, 0);
    if (wasPlaying && s.result !== 0) out.endsAtFrame = s.frame;
    // Event-precise sampling: emit a sample only when the value changed.
    // sample.t = (s.frame * DT - startSec) is the RELATIVE time from the
    // snapshot. As the caller re-runs predict each frame with a fresh
    // snapshot, these relative times shift smoothly with `now`, so the
    // polygon scrolls left in lockstep with the queue chips.
    const t = s.frame * DT - startSec;
    // Reservation confirms: each head-removal this frame fires at `t`.
    for (let k = s.players[0].reservations.length; k < beforeRes0; k++) out.p0ResFires.push(t);
    for (let k = s.players[1].reservations.length; k < beforeRes1; k++) out.p1ResFires.push(t);
    const b0 = s.players[0].block;
    if (b0 !== last0) { out.p0Block.push({ t, block: b0 }); last0 = b0; }
    const b1 = s.players[1].block;
    if (b1 !== last1) { out.p1Block.push({ t, block: b1 }); last1 = b1; }
    const po0 = s.players[0].poison;
    if (po0 !== lastPo0) { out.p0Poison.push({ t, poison: po0 }); lastPo0 = po0; }
    const po1 = s.players[1].poison;
    if (po1 !== lastPo1) { out.p1Poison.push({ t, poison: po1 }); lastPo1 = po1; }
    // Pierce: HP dropped on this frame AND block also took a hit (or was 0).
    const hpLost0 = beforeHp0 - s.players[0].hp;
    if (hpLost0 > 0 && (beforeBlock0 === 0 || s.players[0].block < beforeBlock0)) {
      const attackHp = Math.max(0, hpLost0 - (s.players[0].poison < beforePoison0 ? beforePoison0 : 0));
      if (attackHp > 0) out.p0Pierces.push({ t, hpLost: attackHp });
    }
    const hpLost1 = beforeHp1 - s.players[1].hp;
    if (hpLost1 > 0 && (beforeBlock1 === 0 || s.players[1].block < beforeBlock1)) {
      const attackHp = Math.max(0, hpLost1 - (s.players[1].poison < beforePoison1 ? beforePoison1 : 0));
      if (attackHp > 0) out.p1Pierces.push({ t, hpLost: attackHp });
    }
  }
  // Horizon cap so the UI can extend a flat tail to the right edge.
  const finalT = (s.frame - startFrame) * DT;
  if (out.p0Block[out.p0Block.length - 1].t < finalT) out.p0Block.push({ t: finalT, block: last0 });
  if (out.p1Block[out.p1Block.length - 1].t < finalT) out.p1Block.push({ t: finalT, block: last1 });
  if (out.p0Poison[out.p0Poison.length - 1].t < finalT) out.p0Poison.push({ t: finalT, poison: lastPo0 });
  if (out.p1Poison[out.p1Poison.length - 1].t < finalT) out.p1Poison.push({ t: finalT, poison: lastPo1 });
  return out;
}
