// Rollback engine.
//
// Design (mirrors bevy_ggrs at the conceptual level):
//   - Each peer runs the same pure reducer at a fixed step (SIM_HZ).
//   - Local inputs are tagged with the frame they target (current + INPUT_DELAY).
//   - Remote inputs are predicted (default: repeat last received input).
//   - Each peer snapshots state every frame and keeps the last MAX_ROLLBACK frames.
//   - When a remote input arrives for an old frame, if it differs from the
//     prediction, we restore the snapshot at that frame and re-step forward
//     using the corrected inputs. This is "resimulate".
//   - We periodically exchange a checksum of the confirmed state. A mismatch is
//     a desync; we surface it (and stop the match) instead of silently drifting.
//
// This keeps both peers' damage/HP/deck/status bit-identical as long as the
// reducer is deterministic — which it is, because all RNG is seeded and all
// math is in plain JS numbers with the same operation order on every machine.

import { checksum as checksumOf } from "../sim/checksum";
import { initGame, InitOptions } from "../sim/init";
import { step } from "../sim/reducer";
import { INPUT_DELAY, MAX_ROLLBACK } from "../sim/rules";
import { GameState, snapshot } from "../sim/state";

export interface RollbackOptions extends InitOptions {
  localPlayer: 0 | 1;
}

export type RollbackEvent =
  | { kind: "advanced"; frame: number; state: GameState }
  | { kind: "rolled-back"; from: number; to: number }
  | { kind: "desync"; frame: number; localChecksum: bigint; remoteChecksum: bigint };

type Listener = (e: RollbackEvent) => void;

// Inputs are stored per-frame, per-player. `confirmed[i]` = peer-confirmed input,
// `predicted[i]` = our best guess used while waiting for confirmation.
export class RollbackEngine {
  readonly opts: RollbackOptions;
  private state: GameState;
  // Snapshots[frame] = state AT BEGINNING of that frame (before step).
  private snaps: Map<number, GameState> = new Map();
  private confirmed: Array<[number | undefined, number | undefined]> = []; // confirmed[frame] = [p0, p1]
  private predicted: Array<[number, number]> = [];
  private lastConfirmedFrame: [number, number] = [-1, -1];
  private listeners: Listener[] = [];

  constructor(opts: RollbackOptions) {
    this.opts = opts;
    this.state = initGame(opts);
    this.snaps.set(0, snapshot(this.state));
  }

  on(fn: Listener) { this.listeners.push(fn); }

  current(): GameState { return this.state; }
  frame(): number { return this.state.frame; }
  localPlayer(): 0 | 1 { return this.opts.localPlayer; }

  // Checksum of the snapshot stored at a specific past frame (or null if it was
  // already GC'd or never reached). Used by tests to compare the SAME frame
  // across peers, eliminating false-positive mismatches from frame skew.
  checksumAt(frame: number): bigint | null {
    const snap = this.snaps.get(frame);
    if (!snap) return null;
    return checksumOf(snap);
  }

  // How many frames ahead of the remote peer's confirmed inputs we are.
  // Session loop uses this to stall when we get too far ahead, keeping skew
  // bounded so rollback can always recover.
  framesAhead(): number {
    const remote = this.opts.localPlayer === 0 ? 1 : 0;
    return this.frame() - this.lastConfirmedFrame[remote];
  }

  // Local player called: enqueue THIS frame's input. With INPUT_DELAY, the
  // input takes effect on (current_frame + INPUT_DELAY).
  pushLocalInput(flags: number): { frame: number; flags: number } {
    const targetFrame = this.frame() + INPUT_DELAY;
    this.ensureFrame(targetFrame);
    this.confirmed[targetFrame][this.opts.localPlayer] = flags;
    return { frame: targetFrame, flags };
  }

  // Remote peer called: a remote input was received via DataChannel.
  // If it disagrees with our prediction for that frame, schedule a rollback.
  receiveRemoteInput(frame: number, flags: number) {
    const remote = this.opts.localPlayer === 0 ? 1 : 0;
    this.ensureFrame(frame);
    this.confirmed[frame][remote] = flags;
    if (frame > this.lastConfirmedFrame[remote]) this.lastConfirmedFrame[remote] = frame;

    // Did we already simulate past this frame with the wrong prediction?
    if (frame < this.frame()) {
      const wasPredicted = this.predicted[frame]?.[remote];
      if (wasPredicted !== flags) {
        this.rollbackAndResim(frame);
      }
    }
  }

