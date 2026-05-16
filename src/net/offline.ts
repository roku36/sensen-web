// Offline session: single peer, no networking, fixed-step sim. Useful for local
// playtesting and as a fallback when no opponent is available.
//
// Mirrors src/game/mod.rs GameMode::Offline behavior — opponent exists but is
// idle (no AI in the original).

import { CardId } from "../sim/cards";
import { initGame } from "../sim/init";
import { step } from "../sim/reducer";
import { fnv1a64 } from "../sim/rng";
import { DEFAULT_COST_RATE, INITIAL_HP } from "../sim/rules";
import { GameState } from "../sim/state";

export interface OfflineOptions {
  deck: CardId[];
  hpMax?: number;
  costRate?: number;
  onState?: (s: GameState) => void;
}

export class OfflineSession {
  private state: GameState;
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private stopped = false;
  private pendingLocal = 0;
  readonly opts: OfflineOptions;

  constructor(opts: OfflineOptions) {
    this.opts = opts;
    const matchSeed = fnv1a64(new TextEncoder().encode("offline-" + Math.random()));
    this.state = initGame({
      matchSeed,
      hpMax: opts.hpMax ?? INITIAL_HP,
      costRate: opts.costRate ?? DEFAULT_COST_RATE,
      deckP0: opts.deck,
      deckP1: opts.deck,
    });
  }

  start() {
    this.last = performance.now();
    this.loop();
  }

  pushLocalInput(flags: number) { this.pendingLocal |= flags; }

  state_(): GameState { return this.state; }
  localPlayer(): 0 { return 0; }

  private loop = () => {
    if (this.stopped) return;
    const now = performance.now();
    let elapsed = (now - this.last) / 1000;
    if (elapsed > 0.25) elapsed = 0.25;
    this.last = now;
    this.acc += elapsed;
    const dt = 1 / 60;
    while (this.acc >= dt) {
      const local = this.pendingLocal;
      this.pendingLocal = 0;
      step(this.state, local, 0);
      this.acc -= dt;
    }
    this.opts.onState?.(this.state);
    this.rafId = requestAnimationFrame(this.loop);
  };

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
  }
}
