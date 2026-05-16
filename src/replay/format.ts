// Replay file format.
//
// Records everything needed to reconstruct the match byte-for-byte by
// re-running the deterministic reducer: match seed, both decks, the sparse
// list of per-frame inputs.
//
// Sparse encoding: most frames have flags=0; we omit those. To replay, we
// step the reducer from frame 0 forward, looking up each frame's inputs in
// a Map (default 0).

import { CardId } from "../sim/cards";

export interface Replay {
  version: 1;
  /** Hex-encoded u64 matchSeed (bigint serialization). */
  matchSeed: string;
  hpMax: number;
  costRate: number;
  deckP0: CardId[];
  deckP1: CardId[];
  /** Compact per-input record. `s` is side (0|1), `flags` is input bitfield. */
  inputs: { f: number; s: 0 | 1; flags: number }[];
  finalFrame: number;
  /** 0=playing(timeout) 1=p0 wins 2=p1 wins 3=draw */
  result: number;
  /** Wall-clock timestamp the match was recorded at, for sorting/preview. */
  recordedAt: number;
}

export function encodeReplay(r: Replay): string {
  return JSON.stringify(r);
}

export function decodeReplay(json: string): Replay {
  const r = JSON.parse(json);
  if (r.version !== 1) throw new Error(`unsupported replay version: ${r.version}`);
  return r;
}

export function downloadReplay(r: Replay, filename = `sensen-replay-${Date.now()}.json`) {
  if (typeof window === "undefined") return;
  const blob = new Blob([encodeReplay(r)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
