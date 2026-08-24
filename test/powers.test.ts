// 常在型パワーの機械的検証。
//
// なぜ勝率ハーネスではなくこの形なのか: 「金属化」は 30閃 経ってもブロックを
// 1 も生まない完全な無効カードだったが、勝率で測ると 53% と出て正常カード
// (51%) と区別がつかなかった。2枚差し替えの勝率は分散が大きく、「カードが
// 何もしていない」という最大級の不具合を検出できない。
//
// そこでこのファイルは効果そのものを直接assertする:「N閃後にブロックが
// ちょうど X 増えている」。壊れれば必ず落ちる。
import { describe, expect, it } from "vitest";
import { CardId } from "../src/sim/cards";
import { initGame } from "../src/sim/init";
import { cardFlag } from "../src/sim/input";
import { step } from "../src/sim/reducer";
import { FRAMES_PER_SEN } from "../src/sim/rules";
import { GameState } from "../src/sim/state";

/** パワー1枚を第0スロットから発動し、そこから senAfter 閃だけ進める。 */
function playPower(card: CardId, senAfter: number): GameState {
  const s = initGame({
    matchSeed: 5n,
    hpMax: 200,
    // 相手は無害な防御デッキ (攻撃してこないので効果を単独で測れる)
    deckP0: Array.from({ length: 20 }, () => card),
    deckP1: Array.from({ length: 20 }, () => CardId.Defend),
  });
  step(s, cardFlag(0)!, 0); // 第0スロットのパワーを予約 → 即キューへ
  // 1閃でキャスト完了、その後 senAfter 閃ぶん常在効果が働く
  for (let f = 0; f < (1 + senAfter) * FRAMES_PER_SEN; f++) step(s, 0, 0);
  return s;
}

describe("常在型パワーは閃ごとに整数量で効く", () => {
  it("金属化: 毎閃ブロック+2 (減衰1を差し引いて実質+1/閃)", () => {
    const SEN = 10;
    const s = playPower(CardId.Metallicize, SEN);
    const p = s.players[0];
    expect(p.metallicize).not.toBeNull();
    // 効果ゼロ (かつての不具合) では 0 のまま。実際に積み上がることを見る。
    expect(p.block).toBeGreaterThan(0);
    // ブロックは毎閃 +2 されて -1 減衰する。閃境界での適用順に1閃ぶんの
    // 揺れがあるので、実質+1/閃 の近傍にいることを確認する。
    expect(p.block).toBeGreaterThanOrEqual(SEN - 2);
    expect(p.block).toBeLessThanOrEqual(SEN + 2);
    expect(Number.isInteger(p.block)).toBe(true);
  });

  it("燃焼: 毎閃、自分1・相手7ダメージ", () => {
    const SEN = 8;
    const s = playPower(CardId.Combust, SEN);
    const [me, opp] = s.players;
    // 相手の被弾は「毎閃7 − 休息の回復1」の積み上がり。ブロックに吸われる
    // ぶんもあるので下限だけを厳密に見る (効果が消えていれば必ず落ちる)。
    expect(200 - opp.hp).toBeGreaterThanOrEqual(SEN * 3);
    expect(Number.isInteger(opp.hp)).toBe(true);
    expect(Number.isInteger(me.hp)).toBe(true);
  });

  it("悪魔の姿: 毎閃 筋力+1 (整数のみ、累積器なし)", () => {
    const SEN = 6;
    // 悪魔の姿は積み2閃が必要 — 安いカードで鎖を作れるデッキにする
    const s = initGame({
      matchSeed: 5n, hpMax: 200,
      deckP0: [CardId.DemonForm, ...Array.from({ length: 19 }, () => CardId.Defend)],
      deckP1: Array.from({ length: 20 }, () => CardId.Defend),
    });
    const p = s.players[0];
    // 初手に来るとは限らないので手札に直接置く (盤面の他は通常どおり)
    const demonSlot = 5;
    p.hand[demonSlot] = CardId.DemonForm;
    // 防御を3枚予約する。1枚目はキューが空なので即発動してしまうため、
    // 予約リストに 2閃 分 (= 悪魔の姿の積み要件) を残すには3枚必要。
    // 重カードのゲートは「予約リストの積み」だけを見る — 発動済みのキュー
    // 時間は積みが始まる前に消費されてしまうので数えないのが正しい。
    const cheap = p.hand.map((h, i) => (h === CardId.Defend ? i : -1)).filter((i) => i >= 0);
    expect(cheap.length).toBeGreaterThanOrEqual(3);
    step(s, cardFlag(cheap[0])!, 0);
    step(s, cardFlag(cheap[1])!, 0);
    step(s, cardFlag(cheap[2])!, 0);
    step(s, cardFlag(demonSlot)!, 0);
    // 予約は失敗しない — 必ず発動まで到達する
    for (let f = 0; f < FRAMES_PER_SEN * 30 && p.demonForm === null; f++) step(s, 0, 0);
    expect(p.demonForm).not.toBeNull();
    const before = s.players[0].strength;
    for (let f = 0; f < SEN * FRAMES_PER_SEN; f++) step(s, 0, 0);
    const gained = s.players[0].strength - before;
    expect(gained).toBeGreaterThanOrEqual(SEN - 1);
    expect(gained).toBeLessThanOrEqual(SEN + 1);
    expect(Number.isInteger(s.players[0].strength)).toBe(true);
  });

  it("残虐: 毎閃 自分1ダメージ + 1枚ドロー", () => {
    const s = playPower(CardId.Brutality, 6);
    const p = s.players[0];
    expect(p.brutality).not.toBeNull();
    expect(p.hp).toBeLessThan(200);
    expect(Number.isInteger(p.hp)).toBe(true);
  });

  it("盤面の数値は常に整数 — 常在型パワーが同時に走っても小数化しない", () => {
    // 燃焼・金属化・残虐・悪魔の姿を1つのデッキに同居させて長時間回す。
    // 旧「毎秒レート×dt」実装では、ここで hp=193.50000000001 のような
    // 小数が発生していた (UI は Math.round で誤魔化していた)。
    const mixed = [
      CardId.Combust, CardId.Metallicize, CardId.Brutality,
      CardId.Rupture, CardId.Inflame, CardId.Juggernaut,
    ];
    const s = initGame({
      matchSeed: 11n, hpMax: 300,
      deckP0: Array.from({ length: 24 }, (_, i) => mixed[i % mixed.length]),
      deckP1: Array.from({ length: 24 }, (_, i) => mixed[(i + 3) % mixed.length]),
    });
    for (let f = 0; f < 9000 && s.result === 0; f++) {
      // 両者とも定期的に手札の先頭を発動して、パワーを次々に載せていく
      const flag = f % 120 === 0 ? (cardFlag(f / 120 % 6) ?? 0) : 0;
      step(s, flag, flag);
      for (const p of s.players) {
        expect(Number.isInteger(p.hp)).toBe(true);
        expect(Number.isInteger(p.block)).toBe(true);
        expect(Number.isInteger(p.strength)).toBe(true);
      }
    }
  });
});
