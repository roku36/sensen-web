import { describe, expect, it } from "vitest";
import { CardId, createTestDeck } from "../src/sim/cards";
import { checksum } from "../src/sim/checksum";
import { initGame } from "../src/sim/init";
import { INPUT_DRAW, cardFlag } from "../src/sim/input";
import { step } from "../src/sim/reducer";
import { matchSeedFromPeers } from "../src/sim/rng";
import { INPUT_DELAY } from "../src/sim/rules";
import { snapshot } from "../src/sim/state";
import { RollbackEngine } from "../src/net/rollback";

const baseInit = () => ({
  matchSeed: matchSeedFromPeers(["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]),
  hpMax: 1000,
  costRate: 1,
  deckP0: createTestDeck(),
  deckP1: createTestDeck(),
});

describe("reducer determinism", () => {
  it("two fresh runs with the same inputs produce identical state", () => {
    const a = initGame(baseInit());
    const b = initGame(baseInit());
    // Run 600 frames (10s) of: tick once a second, both press card 1.
    for (let f = 0; f < 600; f++) {
      const flag = f % 60 === 30 ? cardFlag(0)! : 0;
      step(a, flag, flag);
      step(b, flag, flag);
    }
    expect(checksum(a)).toBe(checksum(b));
  });

  it("snapshot + restore + replay matches direct execution", () => {
    const live = initGame(baseInit());
    // Fork the run at frame 30.
    for (let f = 0; f < 30; f++) step(live, 0, 0);
    const fork = snapshot(live);
    // Continue both with input pattern.
    const inputs: Array<[number, number]> = [];
    for (let f = 0; f < 120; f++) {
      const a = f % 17 === 0 ? cardFlag(0)! : 0;
      const b = f % 23 === 0 ? cardFlag(0)! : 0;
      inputs.push([a, b]);
      step(live, a, b);
    }
    // Replay from snapshot.
    const replayed = snapshot(fork);
    for (const [a, b] of inputs) step(replayed, a, b);
    expect(checksum(live)).toBe(checksum(replayed));
  });

  it("rollback engine recovers from a wrong prediction", () => {
    const opts = { ...baseInit(), localPlayer: 0 as const };
    // Two engines simulating both peers.
    const peer0 = new RollbackEngine(opts);
    const peer1 = new RollbackEngine({ ...opts, localPlayer: 1 });

    // Advance both past the input-delay window so the queued input is in the past.
    for (let i = 0; i < 10; i++) { peer0.advance(); peer1.advance(); }

    // P1 plays card 1 at their current frame; P0 doesn't know yet (predicts 0).
    const p1Frame = peer1.frame() + INPUT_DELAY;
    peer1.pushLocalInput(cardFlag(0)!);
    // Advance both past p1Frame so peer0 has wrongly-predicted past it.
    for (let i = 0; i < INPUT_DELAY + 4; i++) { peer0.advance(); peer1.advance(); }

    // P1's input arrives at peer0; engine should rollback and resimulate.
    peer0.receiveRemoteInput(p1Frame, cardFlag(0)!);
    peer1.receiveRemoteInput(peer0.frame(), 0); // mirror

    // States should now agree.
    expect(checksum(peer0.current())).toBe(checksum(peer1.current()));
  });

  it("checksum changes when state changes", () => {
    const a = initGame(baseInit());
    const c1 = checksum(a);
    step(a, INPUT_DRAW, 0);
    const c2 = checksum(a);
    expect(c2).not.toBe(c1);
  });

  it("playing strike tracks damage exactly", () => {
    // Construct a deck of just Strike so we know what to expect.
    const deck = [CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike];
    const s = initGame({
      matchSeed: 1n,
      hpMax: 80,
      costRate: 1,
      deckP0: deck,
      deckP1: deck,
    });
    const startHp = s.players[1].hp;
    for (let f = 0; f < 70; f++) step(s, 0, 0); // ~1.16s @ 1/s = ~1.16 cost
    expect(s.players[0].cost).toBeGreaterThanOrEqual(1.0);
    step(s, cardFlag(0)!, 0);
    // Strike deals 6 base damage now (Slay-scale), no strength/weak/vuln.
    const dealt = startHp - s.players[1].hp;
    expect(dealt).toBeGreaterThanOrEqual(5.5);
    expect(dealt).toBeLessThanOrEqual(6.5);
  });

  it("played non-power cards go to discard, not back to deck", () => {
    const deck = [CardId.Strike, CardId.Strike, CardId.Strike];
    const s = initGame({ matchSeed: 1n, hpMax: 80, costRate: 1, deckP0: deck, deckP1: deck });
    for (let f = 0; f < 70; f++) step(s, 0, 0);
    const beforeDiscard = s.players[0].discard.length;
    step(s, cardFlag(0)!, 0); // play hand[0]
    expect(s.players[0].discard.length).toBe(beforeDiscard + 1);
  });

  it("block decays linearly at BLOCK_DECAY_RATE", () => {
    const deck = [CardId.Defend, CardId.Defend];
    const s = initGame({ matchSeed: 1n, hpMax: 80, costRate: 1, deckP0: deck, deckP1: deck });
    for (let f = 0; f < 70; f++) step(s, 0, 0);
    step(s, cardFlag(0)!, 0); // Defend → block 5
    const b0 = s.players[0].block;
    expect(b0).toBeGreaterThan(4.5);
    // 60 frames = 1s, at 2/s decay block should drop by ~2
    for (let f = 0; f < 60; f++) step(s, 0, 0);
    const b1 = s.players[0].block;
    expect(b0 - b1).toBeGreaterThan(1.5);
    expect(b0 - b1).toBeLessThan(2.5);
  });
});
