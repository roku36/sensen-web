// Deterministic LCG matching src/game/deck.rs:
//   state = state.wrapping_mul(6364136223846793005).wrapping_add(1)
// We need u64 wrapping semantics; JS Number can't do this safely, so we use BigInt with mask.

const MASK_64 = (1n << 64n) - 1n;
const MUL = 6364136223846793005n;
const ADD = 1n;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

const DEFAULT_DECK_SEED = 0x23d3_44d3_6f2a_7c15n;
const SEED_MIX = 0x9e3779b97f4a7c15n;

export type Rng = { state: bigint };

export const newRng = (seed: bigint): Rng => ({ state: seed & MASK_64 });

export function nextU64(r: Rng): bigint {
  r.state = (r.state * MUL + ADD) & MASK_64;
  return r.state;
}

export function rangeU64(r: Rng, modulus: bigint): bigint {
  if (modulus <= 0n) return 0n;
  return nextU64(r) % modulus;
}

export function seedForHandle(matchSeed: bigint, handle: number): bigint {
  const h = BigInt(handle);
  return (DEFAULT_DECK_SEED ^ matchSeed ^ ((h * SEED_MIX) & MASK_64)) & MASK_64;
}

// FNV-1a 64 over a buffer of bytes. Matches match_seed_from_peers when fed peer id bytes.
export function fnv1a64(bytes: ArrayLike<number>): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i] & 0xff);
    h = (h * FNV_PRIME) & MASK_64;
  }
  return h;
}

export function matchSeedFromPeers(peerIds: string[]): bigint {
  let h = FNV_OFFSET;
  for (const id of peerIds) {
    for (let i = 0; i < id.length; i++) {
      h ^= BigInt(id.charCodeAt(i) & 0xff);
      h = (h * FNV_PRIME) & MASK_64;
    }
  }
  return h;
}
