import { CardId } from "./cards";
import { dealCards } from "./reducer";
import { seedForHandle } from "./rng";
import { INITIAL_HAND, nextDrawDelaySec } from "./rules";
import { GameState, makePlayer } from "./state";

export interface InitOptions {
  matchSeed: bigint;
  hpMax: number;
  deckP0: CardId[];
  deckP1: CardId[];
}

// Canonical initial state. Both peers must call this with identical InitOptions.
export function initGame(opts: InitOptions): GameState {
  const p0 = makePlayer(0, opts.hpMax, seedForHandle(opts.matchSeed, 0), opts.deckP0);
  const p1 = makePlayer(1, opts.hpMax, seedForHandle(opts.matchSeed, 1), opts.deckP1);
  const s: GameState = { frame: 0, matchSeed: opts.matchSeed, players: [p0, p1], result: 0 };
  dealCards(p0, INITIAL_HAND);
  dealCards(p1, INITIAL_HAND);
  // Anchor draw timer to the post-deal hand size (so we don't immediately
  // overfill at frame 0). nextDrawAt is in sim seconds; frame 0 is t=0.
  p0.nextDrawAt = nextDrawDelaySec(p0.hand.length);
  p1.nextDrawAt = nextDrawDelaySec(p1.hand.length);
  return s;
}
