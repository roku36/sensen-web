import { describe, expect, it } from "vitest";
import { CardId, createTestDeck } from "../src/sim/cards";
import { checksum } from "../src/sim/checksum";
import { initGame } from "../src/sim/init";
import { cardFlag, INPUT_DRAW } from "../src/sim/input";
import { step } from "../src/sim/reducer";
import { matchSeedFromPeers } from "../src/sim/rng";
import { FRAMES_PER_SEN, INPUT_DELAY } from "../src/sim/rules";
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
    // Bludgeon must NOT be in the queue yet — heavy cards window-fire,
    // and they only stack just-in-time (so most preceding strikes also
    // remain in reservations until needed). What matters here is the
    // GATE: Bludgeon was accepted into the plan, not silently dropped.
    const queueCardIdsInitial = s.players[0].queue.filter((q) => q.kind === "card")
      .map((q) => (q as { cardId: number }).cardId);
    expect(queueCardIdsInitial).not.toContain(CardId.Bludgeon);
    const lastRes = s.players[0].reservations[s.players[0].reservations.length - 1];
    expect(lastRes.kind === "card"
      && s.players[0].hand[lastRes.slotIndex] === CardId.Bludgeon).toBe(true);
  });

  it("reserving a heavy never confirms preceding reservations early (atomic-only)", () => {
    // Hand: 5 Strikes + Bludgeon (prereq 2閃 = 6 sec). S1 auto-fires into
    // the queue from the first click. The remaining strikes + Bludgeon
    // ALL sit in reservations after Bludgeon is clicked: nothing about
    // reserving a heavy should "confirm" preceding non-prereq cards into
    // the queue. They wait for the atomic-fire moment together.
    const deck = [CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike, CardId.Bludgeon];
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    queueAnyStrike(s, 0); // S1 → queue
    queueAnyStrike(s, 0); // S2 → reservation
    queueAnyStrike(s, 0); // S3 → reservation
    queueAnyStrike(s, 0); // S4 → reservation
    expect(s.players[0].reservations.length).toBe(3);
    const bludIdx = s.players[0].hand.indexOf(CardId.Bludgeon);
    expect(bludIdx).toBeGreaterThanOrEqual(0);
    step(s, cardFlag(bludIdx)!, 0);

    // Critical: NO preceding non-prereq confirmed early. Queue still has
    // only the auto-fired S1; all four (S2, S3, S4, Bludgeon) wait.
    expect(s.players[0].queue.filter((q) => q.kind === "card").length).toBe(1);
    expect(s.players[0].reservations.length).toBe(4);
    expect(totalCommittedCards(s, 0)).toBe(5);
  });

  it("Draw can be reserved while another Draw is casting in the queue", () => {
    // A draw is casting in the queue (explicit press — オートパイロットは
    // 廃止済み)。The player pushes INPUT_DRAW again — the new draw must NOT
    // be silently rejected; it sits in reservations and fires once the
    // queue's draw drains.
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    step(s, 1 /* INPUT_DRAW */, 0); // explicit draw → fires straight to queue
    const queueHasDraw = s.players[0].queue.some((q) => q.kind === "draw");
    expect(queueHasDraw).toBe(true);

    // 2nd draw click → goes to reservations.
    step(s, 1, 0);
    let drawsInRes = s.players[0].reservations.filter((r) => r.kind === "draw").length;
    expect(drawsInRes).toBe(1);

    // 3rd draw click ALSO succeeds — consecutive draws are allowed (no-op
    // duplicates self-clean at fire time when they have nothing to draw).
    step(s, 1, 0);
    drawsInRes = s.players[0].reservations.filter((r) => r.kind === "draw").length;
    expect(drawsInRes).toBe(2);
  });

  it("heavy + preceding reservations atomic-fire when chain drains to trigger", () => {
    // Hand seeded with 3 Strikes + Bludgeon (prereq 2 閃 = 6 sec).
    // After Strike1 fires (queue empty rule), the reservation list holds
    // [S2, S3, Bludgeon] with setupCost = 6 sec. Atomic trigger = prereq
    // − setupCost = 0. So the entire block sits in reservations until the
    // queue's lone Strike drains all the way out, THEN all three fire
    // together — in original order — into the queue.
    const deck = [CardId.Strike, CardId.Strike, CardId.Strike, CardId.Bludgeon, CardId.Strike];
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    queueAnyStrike(s, 0); // S1 fires into queue
    queueAnyStrike(s, 0); // S2 sits in reservations
    queueAnyStrike(s, 0); // S3 sits in reservations
    const bludIdx = s.players[0].hand.indexOf(CardId.Bludgeon);
    expect(bludIdx).toBeGreaterThanOrEqual(0);
    step(s, cardFlag(bludIdx)!, 0);
    expect(totalCommittedCards(s, 0)).toBe(4);
    // RIGHT AFTER click: only the auto-fired Strike1 is in queue. S2, S3,
    // Bludgeon all sit in reservations untouched (atomic trigger not met).
    expect(s.players[0].queue.filter((q) => q.kind === "card").length).toBe(1);
    expect(s.players[0].reservations.length).toBe(3);

    // Advance until Strike1 fully drains (≈ 180 frames). The instant the
    // queue's chain hits 0 (= atomic trigger), the WHOLE block atomic-fires
    // in original order: S2, S3, then Bludgeon.
    for (let f = 0; f < 200; f++) step(s, 0, 0);
    const queueIds = s.players[0].queue.filter((q) => q.kind === "card")
      .map((q) => (q as { cardId: number }).cardId);
    expect(queueIds).toContain(CardId.Bludgeon);
    // Bludgeon must be LAST — preceding reservations come first in order.
    expect(queueIds[queueIds.length - 1]).toBe(CardId.Bludgeon);
    // Reservation list now empty.
    expect(s.players[0].reservations.length).toBe(0);
  });

  // Build the post-atomic state used by the two confirm-timing tests:
  // S1 fires at t=0, [S2,S3,B1] atomic-fire when S1 drains (t=3.0s), so the
  // queue holds a 12s chain ending at t=15.0s. Returns the game state.
  function buildAtomicChain() {
    const deck = [CardId.Strike, CardId.Strike, CardId.Strike, CardId.Strike, CardId.Bludgeon, CardId.Bludgeon];
    const s = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    queueAnyStrike(s, 0); // S1 → queue (fires immediately)
    queueAnyStrike(s, 0); // S2 → reservation
    queueAnyStrike(s, 0); // S3 → reservation
    const b1 = s.players[0].hand.indexOf(CardId.Bludgeon);
    expect(b1).toBeGreaterThanOrEqual(0);
    step(s, cardFlag(b1)!, 0); // B1 → reservation (setup 2閃 == prereq 2閃)
    // Advance until the atomic fire lands [S2,S3,B1] into the queue.
    for (let f = 0; f < 240 && cardCount(s, 0) < 3; f++) step(s, 0, 0);
    expect(cardCount(s, 0)).toBe(3);
    expect(s.players[0].reservations.length).toBe(0);
    return s;
  }

  it("heavy reserved mid-chain confirms at EXACTLY prereq 閃 before its cast starts", () => {
    const s = buildAtomicChain();
    // Advance to t = 7.0s: chain remaining = 8.0s (> prereq 6s).
    while (s.frame * (1 / 60) < 7.0) step(s, 0, 0);
    const b2 = s.players[0].hand.indexOf(CardId.Bludgeon);
    expect(b2).toBeGreaterThanOrEqual(0);
    step(s, cardFlag(b2)!, 0); // reserve B2
    expect(s.players[0].reservations.length).toBe(1); // accepted, waiting

    // B2 must enter the queue at the exact frame the chain ahead of it
    // drains to 6.0s (= 2閃, its prereq) — no earlier, no later. Fire is
    // detected as the reservation list emptying (B2 moved to the queue).
    let fireFrame = -1;
    for (let f = 0; f < 600 && fireFrame < 0; f++) {
      step(s, 0, 0);
      if (s.players[0].reservations.length === 0) fireFrame = s.frame - 1;
    }
    expect(fireFrame).toBeGreaterThan(0);
    const p = s.players[0];
    // Time-ahead-of-B2 at the fire frame: head remaining + middle durations.
    const fireSec = fireFrame * (1 / 60);
    let ahead = p.queue[0].duration - (fireSec - p.castStartedAt);
    for (let i = 1; i < p.queue.length - 1; i++) ahead += p.queue[i].duration;
    expect(ahead).toBeCloseTo(6.0, 3);
  });

  it("heavy reservation is rejected when the real remaining chain is below its prereq", () => {
    const s = buildAtomicChain();
    // Advance to t = 10.0s: chain remaining = 5.0s < prereq 6.0s. The 閃-ceil
    // view says "2閃" but the heavy can never get a full 2閃 of setup from
    // this chain — accepting it would instantly confirm with only 5s ahead
    // (the「発動まで丁度2閃で確定しない」bug). It must be REJECTED.
    while (s.frame * (1 / 60) < 10.0) step(s, 0, 0);
    // By t=10 the strikes have resolved; only B1 (head, 5.0s left) remains.
    const cardsBefore = cardCount(s, 0);
    const b2 = s.players[0].hand.indexOf(CardId.Bludgeon);
    expect(b2).toBeGreaterThanOrEqual(0);
    step(s, cardFlag(b2)!, 0);
    // Rejected: not in reservations AND not instantly queued with a short
    // chain (the bug fired it immediately with only 5s = 1.67閃 ahead).
    expect(s.players[0].reservations.length).toBe(0);
    expect(cardCount(s, 0)).toBe(cardsBefore);
    expect(s.players[0].hand.indexOf(CardId.Bludgeon)).toBe(b2); // still in hand
  });

  it("積みが要件を下回っても重カードは必ず発動する (予約は失敗しない)", () => {
    // スケジューラの契約テスト。
    //
    // 重カードのゲートは「予約時点の積み」を見るが、その積みは後から縮む
    // ことがある — 予約済みドローは手札に空きがある間は1閃だが、空きが
    // 埋まると0閃の no-op になり、手札から消えたカードの予約も0閃になる。
    // 旧実装はこの「積み < 要件」を "would only happen if the gate let
    // through a non-fireable plan" として return false しており、到達すると
    // 予約もキューも永久に凍結した (ランダム入力ファズで実際に発生 —
    // test/invariants.test.ts)。
    //
    // ここでは到達経路を再現するのではなく、その状態を直接組んで
    // 「必ず発動する」という契約だけを固定する。積み不足は既定行動で
    // 埋められ、重カードは要件どおりの積みを持って発動しなければならない。
    const s = initGame({
      matchSeed: 2n, hpMax: 1000,
      deckP0: Array(20).fill(CardId.Defend), deckP1: Array(20).fill(CardId.Defend),
    });
    const p = s.players[0];
    step(s, 0, 0);
    // 手札: slot0 = 安いカード, slot1 = 重撃 (積み2閃)。手札は満杯。
    p.hand[0] = CardId.Defend;
    p.hand[1] = CardId.Bludgeon;
    for (let i = 2; i < 6; i++) p.hand[i] = CardId.Defend;
    // 積み1閃 (防御) しかないのに、その後ろに積み2閃の重撃が並んだ状態。
    p.reservations.length = 0;
    p.reservations.push({ kind: "card", slotIndex: 0 });
    p.reservations.push({ kind: "card", slotIndex: 1 });

    let resolved = false;
    for (let f = 0; f < 60 * FRAMES_PER_SEN && !resolved; f++) {
      step(s, 0, 0);
      resolved = p.resolvedCards.some((r) => r.cardId === CardId.Bludgeon);
    }
    expect(resolved, "重撃が永久に発動しない (予約デッドロック)").toBe(true);
    expect(p.reservations.length).toBe(0);
  });

  it("連閃: consecutive card resolves build the chain; a draw resolve resets it", () => {
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    s.players[1].block = 0;
    const hp0 = s.players[1].hp;
    // Commit 3 strikes: S1 fires, S2/S3 wait in reservations.
    queueAnyStrike(s, 0); queueAnyStrike(s, 0); queueAnyStrike(s, 0);

    // S1 resolves (~3s): renzan 1 → no bonus. Strike = 6.
    for (let f = 0; f < 185; f++) step(s, 0, 0);
    expect(s.players[0].renzan).toBe(1);
    const d1 = hp0 - s.players[1].hp;
    expect(d1).toBeGreaterThanOrEqual(6);
    expect(d1).toBeLessThanOrEqual(6.5);

    // S2 resolves: renzan 2 → +1 (deals 7)。アイドルの相手は休息で +1
    // 回復する (4.5s 時点) ので、ウィンドウの正味は 7−1 = 6。
    const hp1 = s.players[1].hp;
    for (let f = 0; f < 180; f++) step(s, 0, 0);
    expect(s.players[0].renzan).toBe(2);
    expect(hp1 - s.players[1].hp).toBeGreaterThanOrEqual(6);

    // S3 resolves: renzan 3 → +2 (deals 8)。休息回復 −1 で正味 7。
    const hp2 = s.players[1].hp;
    for (let f = 0; f < 180; f++) step(s, 0, 0);
    expect(s.players[0].renzan).toBe(3);
    expect(hp2 - s.players[1].hp).toBeGreaterThanOrEqual(7);

    // Explicit Draw press (オートパイロット廃止 — 無操作なら連閃は保持
    // されたまま時間だけが流れる)。When that draw RESOLVES the chain
    // resets to 0.
    step(s, 1 /* INPUT_DRAW */, 0);
    let sawReset = false;
    for (let f = 0; f < 1000 && !sawReset; f++) {
      step(s, 0, 0);
      if (s.players[0].renzan === 0) sawReset = true;
    }
    expect(sawReset).toBe(true);
  });

  it("熟成: card transforms after exactly matureSen 閃 in hand; playing early keeps the base form", () => {
    // Hand: lone 業火の種 (matures into 業火 after 2閃 = 360 frames).
    // Deck has only that one card, so the forced-default Draw can never
    // refill the hand and the seed sits undisturbed.
    const deck = [CardId.EmberSeed];
    const s = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    const slot = s.players[0].hand.indexOf(CardId.EmberSeed);
    expect(slot).toBeGreaterThanOrEqual(0);

    // 1 frame before the threshold: still a seed.
    for (let f = 0; f < 359; f++) step(s, 0, 0);
    expect(s.players[0].hand[slot]).toBe(CardId.EmberSeed);
    // At the threshold frame: transformed.
    for (let f = 0; f < 3; f++) step(s, 0, 0);
    expect(s.players[0].hand[slot]).toBe(CardId.EmberBurst);

    // Early play keeps the base form: fresh game, click the seed at once.
    const s2 = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    const slot2 = s2.players[0].hand.indexOf(CardId.EmberSeed);
    step(s2, cardFlag(slot2)!, 0);
    const queued = s2.players[0].queue.find((q) => q.kind === "card");
    expect(queued && (queued as { cardId: number }).cardId).toBe(CardId.EmberSeed);
  });

  it("熟成: 予約中のカードは時間凍結 — 予約済みの花が腐って予約が死ぬことはない", () => {
    // Seed matures to a bloom, gets RESERVED behind a long queue, and must
    // still be the bloom (not rust/ash) when its reservation finally fires
    // — reservations never fail (game law).
    const deck = [CardId.EmberSeed, CardId.Bludgeon];
    const s = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    const slot = s.players[0].hand.indexOf(CardId.EmberSeed);
    expect(slot).toBeGreaterThanOrEqual(0);
    // Mature the seed (2閃).
    for (let f = 0; f < 365; f++) step(s, 0, 0);
    expect(s.players[0].hand[slot]).toBe(CardId.EmberBurst);
    // Reserve the burst, then idle past its 3閃 rot window. Frozen: stays.
    step(s, cardFlag(slot)!, 0);
    // It may fire into the queue immediately (queue empty) — if so, that
    // IS the reservation succeeding. Otherwise it must survive in hand.
    let fired = false;
    for (let f = 0; f < 800; f++) {
      step(s, 0, 0);
      if (s.players[0].queue.some((q) => q.kind === "card" && (q as { cardId: number }).cardId === CardId.EmberBurst)
          || s.players[0].discard.includes(CardId.EmberBurst)) { fired = true; break; }
      if (s.players[0].hand[slot] === CardId.EmberAsh) break; // rot = fail
    }
    expect(fired).toBe(true);
  });

  it("熟成チェーン: 業火を放置すると3閃で灰に変質する (使用ウィンドウ)", () => {
    const deck = [CardId.EmberSeed];
    const s = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    const slot = s.players[0].hand.indexOf(CardId.EmberSeed);
    // 2閃 → 業火.
    for (let f = 0; f < 365; f++) step(s, 0, 0);
    expect(s.players[0].hand[slot]).toBe(CardId.EmberBurst);
    // さらに3閃放置 → 灰 (プレイ不可).
    for (let f = 0; f < 545; f++) step(s, 0, 0);
    expect(s.players[0].hand[slot]).toBe(CardId.EmberAsh);
  });

  it("脆弱は整数演算 (+floor(dmg/2))、弱体×2との重ね掛けも全整数", () => {
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    s.players[1].block = 0;
    s.players[1].vulnerableSecs = 60; // 脆弱のみ
    const hp0 = s.players[1].hp;
    queueAnyStrike(s, 0);
    for (let f = 0; f < 185; f++) step(s, 0, 0);
    // Strike 6 → 6 + floor(6/2) = 9 (整数のまま)。
    expect(hp0 - s.players[1].hp).toBe(9);

    const s2 = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    s2.players[1].block = 0;
    s2.players[1].vulnerableSecs = 60;
    s2.players[1].weakSecs = 60; // 弱体+脆弱
    const hp1 = s2.players[1].hp;
    queueAnyStrike(s2, 0);
    for (let f = 0; f < 185; f++) step(s2, 0, 0);
    // 6 ×2(弱体) = 12 → +floor(12/2) = 18。
    expect(hp1 - s2.players[1].hp).toBe(18);
  });

  it("烈閃: スケジュールはシードから決定論的、その閃に解決した攻撃は+4", async () => {
    const { surgeSens, isSurgeSen } = await import("../src/sim/events");
    // Deterministic schedule.
    expect([...surgeSens(123n)]).toEqual([...surgeSens(123n)]);
    const sens = [...surgeSens(1n)].sort((a, b) => a - b);
    expect(sens.length).toBeGreaterThan(10);
    expect(sens[0]).toBeGreaterThanOrEqual(6);

    // A Strike timed to RESOLVE inside the first surge 閃 deals 6+4.
    const E = sens[0];
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 1000, deckP0: deck, deckP1: deck });
    expect(isSurgeSen(1n, E)).toBe(true);
    // Click at frame (E-1)*180+1 → cast 1閃 → resolves at frame E*180+1 (sen E).
    while (s.frame < (E - 1) * 180 + 1) step(s, 0, 0);
    s.players[0].queue = []; s.players[0].reservations = []; // clean slate
    s.players[1].block = 0;
    const hpBefore = s.players[1].hp;
    queueAnyStrike(s, 0);
    for (let f = 0; f < 185; f++) step(s, 0, 0);
    const dealt = hpBefore - s.players[1].hp;
    // 6 base + 4 surge (renzan may add a little if a prior auto-card chain
    // existed — we cleared the queue, but earlier auto-plays raised renzan,
    // so accept 10..15).
    expect(dealt).toBeGreaterThanOrEqual(10);
  });

  it("サドンデス: 第30閃から毎閃ダメージ (休息回復と相殺)、加速で必ず終わる", () => {
    // 両者アイドル → 休息 (+1/閃) が焦土の第1段階 (−1/閃) を相殺する。
    // これは意図された駆け引き: 休息で焦土を凌げるのは加速されるまで。
    const deck = Array(20).fill(CardId.Defend);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    // Up to (but not including) frame 5400 (= 第30閃): untouched.
    while (s.frame < 5400) step(s, 0, 0);
    expect(s.players[0].hp).toBe(80);
    expect(s.players[1].hp).toBe(80);
    // 30..39閃: 焦土1 vs 休息1 — 振動するがほぼ満タンに留まる。
    while (s.frame < 7200) step(s, 0, 0);
    expect(s.players[0].hp).toBeGreaterThanOrEqual(78);
    // 40閃以降は焦土が加速 (2,3,…) して休息を上回る → 必ず終局する。
    for (let f = 0; f < 25000 && s.result === 0; f++) step(s, 0, 0);
    expect(s.result).not.toBe(0);
  });

  it("時間グリッド: 入力タイミングの差は閃境界に吸収される (反射神経の排除)", () => {
    // 休息がキューを常に埋めるため、行動は現在のエントリの区切りからしか
    // 始まらない。休息中のどのフレームでクリックしても (f=10 でも f=100
    // でも)、カードは同じ閃境界で発火し、同じフレームで解決する。
    const deck = Array(20).fill(CardId.Strike);
    const resolveFrame = (clickFrame: number): number => {
      const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
      for (let f = 0; f < 1000; f++) {
        step(s, s.frame === clickFrame ? cardFlag(0)! : 0, 0);
        if (s.players[0].resolvedCards.some((r) => r.cardId === CardId.Strike)) return s.frame;
      }
      return -1;
    };
    const early = resolveFrame(10);
    const late = resolveFrame(100);
    expect(early).toBeGreaterThan(0);
    expect(early).toBe(late); // 90フレームの入力差が完全に消える
  });

  it("既定行動: 空きがあれば1枚ドロー、満杯なら休息 (HP+1)", () => {
    // 空きスロットあり → 自動で1枚ドローが積まれる。
    const deck = Array(20).fill(CardId.Strike);
    const s = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    step(s, 0, 0);
    const head = s.players[0].queue[0];
    expect(head?.kind).toBe("draw");
    expect(head?.kind === "draw" && head.drawSlots.length).toBe(1); // 1枚ドロー

    // 手札満杯 → 休息が積まれ、1閃後に HP+1。
    const s2 = initGame({ matchSeed: 1n, hpMax: 80, deckP0: deck, deckP1: deck });
    const p = s2.players[0];
    for (let i = 0; i < 6; i++) p.hand[i] = CardId.Strike;
    p.hp = 50;
    step(s2, 0, 0);
    expect(s2.players[0].queue[0]?.kind).toBe("rest");
    for (let f = 0; f < 185; f++) step(s2, 0, 0);
    expect(s2.players[0].hp).toBe(51);
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

// 完全対称: 両者は同じ閃グリッドを共有し、先手/後手の区別 (初期ブロック・
// 半閃オフセット) は存在しない。ミラー入力はミラー状態を生み、同時致死は
// 引き分けになる — パリィ等の「同一境界の相互作用」を成立させる土台。
describe("完全対称 (perfect symmetry)", () => {
  // Mono-card decks make both players' hands identical regardless of the
  // per-handle shuffle seed, so identical inputs are a true mirror.
  const mirrorInit = () => ({
    matchSeed: 7n,
    hpMax: 30,
    deckP0: Array.from({ length: 20 }, () => CardId.Strike),
    deckP1: Array.from({ length: 20 }, () => CardId.Strike),
  });

  it("ミラー入力は全フレームで鏡像状態を保ち、同時致死で引き分けになる", () => {
    const s = initGame(mirrorInit());
    expect(s.players[0].block).toBe(s.players[1].block);
    expect(s.players[0].castStartedAt).toBe(s.players[1].castStartedAt);
    for (let f = 0; f < 36000 && s.result === 0; f++) {
      // Both sides press slot 1 every 2 閃 — same flag, same frame.
      const flag = f % 360 === 0 ? cardFlag(0)! : 0;
      step(s, flag, flag);
      expect(s.players[0].hp).toBe(s.players[1].hp);
      expect(s.players[0].block).toBe(s.players[1].block);
    }
    expect(s.result).toBe(3); // 同時にHP0 → 引き分け (どちらかの勝ちではない)
  });

  it("無入力でも完全鏡像 — 既定行動と焦土だけで両者同時に決着する", () => {
    const s = initGame(mirrorInit());
    for (let f = 0; f < 60000 && s.result === 0; f++) step(s, 0, 0);
    expect(s.result).toBe(3);
  });
});
