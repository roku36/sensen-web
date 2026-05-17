import { describe, expect, it } from "vitest";
import { CardId, createTestDeck } from "../src/sim/cards";
import { checksum } from "../src/sim/checksum";
import { initGame } from "../src/sim/init";
import { cardFlag } from "../src/sim/input";
import { step } from "../src/sim/reducer";
import { matchSeedFromPeers } from "../src/sim/rng";
import { INPUT_DELAY } from "../src/sim/rules";
import { snapshot } from "../src/sim/state";
import { RollbackEngine } from "../src/net/rollback";

const baseInit = () => ({
  matchSeed: matchSeedFromPeers(["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]),
  hpMax: 1000,
  deckP0: createTestDeck(),
  deckP1: createTestDeck(),
});

describe("reducer determinism", () => {
  it("two fresh runs with the same inputs produce identical state", () => {
    const a = initGame(baseInit());
    const b = initGame(baseInit());
    for (let f = 0; f < 600; f++) {
      const flag = f % 60 === 30 ? cardFlag(0)! : 0;
      step(a, flag, flag);
      step(b, flag, flag);
    }
    expect(checksum(a)).toBe(checksum(b));
  });

  it("snapshot + restore + replay matches direct execution", () => {
    const live = initGame(baseInit());
    for (let f = 0; f < 30; f++) step(live, 0, 0);
    const fork = snapshot(live);
    const inputs: Array<[number, number]> = [];
    for (let f = 0; f < 120; f++) {
      const a = f % 17 === 0 ? cardFlag(0)! : 0;
      const b = f % 23 === 0 ? cardFlag(0)! : 0;
      inputs.push([a, b]);
      step(live, a, b);
    }
    const replayed = snapshot(fork);
    for (const [a, b] of inputs) step(replayed, a, b);
    expect(checksum(live)).toBe(checksum(replayed));
  });

  it("rollback engine recovers from a wrong prediction", () => {
    const opts = { ...baseInit(), localPlayer: 0 as const };
    const peer0 = new RollbackEngine(opts);
    const peer1 = new RollbackEngine({ ...opts, localPlayer: 1 });
    for (let i = 0; i < 10; i++) { peer0.advance(); peer1.advance(); }
    const p1Frame = peer1.frame() + INPUT_DELAY;
    peer1.pushLocalInput(cardFlag(0)!);
    for (let i = 0; i < INPUT_DELAY + 4; i++) { peer0.advance(); peer1.advance(); }
    peer0.receiveRemoteInput(p1Frame, cardFlag(0)!);
    peer1.receiveRemoteInput(peer0.frame(), 0);
    expect(checksum(peer0.current())).toBe(checksum(peer1.current()));
  });

  it("checksum changes when a card cast starts (and again when it resolves)", () => {
    const deck = [CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike];
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    const c0 = checksum(s);
    step(s, cardFlag(0)!, 0);
    const c1 = checksum(s);
    expect(c1).not.toBe(c0); // cast started → state changed (casting set, hand shrunk)
    // After enough frames, the 1s Strike resolves; checksum changes again.
    for (let f = 0; f < 70; f++) step(s, 0, 0);
    const c2 = checksum(s);
    expect(c2).not.toBe(c1);
  });

  it("head of queue resolves after cost seconds and deals declared damage", () => {
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    const startHp = s.players[1].hp;
    step(s, cardFlag(0)!, 0);
    expect(s.players[0].queue.length).toBe(1);
    for (let f = 0; f < 65; f++) step(s, 0, 0);
    expect(s.players[0].queue.length).toBe(0);
    const dealt = startHp - s.players[1].hp;
    expect(dealt).toBeGreaterThanOrEqual(5.5);
    expect(dealt).toBeLessThanOrEqual(6.5);
    expect(s.players[0].hand.length).toBe(5);
  });

  it("clicking multiple cards APPENDS to the queue (this is the queue mechanic)", () => {
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    // Queue three Strikes back-to-back in three consecutive frames.
    step(s, cardFlag(0)!, 0);
    step(s, cardFlag(0)!, 0);
    step(s, cardFlag(0)!, 0);
    expect(s.players[0].queue.length).toBe(3);
    expect(s.players[0].hand.length).toBe(2); // 5 - 3 queued
  });

  it("queued casts resolve in order with carry-over time (no drift)", () => {
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    // Queue 3 Strikes (1s each). Total wait = 3s = 180 frames.
    step(s, cardFlag(0)!, 0);
    step(s, cardFlag(0)!, 0);
    step(s, cardFlag(0)!, 0);
    const startHp = s.players[1].hp;
    // After 1s exactly → 1 should have resolved.
    for (let f = 0; f < 65; f++) step(s, 0, 0);
    expect(s.players[0].queue.length).toBe(2);
    expect(startHp - s.players[1].hp).toBeGreaterThanOrEqual(5.5);
    // After another 1s → 2 resolved total.
    for (let f = 0; f < 60; f++) step(s, 0, 0);
    expect(s.players[0].queue.length).toBe(1);
    expect(startHp - s.players[1].hp).toBeGreaterThanOrEqual(11);
    // After the third → queue empty, 3 strikes dealt.
    for (let f = 0; f < 60; f++) step(s, 0, 0);
    expect(s.players[0].queue.length).toBe(0);
    expect(startHp - s.players[1].hp).toBeGreaterThanOrEqual(17);
  });

  it("played non-power cards go to discard on resolve", () => {
    // Use a deck large enough that the auto-refill draw on resolve doesn't
    // immediately shuffle the just-discarded card back into play.
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    const beforeDiscard = s.players[0].discard.length;
    step(s, cardFlag(0)!, 0);
    for (let f = 0; f < 70; f++) step(s, 0, 0);
    expect(s.players[0].discard.length).toBe(beforeDiscard + 1);
  });

  it("status cards (cost 999) cannot be queued", () => {
    const deck = [CardId.Wound, CardId.Wound, CardId.Wound, CardId.Wound, CardId.Wound];
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    step(s, cardFlag(0)!, 0);
    expect(s.players[0].queue.length).toBe(0); // ignored
  });

  it("block decays linearly at BLOCK_DECAY_RATE", () => {
    const deck = [CardId.Defend, CardId.Defend, CardId.Defend];
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    step(s, cardFlag(0)!, 0); // start cast
    for (let f = 0; f < 65; f++) step(s, 0, 0); // resolve
    const b0 = s.players[0].block;
    expect(b0).toBeGreaterThan(2.5); // Defend = block 5, then ~1s decay = ~3 left
    // Another full second of decay should drop ~2.
    for (let f = 0; f < 60; f++) step(s, 0, 0);
    const b1 = s.players[0].block;
    expect(b0 - b1).toBeGreaterThan(1.5);
    expect(b0 - b1).toBeLessThan(2.5);
  });

  it("streak bucket maps streaks to expected matchmaking groups", async () => {
    const { streakBucket } = await import("../src/sim/deck-storage");
    expect(streakBucket(0)).toBe("0");
    expect(streakBucket(2)).toBe("1to2");
    expect(streakBucket(5)).toBe("3to5");
    expect(streakBucket(10)).toBe("6to10");
    expect(streakBucket(20)).toBe("11to20");
    expect(streakBucket(21)).toBe("21up");
  });

  it("urlForStreak appends bucket to topic path", async () => {
    const { urlForStreak } = await import("../src/sim/deck-storage");
    expect(urlForStreak("ws://localhost:3536/sensen?next=2", 0))
      .toBe("ws://localhost:3536/sensen-streak-0?next=2");
    expect(urlForStreak("ws://localhost:3536/sensen?next=2", 4))
      .toBe("ws://localhost:3536/sensen-streak-3to5?next=2");
  });
});
