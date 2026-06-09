// Lab self-play runner: determinism + replay fidelity.
import { describe, expect, it } from "vitest";
import { runLabMatch } from "../src/lab/selfplay";
import { ReplayEngine } from "../src/replay/engine";

describe("lab self-play runner", () => {
  it("same seed → identical match (deterministic)", () => {
    const a = runLabMatch("lv2", 42n, 0);
    const b = runLabMatch("lv2", 42n, 0);
    expect(a.result).toBe(b.result);
    expect(a.finalFrame).toBe(b.finalFrame);
    expect(a.replay.inputs).toEqual(b.replay.inputs);
  });

  it("recorded replay reproduces the exact final state through ReplayEngine", () => {
    const m = runLabMatch("lv3", 7n, 1);
    expect(m.replay.inputs.length).toBeGreaterThan(0);
    const engine = new ReplayEngine(m.replay);
    const s = engine.seek(m.replay.finalFrame);
    // The replayed sim must land on the same result at the same frame.
    expect(s.result).toBe(m.result);
    expect(s.frame).toBe(m.replay.finalFrame);
  });

  it("a decided match marks exactly one of won/draw for the tested side", () => {
    const m = runLabMatch("lv3", 11n, 0);
    expect(m.draw ? !m.won : true).toBe(true);
    // Tested side mapping: result 1 = p0 won; tested side was 0.
    if (m.result === 1) expect(m.won).toBe(m.side === 0);
    if (m.result === 2) expect(m.won).toBe(m.side === 1);
  });
});
