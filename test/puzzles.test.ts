// パズルの恒久保証:
//  1. 想定解 (def.solution) で予算閃以内に勝てる。
//  2. オートパイロット放置 (入力ゼロ) では勝てない — 「考える価値」の保証。
// すべて決定論なので、バランス変更でパズルが壊れたら即ここで検知される。
import { describe, expect, it } from "vitest";
import { PUZZLES, setupPuzzle } from "../src/puzzles/defs";
import { initGame } from "../src/sim/init";
import { step } from "../src/sim/reducer";
import { FRAMES_PER_SEN, INITIAL_HP } from "../src/sim/rules";

function buildState(def: (typeof PUZZLES)[number]) {
  const s = initGame({
    matchSeed: def.matchSeed,
    hpMax: INITIAL_HP,
    deckP0: [1, 1, 1, 1, 1], // dummy — setupPuzzle が上書きする
    deckP1: [1, 1, 1, 1, 1],
  });
  setupPuzzle(s, def);
  return s;
}

describe("puzzles", () => {
  for (const def of PUZZLES) {
    it(`${def.title} — 想定解で予算内クリア`, () => {
      const s = buildState(def);
      const inputs = new Map(def.solution.map((x) => [x.f, x.flags]));
      const cap = (def.budgetSen + 1) * FRAMES_PER_SEN + 10;
      while (s.result === 0 && s.frame < cap) {
        step(s, inputs.get(s.frame) ?? 0, 0);
      }
      expect(s.result).toBe(1);
      expect(Math.floor((s.frame - 1) / FRAMES_PER_SEN)).toBeLessThanOrEqual(def.budgetSen);
    });

    it(`${def.title} — オートパイロット放置では解けない`, () => {
      const s = buildState(def);
      const cap = (def.budgetSen + 1) * FRAMES_PER_SEN + 10;
      let wonAt = -1;
      while (s.frame < cap) {
        step(s, 0, 0);
        if (s.result === 1 && wonAt < 0) wonAt = s.frame;
      }
      const wonInBudget = wonAt >= 0 && Math.floor((wonAt - 1) / FRAMES_PER_SEN) <= def.budgetSen;
      expect(wonInBudget).toBe(false);
    });
  }
});
