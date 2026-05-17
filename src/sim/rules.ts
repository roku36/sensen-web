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
// 200 HP keeps match length roughly comparable to the old energy model.
// (Under the old 0.4-energy/sec rule a cost-1 Strike cycled every ~2.5s;
// under cast-time it cycles every 1s, so HP needed ~2.5× compensation.)
export const INITIAL_HP = 200;
export const MAX_HAND_SIZE = 10;
export const INITIAL_HAND = 5;

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
