import { CardId } from "./cards";
import { Rng } from "./rng";

// Status effect bag attached to a player. All scalar so JSON-clonable.
export interface PlayerState {
  handle: number;
  // Vitals
  hp: number;
  hpMax: number;
  block: number;
  thorns: number;
  // Resources
  cost: number;
  costRate: number;
  // Status (ducked)
  strength: number;
  vulnerableSecs: number;
  weakSecs: number;
  // Acceleration buff
  accelBonusRate: number;
  accelRemaining: number;
  // Persistent powers (each is independent)
  rage: { blockPerAttack: number; remaining: number } | null;
  metallicize: { blockPerSec: number } | null;
  demonForm: { strengthPerSec: number; accumulated: number } | null;
  barricade: boolean;
  juggernaut: { damageOnBlock: number } | null;
  combust: { selfPerSec: number; enemyPerSec: number } | null;
  darkEmbrace: { drawOnExhaust: number } | null;
  evolve: { drawOnStatus: number } | null;
  feelNoPain: { blockOnExhaust: number } | null;
  fireBreathing: { damageOnStatusDraw: number } | null;
  rupture: { strengthOnSelfDmg: number } | null;
  corruption: boolean;
  brutality: { selfPerSec: number; draw: number; interval: number; timer: number } | null;
  // Cards
  deck: CardId[];
  hand: CardId[];
  discard: CardId[];
  // Per-player RNG state for shuffling/drawing.
  rng: Rng;
  // Mid-match draft: when set, the player is being offered DRAFT_PICK_COUNT
  // cards to pick from. Resolves on input flag (INPUT_PICK_1..3) or expires
  // after DRAFT_TTL_SECS without a pick.
  offer: { cards: CardId[]; spawnedAt: number } | null;
  // Sim time (seconds) when the next draft offer becomes available.
  nextOfferAt: number;
}

export interface GameState {
  // Frame counter (each fixed step increments).
  frame: number;
  // Match-level seed (shared across peers).
  matchSeed: bigint;
  players: [PlayerState, PlayerState];
  // Game over: 0 = playing, 1 = p0 wins, 2 = p1 wins, 3 = draw
  result: 0 | 1 | 2 | 3;
}

const DEFAULT_PLAYER = (
  handle: number,
  costRate: number,
  hpMax: number,
  rngState: bigint,
  initialDeck: CardId[],
): PlayerState => ({
  handle,
  hp: hpMax,
  hpMax,
  block: 0,
  thorns: 0,
  cost: 0,
  costRate,
  strength: 0,
  vulnerableSecs: 0,
  weakSecs: 0,
  accelBonusRate: 0,
  accelRemaining: 0,
  rage: null,
  metallicize: null,
  demonForm: null,
  barricade: false,
  juggernaut: null,
  combust: null,
  darkEmbrace: null,
  evolve: null,
  feelNoPain: null,
  fireBreathing: null,
  rupture: null,
  corruption: false,
  brutality: null,
  deck: [...initialDeck],
  hand: [],
  discard: [],
  rng: { state: rngState },
  offer: null,
  nextOfferAt: 0, // overridden by initGame to DRAFT_FIRST_AT_SECS
});

export function makePlayer(
  handle: number,
  costRate: number,
  hpMax: number,
  rngState: bigint,
  deck: CardId[],
): PlayerState {
  return DEFAULT_PLAYER(handle, costRate, hpMax, rngState, deck);
}

// Deep-clone snapshot. JSON ops bail on bigint, so we manually walk.
export function snapshot(s: GameState): GameState {
  return {
    frame: s.frame,
    matchSeed: s.matchSeed,
    result: s.result,
    players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
  };
}

const clonePlayer = (p: PlayerState): PlayerState => ({
  ...p,
  offer: p.offer ? { cards: p.offer.cards.slice(), spawnedAt: p.offer.spawnedAt } : null,
  rage: p.rage ? { ...p.rage } : null,
  metallicize: p.metallicize ? { ...p.metallicize } : null,
  demonForm: p.demonForm ? { ...p.demonForm } : null,
  juggernaut: p.juggernaut ? { ...p.juggernaut } : null,
  combust: p.combust ? { ...p.combust } : null,
  darkEmbrace: p.darkEmbrace ? { ...p.darkEmbrace } : null,
  evolve: p.evolve ? { ...p.evolve } : null,
  feelNoPain: p.feelNoPain ? { ...p.feelNoPain } : null,
  fireBreathing: p.fireBreathing ? { ...p.fireBreathing } : null,
  rupture: p.rupture ? { ...p.rupture } : null,
  brutality: p.brutality ? { ...p.brutality } : null,
  deck: p.deck.slice(),
  hand: p.hand.slice(),
  discard: p.discard.slice(),
  rng: { state: p.rng.state },
});
