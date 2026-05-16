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

// ── Mid-match card drafts ──
// Every DRAFT_INTERVAL_SECS, both players are offered DRAFT_PICK_COUNT
// random cards from a pool. They pick one with Z/X/C; the picked card
// goes into the discard pile and enters circulation through normal
// shuffle/draw. Picks expire after DRAFT_TTL_SECS.
//
// This adds Slay-the-Spire-style mid-combat deck building and breaks
// the symmetry of "both peers chose the same starter deck": even if
// loadouts began equal, picks diverge based on player choice.
export const DRAFT_INTERVAL_SECS = 20;
export const DRAFT_TTL_SECS = 8;
export const DRAFT_PICK_COUNT = 3;
// First draft fires this many seconds in (gives the match time to settle).
export const DRAFT_FIRST_AT_SECS = 12;

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
