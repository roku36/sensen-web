// 不変条件ファズ — ランダム入力で回して「決して起きてはならないこと」を
// 全フレーム検査する。
//
// このハーネスが実際に見つけた不具合:
//   1. 予約の永続デッドロック。重カードの積み要件はゲート通過後に縮みうる
//      (予約済みドローは手札に空きがある間は1閃だが、埋まると0閃のno-opに
//      なる)。縮むと重カードは永久に発動できず、キューも空のまま凍結して
//      いた — 「予約は失敗しない」と時間グリッドの両方が破れる。
//   2. HP の小数化。常在型パワーが毎フレーム端数を足していた。
//   3. no-op ドローを大量に積むと、安全カウンタの打ち切りでキューが1閃
//      だけ空になり、そこだけ行動開始点が入力フレームになっていた。
//
// 単体テストは「知っている壊れ方」しか守れない。ここは知らない壊れ方を
// 捕まえる担当なので、盤面の法則そのものを assert する。
import { describe, expect, it } from "vitest";
import { allCards, CardId } from "../src/sim/cards";
import { initGame } from "../src/sim/init";
import { cardFlag, INPUT_DRAW, INPUT_RESET_RESERVATIONS } from "../src/sim/input";
import { step } from "../src/sim/reducer";
import { FRAMES_PER_SEN } from "../src/sim/rules";

const PLAYABLE: CardId[] = allCards().filter((c) => c.cost < 900).map((c) => c.id);

/** 決定的な線形合同法 — シード固定なので失敗は必ず再現できる。 */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function deckFor(seed: number): CardId[] {
  const rnd = lcg(seed);
  return Array.from({ length: 24 }, () => PLAYABLE[Math.floor(rnd() * PLAYABLE.length)]);
}

// 予約の先頭が動かないまま何閃経ったら「詰み」とみなすか。
// 健全な実装での実測最長は 1.8閃 (予約が発動条件を待っている正常な間)。
// 本物のデッドロックは無限に続くので、20閃 なら誤検知ゼロで確実に捕まる。
const STALL_LIMIT_FRAMES = 20 * FRAMES_PER_SEN;

