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

// Count non-null entries in the fixed-size hand.
function countHand(p: { hand: (number | null)[] }): number {
  let n = 0;
  for (const c of p.hand) if (c !== null) n++;
  return n;
}

// Count CARD entries in a player's queue (excludes auto-fired Draw entries
// from the default forced reservation, which can appear whenever the queue
// otherwise would be empty).
function cardCount(s: ReturnType<typeof initGame>, side: 0 | 1): number {
  return s.players[side].queue.filter((q) => q.kind === "card").length;
}

// All-actions-as-reservation flow: clicking a card APPENDS a reservation
// entry; the sim fires from the reservation list into the queue as
// conditions permit. So the player's "total committed cards" is the sum
// of in-queue cards + in-reservation cards.
function totalCommittedCards(s: ReturnType<typeof initGame>, side: 0 | 1): number {
  const inQueue = s.players[side].queue.filter((q) => q.kind === "card").length;
  const inReservations = s.players[side].reservations.filter((r) => r.kind === "card").length;
  return inQueue + inReservations;
}

// Press a Strike slot that isn't already reserved AND isn't empty. With
// the all-actions-as-reservation model, pressing the same slot twice is a
// no-op (it's already in the reservation list), so we have to pick the
// next un-reserved Strike slot for each call.
function queueAnyStrike(s: ReturnType<typeof initGame>, side: 0 | 1) {
  const p = s.players[side];
  const reservedSlots = new Set<number>(
    p.reservations.flatMap((r) => r.kind === "card" ? [r.slotIndex] : []),
  );
  let idx = -1;
  for (let i = 0; i < p.hand.length; i++) {
    if (p.hand[i] === CardId.Strike && !reservedSlots.has(i)) { idx = i; break; }
  }
  if (idx < 0) throw new Error("no un-reserved Strike to queue");
  const flag = cardFlag(idx)!;
  return side === 0 ? step(s, flag, 0) : step(s, 0, flag);
}

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
    s.players[1].block = 0;
    const startHp = s.players[1].hp;
    step(s, cardFlag(0)!, 0); // queue Strike (1 閃 = 3 sec)
    expect(cardCount(s, 0)).toBe(1);
    for (let f = 0; f < 185; f++) step(s, 0, 0);
    expect(cardCount(s, 0)).toBe(0);
    const dealt = startHp - s.players[1].hp;
    expect(dealt).toBeGreaterThanOrEqual(5.5);
    expect(dealt).toBeLessThanOrEqual(6.5);
  });

  it("clicking multiple cards commits them to the reservation list in order", () => {
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    // All actions are reservations now: the first click fires immediately
    // (queue empty), the rest sit in the reservation list waiting for queue
    // to drain. Total commitments = 3 (1 in queue + 2 in reservations).
    queueAnyStrike(s, 0); queueAnyStrike(s, 0); queueAnyStrike(s, 0);
    expect(totalCommittedCards(s, 0)).toBe(3);
  });

  it("reserved casts resolve in order with carry-over time (no drift)", () => {
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    s.players[1].block = 0;
    // 3 Strikes committed (one fires, two sit in reservation list).
    queueAnyStrike(s, 0); queueAnyStrike(s, 0); queueAnyStrike(s, 0);
    expect(totalCommittedCards(s, 0)).toBe(3);
    const startHp = s.players[1].hp;
    for (let f = 0; f < 185; f++) step(s, 0, 0); // ~3s → first resolved
    expect(totalCommittedCards(s, 0)).toBe(2);
    expect(startHp - s.players[1].hp).toBeGreaterThanOrEqual(5.5);
    for (let f = 0; f < 180; f++) step(s, 0, 0); // ~6s → second resolved
    expect(totalCommittedCards(s, 0)).toBe(1);
    expect(startHp - s.players[1].hp).toBeGreaterThanOrEqual(11);
    for (let f = 0; f < 180; f++) step(s, 0, 0); // ~9s → third resolved
    expect(totalCommittedCards(s, 0)).toBe(0);
    expect(startHp - s.players[1].hp).toBeGreaterThanOrEqual(17);
  });

  it("prereqQueueTime blocks queueing a finisher unless setup is in place", () => {
    // Hand: 4 Strikes + Bludgeon (prereq 2 閃).
    const deck = [CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike, CardId.Bludgeon];
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    const bludIdx = s.players[0].hand.indexOf(CardId.Bludgeon);
    expect(bludIdx).toBeGreaterThanOrEqual(0);

    // Empty queue → Bludgeon should be REJECTED (auto-fired Draw may sit in
    // the queue but no CARD should be there yet).
    step(s, cardFlag(bludIdx)!, 0);
    expect(cardCount(s, 0)).toBe(0);
    expect(s.players[0].hand.indexOf(CardId.Bludgeon)).toBeGreaterThanOrEqual(0);

    // Queue 3 Strikes (1 閃 each = 3 閃 of setup, above Bludgeon's prereq 2).
    // First Strike fires into queue; 2nd/3rd stack in reservations. Find
    // an un-reserved Strike slot each iteration because reservation does
    // NOT empty the slot.
    for (let n = 0; n < 3; n++) {
      queueAnyStrike(s, 0);
    }
    expect(totalCommittedCards(s, 0)).toBe(3);
    const bludIdxNow = s.players[0].hand.indexOf(CardId.Bludgeon);
    step(s, cardFlag(bludIdxNow)!, 0);
    expect(totalCommittedCards(s, 0)).toBe(4);
    // The Bludgeon should be the LAST reservation.
    const lastRes = s.players[0].reservations[s.players[0].reservations.length - 1];
    expect(lastRes.kind === "card"
      && s.players[0].hand[lastRes.slotIndex] === CardId.Bludgeon).toBe(true);
  });

  it("played non-power cards go to discard on resolve", () => {
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    const beforeDiscard = s.players[0].discard.length;
    step(s, cardFlag(0)!, 0);
    // Strike now costs 3s = 180 frames + buffer.
    for (let f = 0; f < 200; f++) step(s, 0, 0);
    expect(s.players[0].discard.length).toBe(beforeDiscard + 1);
  });

  it("status cards (cost 999) cannot be queued", () => {
    const deck = [CardId.Wound, CardId.Wound, CardId.Wound, CardId.Wound, CardId.Wound];
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    step(s, cardFlag(0)!, 0);
    expect(cardCount(s, 0)).toBe(0); // status card ignored — no CARD entry queued
  });

  it("Defend grants block on cast-start (not on cast-end)", () => {
    const deck = Array(20).fill(CardId.Defend);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    step(s, cardFlag(0)!, 0); // queue Defend
    // Block should already be 5 (cast start), not 0 (waiting for resolve).
    expect(s.players[0].block).toBe(5);
  });

  it("block decays 1 unit per 閃 once set", async () => {
    // Empty deck so the auto-Draw can't refill, and clear the hand so the
    // leftmost-playable reservation can't queue anything. The only thing
    // affecting block over the next few 閃 is the decay timer.
    const { senToSec } = await import("../src/sim/rules");
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: [], deckP1: [] });
    for (let i = 0; i < 6; i++) s.players[0].hand[i] = null;
    s.players[0].deck = [];
    s.players[0].discard = [];
    s.players[0].block = 5;
    s.players[0].nextBlockDecayAt = senToSec(1); // first decay at t=1閃
    s.players[0].blockHistory = [{ t: 0, block: 5 }];

    for (let f = 0; f < 185; f++) step(s, 0, 0);
    expect(s.players[0].block).toBe(4);
    for (let f = 0; f < 360; f++) step(s, 0, 0);
    expect(s.players[0].block).toBe(2);
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
