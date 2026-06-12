// 熟成 (maturing) card balance harness.
//
// Fixed opponent: Lv3 with the STANDARD test deck (no maturing cards, so
// its behavior is identical across series). Variable side: a deck with
// 2×業火の種 + 2×鉄の蕾 swapped in, played either NAIVELY (seeds spent on
// tempo like ordinary cards) or with the HOLD strategy (seeds kept until
// they mature). The gap between those two win rates IS the measured value
// of the "wait" strategy — evidence the mechanic creates a real decision,
// not just a stat stick. Deterministic: fixed seeds, stable results.
import { describe, expect, it } from "vitest";
import { lv3Tactical, Policy } from "../src/ai/policy";
import { CardId, createTestDeck } from "../src/sim/cards";
import { initGame } from "../src/sim/init";
import { step } from "../src/sim/reducer";

const FRAME_CAP = 14400; // 80閃 — 焦土込みで決着させる

function createMatureDeck(): CardId[] {
  const d = createTestDeck();
  // Swap 2 Strikes → 業火の種, 2 Defends → 鉄の蕾 (like-for-like roles).
  let s = 0, b = 0;
  return d.map((c) => {
    if (c === CardId.Strike && s < 2) { s++; return CardId.EmberSeed; }
    if (c === CardId.Defend && b < 2) { b++; return CardId.IronBud; }
    return c;
  });
}

function runMatch(deckA: CardId[], pa: Policy, deckB: CardId[], pb: Policy, seed: bigint): 1 | 2 | 3 {
  const s = initGame({ matchSeed: seed, hpMax: 80, deckP0: deckA, deckP1: deckB });
  for (let f = 0; f < FRAME_CAP; f++) {
    step(s, pa(s, 0), pb(s, 1));
    if (s.result !== 0) return s.result as 1 | 2 | 3;
  }
  const d = s.players[0].hp - s.players[1].hp;
  return d === 0 ? 3 : d > 0 ? 1 : 2;
}

/** Mature-deck side (with holdMaturing flag) vs standard-deck Lv3. */
function series(holdMaturing: boolean, seeds: bigint[]): { points: number; games: number } {
  const mature = createMatureDeck();
  const std = createTestDeck();
  let points = 0, games = 0;
  for (const seed of seeds) {
    // mature side as p0
    const r1 = runMatch(
      mature, lv3Tactical(7, holdMaturing),
      std, lv3Tactical(8), seed,
    );
    games++; points += r1 === 1 ? 1 : r1 === 3 ? 0.5 : 0;
    // mature side as p1
    const r2 = runMatch(
      std, lv3Tactical(8),
      mature, lv3Tactical(7, holdMaturing), seed + 1000n,
    );
    games++; points += r2 === 2 ? 1 : r2 === 3 ? 0.5 : 0;
  }
  return { points, games };
}

// 40 seeds × 2 sides = 80 games per series. At 10 seeds the hold-vs-naive
// ordering is within sample noise (a single flipped game inverts it); 80
// games is where the premium measurably stabilizes.
const SEEDS = Array.from({ length: 40 }, (_, i) => BigInt(i + 1));

describe("熟成カードのバランス", () => {
  it("hold strategy ≥ naive play, and the mature deck is competitive but not dominant", () => {
    const naive = series(false, SEEDS);
    const hold = series(true, SEEDS);
    console.log(`mature deck (naive): ${naive.points}/${naive.games}`);
    console.log(`mature deck (hold):  ${hold.points}/${hold.games}`);
    // The wait-decision must not be a trap: holding should do at least as
    // well as spending seeds on tempo.
    expect(hold.points).toBeGreaterThanOrEqual(naive.points);
    // And the cards must not warp the meta: competitive band, not dominance.
    expect(hold.points).toBeGreaterThanOrEqual(hold.games * 0.3);
    expect(hold.points).toBeLessThanOrEqual(hold.games * 0.85);
  }, 120_000);
});
