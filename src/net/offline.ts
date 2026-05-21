// Offline session: single peer, no networking, fixed-step sim.
//
// Either side (LocalPlayer / Opponent) can be driven by an AI policy. The
// most common cases:
//   - Neither policy set        → "practice dummy" (opponent does nothing).
//   - opponentPolicy = something → human plays vs CPU (the v1 release mode).
//   - both policies set         → AI-vs-AI spectator (handy for debugging and
//                                  watching balance changes ripple through).

import { CardId } from "../sim/cards";
import { initGame } from "../sim/init";
import { step } from "../sim/reducer";
import { fnv1a64 } from "../sim/rng";
import { INITIAL_HP } from "../sim/rules";
import { GameState } from "../sim/state";
import { Policy, PolicyFactory } from "../ai/policy";
import { Replay } from "../replay/format";

export interface OfflineOptions {
  deck: CardId[];
  hpMax?: number;
  onState?: (s: GameState) => void;
  /** Drive the OPPONENT side. Unset = idle dummy. */
  opponentPolicy?: PolicyFactory;
  /** Drive the LOCAL side too (spectator / AI-vs-AI mode). */
  selfPolicy?: PolicyFactory;
  /** Beginner mode: sim is FROZEN until the player calls advance(frames). */
  beginnerMode?: boolean;
}

export class OfflineSession {
  private state: GameState;
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private stopped = false;
  private pendingLocal = 0;
  readonly opts: OfflineOptions;
  // Recording: keep all non-zero inputs so we can rebuild a Replay on exit.
  private matchSeed: bigint;
  private recorded: { f: number; s: 0 | 1; flags: number }[] = [];
  // Instantiated AI closures (each holds its own seeded RNG + cooldown).
  private selfAi: Policy | null;
  private oppAi: Policy | null;

  constructor(opts: OfflineOptions) {
    this.opts = opts;
    this.matchSeed = fnv1a64(new TextEncoder().encode("offline-" + Math.random()));
    this.state = initGame({
      matchSeed: this.matchSeed,
      hpMax: opts.hpMax ?? INITIAL_HP,
      deckP0: opts.deck,
      deckP1: opts.deck,
    });
    // Each AI gets a stable seed derived from the match seed so a given
    // match plays out identically across reloads (useful for repro).
    const seedNum = Number(this.matchSeed & 0xffffffffn);
    this.selfAi = opts.selfPolicy?.(seedNum ^ 0x9e37) ?? null;
    this.oppAi = opts.opponentPolicy?.(seedNum ^ 0x4815) ?? null;
  }

  buildReplay(): Replay {
    return {
      version: 1,
      matchSeed: this.matchSeed.toString(16),
      hpMax: this.opts.hpMax ?? INITIAL_HP,
      deckP0: this.opts.deck,
      deckP1: this.opts.deck,
      inputs: this.recorded,
      finalFrame: this.state.frame,
      result: this.state.result,
      recordedAt: Date.now(),
    };
  }

  start() {
    this.last = performance.now();
    this.loop();
  }

  pushLocalInput(flags: number) {
    this.pendingLocal |= flags;
    // Beginner mode: clicks still register, but the sim doesn't advance
    // until the player presses "次の閃". Drain the click on the next tick
    // by giving a tiny budget so the input fires within one frame.
    if (this.opts.beginnerMode) this.frameBudget = Math.max(this.frameBudget, 1);
  }

  state_(): GameState { return this.state; }
  localPlayer(): 0 { return 0; }

  /** Beginner-mode controller. Advance N frames of sim. */
  advance(frames: number) {
    this.frameBudget += frames;
  }

  /** True if the loop is currently waiting for the player to advance time. */
  isFrozen(): boolean { return !!this.opts.beginnerMode && this.frameBudget <= 0; }

  // Beginner mode budget: number of remaining frames the sim is allowed to
  // step. Without beginner mode this is irrelevant (the loop steps based on
  // wall-clock time).
  private frameBudget = 0;

  private loop = () => {
    if (this.stopped) return;
    const now = performance.now();
    let elapsed = (now - this.last) / 1000;
    if (elapsed > 0.25) elapsed = 0.25;
    this.last = now;
    const dt = 1 / 60;
    if (this.opts.beginnerMode) {
      // Step only as many frames as the player explicitly granted.
      while (this.frameBudget > 0) {
        if (this.state.result !== 0) { this.frameBudget = 0; break; }
        this.tickOneFrame();
        this.frameBudget--;
      }
    } else {
      // Real-time mode.
      this.acc += elapsed;
      while (this.acc >= dt) {
        if (this.state.result !== 0) {
          this.acc -= dt;
          continue;
        }
        this.tickOneFrame();
        this.acc -= dt;
      }
    }
    this.opts.onState?.(this.state);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private tickOneFrame() {
    let local = this.pendingLocal;
    this.pendingLocal = 0;
    if (this.selfAi) {
      const ai = this.selfAi(this.state, 0);
      if (ai !== 0) local = ai;
    }
    const opp = this.oppAi ? this.oppAi(this.state, 1) : 0;
    if (local !== 0) this.recorded.push({ f: this.state.frame, s: 0, flags: local });
    if (opp   !== 0) this.recorded.push({ f: this.state.frame, s: 1, flags: opp });
    step(this.state, local, opp);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
  }
}
