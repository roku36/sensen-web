import { CardId } from "./cards";
import { dealCards } from "./reducer";
import { seedForHandle } from "./rng";
import {
  INITIAL_HAND,
  SECOND_PLAYER_INITIAL_BLOCK,
  SECOND_PLAYER_OFFSET_SEN,
  senToSec,
} from "./rules";
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
  // Second-player advantage: starts with bonus block, and their cast clock
  // is offset 0.5 閃 into the future — when both players simultaneously
  // queue a 1-閃 card, p0 resolves at t=1閃, p1 resolves at t=1.5閃.
  p1.block = SECOND_PLAYER_INITIAL_BLOCK;
  p1.castStartedAt = senToSec(SECOND_PLAYER_OFFSET_SEN);
  return s;
}
