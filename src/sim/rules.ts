// Tunable game rules. Slay-the-Spire-shaped 80-HP scale so each card has
// perceptible weight; cards/numbers all rebalanced accordingly.

// ── Vitals ──
export const INITIAL_HP = 80;
export const MAX_HAND_SIZE = 10;

// ── Energy ──
// No hard cap — energy accumulates without ceiling, like the original Bevy
// version. The cost-rate alone is the throttle.
export const DEFAULT_COST_RATE = 0.4;

// ── Draw ──
export const DRAW_COUNT = 1;
export const DRAW_COST = 1.0;
export const INITIAL_HAND = 5;

// ── Block ──
// Linear decay (back to the original behavior). Tuned to ~2/s now that the
// scale is 1/10 of the old numbers — i.e. 5 Block lasts about 2.5s.
export const BLOCK_DECAY_RATE = 2.0;

// ── Post-victory card drafts ──
// On winning a match the player is offered DRAFT_PICK_COUNT cards drawn
// from a curated pool, picks one, and it's appended to their persisted
// deck. The pick is local-only (not sim-synced) — by the time it happens
// the match is over and the next sim starts from scratch with the new
// deck contents exchanged in the handshake.
export const DRAFT_PICK_COUNT = 3;

// ── Card return policy ──
// Slay-the-Spire-style: played cards go to the discard pile, NOT back into
// the deck, so deck cycling is meaningful instead of infinite-loops.
export const PLAYED_TO_DISCARD = true;

// ── Sim cadence ──
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

// ── Rollback ──
export const INPUT_DELAY = 6;
export const MAX_ROLLBACK = 120;
