import { CardId } from "./cards";
import { Rng } from "./rng";
import { MAX_HAND_SIZE } from "./rules";

// A queue entry. Either a card cast OR a Draw action — both consume queue
// time the same way (head waits `duration` seconds before "resolving").
//
//   kind="card": ordinary card cast. cardId set.
//   kind="draw": refill action. drawSlots holds the snapshotted slot
//     indices (LOCKED at press time — playing a card from another slot
//     mid-cycle does not add that new empty to the targets). duration =
//     drawSlots.length (1 sec per card). While this entry is the head,
//     slots fill sequentially: drawSlots[k] is filled when the head's
//     elapsed time crosses (k+1) seconds. drawFilledCount tracks progress.
export type QueueEntry =
  | { kind: "card"; cardId: CardId; duration: number }
  | { kind: "draw"; drawSlots: number[]; drawFilledCount: number; duration: number };

// A card that recently resolved. Kept around so the timeline can show it as
// a dimmed chip drifting off to the left of the NOW line ("just played").
export interface ResolvedEntry {
  cardId: CardId;
  duration: number;
  // Sim seconds when this card finished casting. Always <= current `frame * DT`.
  resolvedAt: number;
}

export interface PlayerState {
  handle: number;
  // Vitals
  hp: number;
  hpMax: number;
  block: number;
  thorns: number;
  // Cast queue — head [0] is currently casting. Both peers see each other's
  // queue (it's part of GameState, so reproducible from inputs + seed).
  queue: QueueEntry[];
  // Sim seconds when the current head started casting. Advances by exactly
  // `duration` each time the head resolves (so any carry-over time rolls
  // forward into the next entry instead of being lost).
  castStartedAt: number;
  // Bounded history of recently-resolved cards (head pops). Newest at the END.
  resolvedCards: ResolvedEntry[];
  // Status durations (seconds remaining)
  strength: number;
  vulnerableSecs: number;
  weakSecs: number;
  // Persistent powers
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
  // Fixed-size 6-slot board (MAX_HAND_SIZE). null = empty (or reserved by a
  // pendingDraw entry, which is tracked separately). Slot index is stable
  // across plays — playing a card just sets hand[i] = null, never splices.
  hand: (CardId | null)[];
  discard: CardId[];
  // Per-player RNG state for shuffling/drawing.
  rng: Rng;
}

export interface GameState {
  frame: number;
  matchSeed: bigint;
  players: [PlayerState, PlayerState];
  result: 0 | 1 | 2 | 3;
}

const DEFAULT_PLAYER = (
  handle: number,
  hpMax: number,
  rngState: bigint,
  initialDeck: CardId[],
): PlayerState => ({
  handle,
  hp: hpMax,
  hpMax,
  block: 0,
  thorns: 0,
  queue: [],
  castStartedAt: 0,
  resolvedCards: [],
  strength: 0,
  vulnerableSecs: 0,
  weakSecs: 0,
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
  hand: Array.from({ length: MAX_HAND_SIZE }, () => null),
  discard: [],
  rng: { state: rngState },
});

export function makePlayer(
  handle: number,
  hpMax: number,
  rngState: bigint,
  deck: CardId[],
): PlayerState {
  return DEFAULT_PLAYER(handle, hpMax, rngState, deck);
}

// Deep-clone snapshot.
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
  queue: p.queue.map((q) => q.kind === "draw" ? { ...q, drawSlots: q.drawSlots.slice() } : { ...q }),
  resolvedCards: p.resolvedCards.map((r) => ({ ...r })),
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
