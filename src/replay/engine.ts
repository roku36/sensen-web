// Replay engine: takes a recorded Replay and lets you scrub to any frame by
// re-stepping the deterministic reducer from frame 0. Snapshots every
// SNAPSHOT_INTERVAL frames so scrubbing backwards is also fast.

import { initGame } from "../sim/init";
import { step } from "../sim/reducer";
import { GameState, snapshot } from "../sim/state";
import { Replay } from "./format";

const SNAPSHOT_INTERVAL = 60; // 1s @ 60Hz

export class ReplayEngine {
  readonly replay: Replay;
  /** Per-frame input lookup [p0Flags, p1Flags]; both default to 0. */
  private inputs: Map<number, [number, number]> = new Map();
  /** Snapshots at frame % SNAPSHOT_INTERVAL == 0. */
  private snaps: Map<number, GameState> = new Map();
  /** Current playhead frame and corresponding state. */
  private cursor: number = 0;
  private state: GameState;

  constructor(replay: Replay) {
    this.replay = replay;
    for (const inp of replay.inputs) {
      const cur = this.inputs.get(inp.f) ?? [0, 0];
      cur[inp.s] |= inp.flags;
      this.inputs.set(inp.f, cur);
    }
    this.state = initGame({
      matchSeed: BigInt("0x" + replay.matchSeed),
      hpMax: replay.hpMax,
      deckP0: replay.deckP0,
      deckP1: replay.deckP1,
    });
    this.snaps.set(0, snapshot(this.state));
  }

  current(): GameState { return this.state; }
  cursorFrame(): number { return this.cursor; }
  totalFrames(): number { return this.replay.finalFrame; }

  /** Move the playhead exactly to `frame`. Uses nearest earlier snapshot. */
  seek(frame: number): GameState {
    frame = Math.max(0, Math.min(this.replay.finalFrame, Math.floor(frame)));
    if (frame === this.cursor) return this.state;
    // Find nearest snapshot <= frame.
    let base = 0;
    for (const k of this.snaps.keys()) if (k <= frame && k >= base) base = k;
    this.state = snapshot(this.snaps.get(base)!);
    // Step forward.
    while (this.state.frame < frame) {
      const inp = this.inputs.get(this.state.frame) ?? [0, 0];
      step(this.state, inp[0], inp[1]);
      if (this.state.frame % SNAPSHOT_INTERVAL === 0) {
        this.snaps.set(this.state.frame, snapshot(this.state));
      }
    }
    this.cursor = frame;
    return this.state;
  }

  /** Advance one frame from the current cursor (used by play-at-speed). */
  advanceOne(): GameState {
    if (this.cursor >= this.replay.finalFrame) return this.state;
    const inp = this.inputs.get(this.cursor) ?? [0, 0];
    step(this.state, inp[0], inp[1]);
    this.cursor = this.state.frame;
    if (this.cursor % SNAPSHOT_INTERVAL === 0 && !this.snaps.has(this.cursor)) {
      this.snaps.set(this.cursor, snapshot(this.state));
    }
    return this.state;
  }
}
