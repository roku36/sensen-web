// Tunable game rules. Rebalanced from the original 1000-HP scale to a
// Slay-the-Spire-shaped 80-HP scale so each card has perceptible weight and
// matches finish in 30–90 seconds of real-time play instead of dragging on.

// ── Vitals ──
// HP scaled down 12.5×: typical Strike now deals 6 instead of 60.
export const INITIAL_HP = 80;
export const MAX_HAND_SIZE = 10;

// ── Energy ──
// Hard cap so you can't park indefinitely waiting for a cost-3 finisher.
export const MAX_COST = 5.0;
// Default accumulation rate (per second). Slower than before so cost
// management has bite — choosing when to spend a 3-cost matters.
export const DEFAULT_COST_RATE = 0.6;

// ── Draw ──
// Drawing now costs a flat 1 energy regardless of hand size. The
// hand-size-as-cost rule was punishing in real-time play (impossible math
// while juggling threats) and discouraged drawing entirely.
export const DRAW_COUNT = 1;
export const DRAW_COST = 1.0;
export const INITIAL_HAND = 5;

// ── Block ──
// Exponential decay: block drops by half every BLOCK_HALF_LIFE seconds.
// This replaces linear 20/s decay which felt cliff-like — exponential lets
// the player visually track how much defense they have left.
export const BLOCK_HALF_LIFE = 4.0;
// derived rate constant: block(t) = block(0) * exp(-DECAY_K * t)
export const BLOCK_DECAY_K = Math.log(2) / BLOCK_HALF_LIFE;

// ── Status durations are seconds (unchanged semantically, but rebalanced) ──
// Vulnerable/Weak duration is now also in seconds; cards re-tuned below.

// ── Combo ──
// Re-playing the same card within COMBO_WINDOW seconds gets a discount.
export const COMBO_WINDOW = 2.0;
export const COMBO_DISCOUNT = 0.5; // 50% off the second copy

// ── Card return policy ──
// Slay-the-Spire-style: played cards go to the discard pile, NOT back into
// the deck. This forces meaningful deck cycling instead of infinite loops.
export const PLAYED_TO_DISCARD = true;

// ── Sim cadence ──
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

// ── Rollback ──
export const INPUT_DELAY = 6;
export const MAX_ROLLBACK = 120;
