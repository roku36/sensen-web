// Tunable game rules - 1:1 with src/game/rules.rs
export const INITIAL_HP = 1000;
export const DRAW_COUNT = 1;
export const MAX_HAND_SIZE = 10;
export const BLOCK_DECAY_RATE = 20.0;

// Fixed step (Hz) for deterministic rollback sim.
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

// Initial hand size.
export const INITIAL_HAND = 5;

// Input delay (frames) for rollback. Larger than Rust's value (2) because
// browsers run at variable RAF rates and WebRTC adds variable jitter even on
// localhost — a small delay would force constant rollbacks at the limit.
export const INPUT_DELAY = 6;

// Max rollback frames the engine will resimulate. 2 seconds @ 60Hz buys
// enough headroom for a 300ms RTT plus inter-peer frame skew.
export const MAX_ROLLBACK = 120;
