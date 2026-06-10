// 烈閃 (surge 閃) — deterministic timeline terrain.
//
// A fixed set of 閃 indices, derived purely from the matchSeed, where any
// ATTACK card RESOLVING in that 閃 deals +RETSU_SEN_BONUS damage. Both
// players see the identical schedule from frame 0 (rendered on the
// timeline), so this is a PLANNING target — weave your big resolve into
// the surge — never a reflex test, and never interference with the
// opponent's plan (fully symmetric, fully public).
//
// Pure function of matchSeed: no GameState field, no checksum/wire
// changes, and the prediction/rollout sims get it for free because the
// reducer reads it directly.

const cache = new Map<string, Set<number>>();

/** First ~240閃 worth of surge positions for this seed. */
export function surgeSens(matchSeed: bigint): Set<number> {
  const key = matchSeed.toString(16);
  const hit = cache.get(key);
  if (hit) return hit;
  const out = new Set<number>();
  // Small deterministic LCG seeded from the match seed (separate from the
  // players' deck RNG — this stream must never perturb gameplay RNG).
  let x = Number((matchSeed ^ 0x9e3779b97f4a7c15n) & 0xffffffffn) >>> 0;
  const next = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x;
  };
  // First surge at 第6〜9閃, then every 7〜10閃.
  let sen = 6 + (next() % 4);
  while (sen < 240) {
    out.add(sen);
    sen += 7 + (next() % 4);
  }
  cache.set(key, out);
  return out;
}

export function isSurgeSen(matchSeed: bigint, sen: number): boolean {
  return surgeSens(matchSeed).has(sen);
}
