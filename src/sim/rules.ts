// Tunable game rules.
//
// Cast-time model (v2): there is no energy resource. Each card's `cost`
// value (in CardDef) is now its CAST TIME in seconds. When you click a card,
// it leaves your hand and goes into a cast slot; after `cost` seconds the
// effect resolves, the card goes to the discard pile, and one new card is
// drawn to refill the hand. Only one cast at a time per player. Both
// players' cast progress is publicly visible — read the opponent's cast bar
// to plan your next move.

// ── Vitals ──
export const INITIAL_HP = 80;
// Hand is fixed at 6 slots. We start dealt to 5 so there's an immediately
// available Draw target (slot 6) the player can practice with.
export const MAX_HAND_SIZE = 6;
export const INITIAL_HAND = 5;

// ── Draw action ──
// Pressing the Draw button reserves all currently-empty (non-pending) slots
// and fills them one per second: slot i fills at now + (i+1) * DRAW_SEC_PER_CARD.
// Drawing 3 cards = 3 sec total.
export const DRAW_SEC_PER_CARD = 1;

// How many recently-resolved cards to keep in the per-player history for the
// timeline UI (so a card you just cast stays visible — dimmed — to the left
// of the NOW line). Bounded for deterministic checksums.
export const RESOLVED_HISTORY_MAX = 8;

// ── Block ──
// Linear decay — 2 block per second.
export const BLOCK_DECAY_RATE = 2.0;

// ── Card return policy ──
// Slay-style: played cards go to the discard pile after their cast resolves.
export const PLAYED_TO_DISCARD = true;

// ── Sim cadence ──
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

// ── Rollback ──
export const INPUT_DELAY = 6;
export const MAX_ROLLBACK = 120;