describe("盤面の不変条件 (ランダム入力ファズ)", () => {
  it("全カードプールを使った乱戦でも盤面の法則が破れない", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = lcg(seed * 7919);
      const s = initGame({
        matchSeed: BigInt(seed), hpMax: 80,
        deckP0: deckFor(seed), deckP1: deckFor(seed + 500),
      });
      const stall = [{ key: "", frames: 0 }, { key: "", frames: 0 }];

      for (let f = 0; f < 9000 && s.result === 0; f++) {
        const input = () => {
          const r = rnd();
          if (r < 0.02) return cardFlag(Math.floor(rnd() * 6)) ?? 0;
          if (r < 0.028) return INPUT_DRAW;
          if (r < 0.030) return INPUT_RESET_RESERVATIONS;
          return 0;
        };
        step(s, input(), input());

        const now = s.frame;
        for (let i = 0; i < 2; i++) {
          const p = s.players[i];
          const at = `seed=${seed} frame=${f} p${i}`;

          // 時間グリッド: キューは決して空白にならない。空白ができると
          // 次の行動の開始点が閃境界ではなく入力フレームになり、0.001秒の
          // 差が以後ずっと残る反射神経ゲームに退化する。
          expect(p.queue.length, `キュー空白 ${at}`).toBeGreaterThan(0);

          // 盤面の数値はすべて整数 (docs/game-design.md の整数演算)。
          expect(Number.isInteger(p.hp), `HP非整数 ${at}: ${p.hp}`).toBe(true);
          expect(Number.isInteger(p.block), `block非整数 ${at}: ${p.block}`).toBe(true);
          expect(Number.isInteger(p.strength), `筋力非整数 ${at}: ${p.strength}`).toBe(true);
          expect(Number.isInteger(p.poison), `毒非整数 ${at}: ${p.poison}`).toBe(true);

          expect(p.hp >= 0 && p.hp <= p.hpMax, `HP範囲外 ${at}: ${p.hp}`).toBe(true);
          expect(p.block, `blockが負 ${at}`).toBeGreaterThanOrEqual(0);
          expect(p.hand.length, `手札枠数 ${at}`).toBe(6);
          // 時刻はすべて整数フレーム。過去は未来を追い越さない。
          expect(Number.isInteger(p.castStartedAtFrame), `castStartedAtFrameが非整数 ${at}`).toBe(true);
          expect(p.castStartedAtFrame, `castStartedAtFrameが未来 ${at}`).toBeLessThanOrEqual(now);
          // 際限なく伸びる配列がないこと (メモリと予測コストの上限)
          expect(p.queue.length, `キュー暴走 ${at}`).toBeLessThan(64);
          expect(p.reservations.length, `予約暴走 ${at}`).toBeLessThan(64);
          expect(p.blockHistory.length, `blockHistory肥大 ${at}`).toBeLessThan(256);

          // 予約は失敗しない (ゲームの法): 先頭の予約が同じまま動かなく
          // なったら詰み。重カードの積み不足で永久凍結する不具合はここで
          // 落ちる — キューは既定行動で埋まってしまうため、キュー空白の
          // 検査だけでは捕まえられない。
          if (p.reservations.length === 0) {
            stall[i] = { key: "", frames: 0 };
          } else {
            const head = p.reservations[0];
            const key = `${p.reservations.length}:${head.kind}${head.kind === "card" ? head.slotIndex : ""}`;
            if (key === stall[i].key) {
              stall[i].frames++;
              expect(stall[i].frames, `予約が進まない (詰み) ${at}`).toBeLessThan(STALL_LIMIT_FRAMES);
            } else {
              stall[i] = { key, frames: 0 };
            }
          }
        }
      }
    }
  }, 120_000);

  // シムの法: 状態に小数は存在しない。個別フィールドを列挙するのではなく
  // GameState 全体を再帰的に走査して、数値が1つでも非整数なら落とす。
  // 新しいフィールドや新しい効果を足したときも自動で守られる — 「秒 × dt を
  // 整数に足す」という書き方そのものが、ここで必ず捕まる。
  it("GameState のあらゆる数値が整数 — 小数はシムに存在しない", () => {
    const offenders: string[] = [];
    const walk = (v: unknown, path: string, depth = 0) => {
      if (offenders.length > 8 || depth > 8) return;
      if (typeof v === "number") {
        if (!Number.isInteger(v)) offenders.push(`${path} = ${v}`);
        return;
      }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); return; }
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, depth + 1);
      }
    };

    for (let seed = 1; seed <= 8; seed++) {
      const rnd = lcg(seed * 104729);
      const s = initGame({
        matchSeed: BigInt(seed), hpMax: 80,
        deckP0: deckFor(seed), deckP1: deckFor(seed + 900),
      });
      for (let f = 0; f < 7000 && s.result === 0; f++) {
        const input = () => {
          const r = rnd();
          if (r < 0.025) return cardFlag(Math.floor(rnd() * 6)) ?? 0;
          if (r < 0.033) return INPUT_DRAW;
          return 0;
        };
        step(s, input(), input());
        if (f % 37 === 0) walk(s, `seed${seed}.f${f}`);
        if (offenders.length > 0) break;
      }
      if (offenders.length > 0) break;
    }
    expect(offenders, `非整数の状態: ${offenders.join(", ")}`).toEqual([]);
  }, 60_000);

  it("無操作の完全対称戦は必ず引き分けで終わる (焦土の終局保証)", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const deck = Array.from({ length: 20 }, () => CardId.Strike);
      const s = initGame({ matchSeed: BigInt(seed), hpMax: 40, deckP0: deck, deckP1: deck });
      let f = 0;
      for (; f < 60000 && s.result === 0; f++) step(s, 0, 0);
      expect(s.result, `seed=${seed} が終局しない`).toBe(3);
    }
  }, 60_000);
});
