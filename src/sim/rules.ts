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

// ── 閃 (sen) unit ──
// 1 閃 = SEC_PER_SEN seconds. All card costs, prereqs and the block decay
// rate are expressed in INTEGER 閃 in card defs; the sim internally still
// uses seconds (because frame DT = 1/60 sec). Convert with senToSec.
export const SEC_PER_SEN = 3;
export const senToSec = (sen: number) => sen * SEC_PER_SEN;
export const secToSen = (sec: number) => sec / SEC_PER_SEN;

// ── Block ──
// Block decays in DISCRETE 1-unit steps, one tick per 閃 (= SEC_PER_SEN sec).
// When block changes (gain or hit), the decay timer is reset to "1 閃 from
// now" so a fresh stack always has a full 閃 before the first decrement.
export const BLOCK_DECAY_SEN_PER_STEP = 1;

// ── Poison ──
// Poison ticks once per 閃: deals (current poison) HP damage IGNORING block,
// then decrements poison by 1. Total damage from N poison = N*(N+1)/2.
// Heal cards subtract their amount from poison too.
export const POISON_DECAY_SEN_PER_STEP = 1;

// ── Draw action ──
// Pressing the Draw button appends a draw entry to the queue with duration =
// (count) × DRAW_SEN_PER_CARD 閃. Slot k fills castStartedAt + (k+1) 閃 in.
export const DRAW_SEN_PER_CARD = 1;

// Bounded history of recently-resolved cards.
export const RESOLVED_HISTORY_MAX = 8;

// How far back (in seconds) to keep per-player block samples for the UI's
// past visualization. Anything older gets pruned. Matches the timeline's
// visible HISTORY budget so the past area always has data to draw.
export const BLOCK_HISTORY_SEC = 18;

// Second-player advantages.
// The second-to-act player (handle 1) starts with this much block, and their
// cast clock is offset by SECOND_PLAYER_OFFSET_SEN 閃 — first card resolves
// half-an-閃 later than otherwise.
export const SECOND_PLAYER_INITIAL_BLOCK = 3;
export const SECOND_PLAYER_OFFSET_SEN = 0.5;

// ── Card return policy ──
// Slay-style: played cards go to the discard pile after their cast resolves.
export const PLAYED_TO_DISCARD = true;

// ── Sim cadence ──
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

// ── Rollback ──
export const INPUT_DELAY = 6;
export const MAX_ROLLBACK = 120;