  // Peer-supplied checksum for `frame`. If it differs from ours, emit desync.
  receiveChecksum(frame: number, remoteChecksum: bigint) {
    const snap = this.snaps.get(frame);
    if (!snap) return;
    const local = checksumOf(snap);
    if (local !== remoteChecksum) {
      this.emit({ kind: "desync", frame, localChecksum: local, remoteChecksum });
    }
  }

  // Advance one frame. Uses confirmed-or-predicted inputs.
  advance() {
    const frame = this.frame();
    this.ensureFrame(frame);
    this.snaps.set(frame, snapshot(this.state));
    this.gcSnapshots(frame);

    const remote = this.opts.localPlayer === 0 ? 1 : 0;
    const localFlags = this.confirmed[frame][this.opts.localPlayer] ?? 0;
    let remoteFlags: number;
    if (this.confirmed[frame][remote] !== undefined) {
      remoteFlags = this.confirmed[frame][remote]!;
    } else {
      // Predict: repeat last received remote input. Since most frames have no
      // input (button presses are sparse), prediction is "0" by default after
      // a press — which is correct most of the time.
      const lastConfirmed = this.lastConfirmedFrame[remote];
      const lastFlags = lastConfirmed >= 0 ? (this.confirmed[lastConfirmed][remote] ?? 0) : 0;
      // After a press, next-frame prediction should be 0 (presses don't repeat).
      remoteFlags = lastConfirmed >= frame - 1 ? 0 : lastFlags & 0; // = 0
    }
    this.predicted[frame] = this.opts.localPlayer === 0 ? [localFlags, remoteFlags] : [remoteFlags, localFlags];
    const inputs = this.predicted[frame];

    step(this.state, inputs[0], inputs[1]);
    this.emit({ kind: "advanced", frame: this.state.frame, state: this.state });
  }

  // Replace current state with the snapshot at `frame` and re-step forward to
  // the current frame using the now-known inputs. Bounded by MAX_ROLLBACK.
  private rollbackAndResim(frame: number) {
    const distance = this.frame() - frame;
    if (distance > MAX_ROLLBACK) {
      this.emit({ kind: "desync", frame, localChecksum: 0n, remoteChecksum: 0n });
      return;
    }
    const snap = this.snaps.get(frame);
    if (!snap) {
      // Snapshot was GC'd before we could roll back. Treat as unrecoverable.
      this.emit({ kind: "desync", frame, localChecksum: 0n, remoteChecksum: 0n });
      return;
    }
    const targetFrame = this.frame();

    this.state = snapshot(snap);
    this.emit({ kind: "rolled-back", from: targetFrame, to: frame });

    while (this.state.frame < targetFrame) {
      const f = this.state.frame;
      this.snaps.set(f, snapshot(this.state));
      const remote = this.opts.localPlayer === 0 ? 1 : 0;
      const localFlags = this.confirmed[f][this.opts.localPlayer] ?? 0;
      const remoteFlags = this.confirmed[f][remote] ?? 0;
      this.predicted[f] = this.opts.localPlayer === 0 ? [localFlags, remoteFlags] : [remoteFlags, localFlags];
      step(this.state, this.predicted[f][0], this.predicted[f][1]);
    }
  }

  private ensureFrame(frame: number) {
    while (this.confirmed.length <= frame) {
      this.confirmed.push([undefined, undefined]);
      this.predicted.push([0, 0]);
    }
  }

  private gcSnapshots(currentFrame: number) {
    const cutoff = currentFrame - MAX_ROLLBACK - 1;
    if (cutoff <= 0) return;
    for (const k of this.snaps.keys()) {
      if (k < cutoff) this.snaps.delete(k);
    }
  }

  private emit(e: RollbackEvent) { for (const fn of this.listeners) fn(e); }
}
