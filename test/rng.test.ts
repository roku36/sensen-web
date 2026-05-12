import { describe, expect, it } from "vitest";
import { newRng, nextU64, seedForHandle, matchSeedFromPeers } from "../src/sim/rng";

describe("rng matches Rust deck.rs LCG", () => {
  // The Rust code uses:
  //   state = state.wrapping_mul(6364136223846793005).wrapping_add(1)
  // Starting from DEFAULT_DECK_SEED = 0x23d3_44d3_6f2a_7c15.
  // First few values were computed from the Rust formula directly.
  it("LCG sequence is bit-for-bit", () => {
    const r = newRng(0x23d344d36f2a7c15n);
    // Compute first three values explicitly with the same modular math.
    const M = 6364136223846793005n;
    const MASK = (1n << 64n) - 1n;
    let state = 0x23d344d36f2a7c15n;
    const expected: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      state = (state * M + 1n) & MASK;
      expected.push(state);
    }
    for (const e of expected) {
      expect(nextU64(r)).toBe(e);
    }
  });

  it("seedForHandle is symmetric across peers for the same handle index", () => {
    const matchSeed = matchSeedFromPeers(["alice", "bob"]);
    const seed0 = seedForHandle(matchSeed, 0);
    const seed1 = seedForHandle(matchSeed, 1);
    // Different handles must get different seeds.
    expect(seed0).not.toBe(seed1);
    // Calling again gives the same value.
    expect(seedForHandle(matchSeed, 0)).toBe(seed0);
  });

  it("matchSeedFromPeers is order-stable when peers sort the input", () => {
    const a = matchSeedFromPeers(["alice", "bob"]);
    const b = matchSeedFromPeers(["alice", "bob"]);
    expect(a).toBe(b);
    // Different order → different seed (so callers must sort first, which session.ts does).
    const c = matchSeedFromPeers(["bob", "alice"]);
    expect(c).not.toBe(a);
  });
});
