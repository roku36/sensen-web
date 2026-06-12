// パズルモード — 決定論シムの「詰め将棋」。
//
// 固定盤面から N閃以内に相手のHPを削り切る。各パズルは実装済みの戦略軸
// (連閃 / 重カードの原子発火 / 烈閃合わせ) の教材を兼ねる。
//
// 各定義は `solution` (想定解の入力列) を持ち、ユニットテストが
// 「想定解で予算内に勝てる」「オートパイロット放置では勝てない」を
// 恒久的に保証する — パズルが将来のバランス変更で壊れたら即検知される。

import { CardId } from "../sim/cards";
import { surgeSens } from "../sim/events";
import { cardFlag } from "../sim/input";
import { GameState } from "../sim/state";

export interface PuzzleDef {
  id: string;
  title: string;
  goal: string;
  hint: string;
  budgetSen: number;
  matchSeed: bigint;
  /** P0 の手札 (6スロット固定)。 */
  hand: (CardId | null)[];
  oppHp: number;
  /** 想定解: フレーム→入力フラグ。テストで解けることを保証する。 */
  solution: { f: number; flags: number }[];
}

/** initGame 直後の状態をパズル盤面に変形する。 */
export function setupPuzzle(s: GameState, def: PuzzleDef) {
  const p0 = s.players[0];
  const p1 = s.players[1];
  // P0: 手札だけが資源 (deck空 = ドローは無意味)。
  p0.hand = def.hand.slice();
  p0.deck = [];
  p0.discard = [];
  p0.queue = [];
  p0.reservations = [];
  // P1: 完全に無力なターゲット (手札なし・デッキなし・後手ブロックも没収)。
  p1.hand = Array.from({ length: 6 }, () => null);
  p1.deck = [];
  p1.discard = [];
  p1.queue = [];
  p1.reservations = [];
  p1.hp = def.oppHp;
  p1.hpMax = def.oppHp;
  p1.block = 0;
  p1.blockHistory = [{ t: 0, block: 0 }];
  p1.nextBlockDecayAt = Infinity;
}

// シード選定: 烈閃スケジュールが条件を満たす最小シードを決定論的に走査。
function findSeed(pred: (firstSurge: number) => boolean): bigint {
  for (let s = 1n; s < 500n; s++) {
    const first = Math.min(...surgeSens(s));
    if (pred(first)) return s;
  }
  throw new Error("no seed found");
}

const SEED_LATE_SURGE = findSeed((f) => f >= 7);   // P1/P2: 烈閃が計算を汚さない
const SEED_SURGE_AT_6 = findSeed((f) => f === 6);  // P3: 第6閃に烈閃

const F = (slot: number) => cardFlag(slot)!;

export const PUZZLES: PuzzleDef[] = [
  {
    id: "p1-renzan",
    title: "其の一: 連閃の基本",
    goal: "3閃以内に 21 ダメージを削り切れ",
    hint: "打撃は素の6ダメージ。だが連閃を切らさなければ……",
    budgetSen: 3,
    matchSeed: SEED_LATE_SURGE,
    hand: [CardId.Defend, CardId.Strike, CardId.Strike, CardId.Strike, CardId.Defend, CardId.Defend],
    oppHp: 21, // 6+7+8 (連閃) — 防御を1枚でも挟むと届かない
    solution: [
      { f: 0, flags: F(1) },
      { f: 1, flags: F(2) },
      { f: 2, flags: F(3) },
    ],
  },
  {
    id: "p2-heavy",
    title: "其の二: 重撃の積み",
    goal: "5閃以内に 56 ダメージを削り切れ",
    hint: "重撃は積み2閃が必要。打撃2枚を先に予約すれば……",
    budgetSen: 5,
    matchSeed: SEED_LATE_SURGE,
    hand: [CardId.Defend, CardId.Strike, CardId.Strike, CardId.Strike, CardId.Bludgeon, CardId.Defend],
    oppHp: 56, // 6+7+8 + 重撃(32+連閃3) = 56
    solution: [
      { f: 0, flags: F(1) },
      { f: 1, flags: F(2) },
      { f: 2, flags: F(3) },
      { f: 3, flags: F(4) },
    ],
  },
  {
    id: "p4-mature",
    title: "其の四: 熟成の刻",
    goal: "4閃以内に 36 ダメージを削り切れ",
    hint: "業火の種は即撃ち4。だが2閃寝かせれば業火20に化ける。種は予約すると熟成が止まるぞ — 他のカードで繋いで時間を稼げ。",
    budgetSen: 4,
    matchSeed: SEED_LATE_SURGE,
    // 種は手札に置いたまま熟成させ (予約すると時計が凍結する!)、
    // 打撃×2+防御の橋渡しでキューを途切れさせず、変化した業火を
    // 4枚目に差し込む。橋渡しがないと強制デフォルトのドローが捨札を
    // 回収して連閃が切れる — その理解自体がこの問題の主題。
    hand: [CardId.EmberSeed, CardId.Strike, CardId.Strike, CardId.Defend, CardId.Defend, CardId.Defend],
    oppHp: 36, // 打撃6 + 打撃7(連閃) + 防御0 + 業火20+3(連閃4枚目) = 36
    solution: [
      { f: 0, flags: F(1) },
      { f: 1, flags: F(2) },
      { f: 2, flags: F(3) },
      // 種は f360 に業火へ変化。防御が解決する f540 までの約1閃の間の
      // どこかで予約すれば良い (人間でも余裕のあるウィンドウ)。
      { f: 400, flags: F(0) },
    ],
  },
  {
    id: "p3-retsusen",
    title: "其の三: 烈閃合わせ",
    goal: "6閃以内に 19 ダメージを削り切れ",
    hint: "捕食は一度きりの10ダメージ。連閃を限界まで繋ぎ、烈閃に着地させれば……",
    budgetSen: 6,
    matchSeed: SEED_SURGE_AT_6,
    // 捕食 (exhausts) なので捨札リサイクルで回収できない — 一発勝負。
    // 防御はドローで回収されてもダメージ0なので、放置プレイは永遠に
    // 19 を削れない (即撃ちも 10 止まり)。
    hand: [CardId.Feed, CardId.Defend, CardId.Defend, CardId.Defend, CardId.Defend, CardId.Defend],
    oppHp: 19, // 10 + 連閃5 + 烈閃4 — 完璧なタイミングでのみ届く
    solution: [
      { f: 0, flags: F(1) },
      { f: 1, flags: F(2) },
      { f: 2, flags: F(3) },
      { f: 3, flags: F(4) },
      { f: 4, flags: F(5) },
      { f: 5, flags: F(0) },
    ],
  },
];
