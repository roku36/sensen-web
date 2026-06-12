# sensen-web

[Sensen](https://github.com/roku36/sensen) (a Bevy/Rust real-time card game) ported to the web. Deterministic 60 Hz simulation, rollback netcode over WebRTC P2P, React UI.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 (this repo's dev sessions often use `--port 5175`). **CPU と対戦** for solo play vs the AI ladder, or **Find Match (online)** to pair via a [matchbox](https://github.com/johanhelsing/matchbox) signaling server.

```bash
# matchbox-server (defaults to ws://localhost:3536/sensen?next=2)
docker run -p 3536:3536 ghcr.io/johanhelsing/matchbox_server
# or: cargo install matchbox_server && matchbox_server
```

## ゲームルール (cast-time model)

時間の単位は **閃** (1閃 = 3秒 = 180フレーム)。カードを引くのも撃つのも時間を消費し、その間あなたの行動は**相手に公開**される。

| 仕組み | 概要 |
|---|---|
| キューと予約 | クリックで予約 (キャンセル可・相手には見えない)。キューに入った瞬間が「確定」(公開・取消不可)。**予約は失敗しない**のがゲームの根本法則 |
| 積みコスト (重カード) | 重撃などは「残りチェーン ≥ N閃」のちょうどその瞬間に確定する。1閃=180フレームの整数クロックで厳密判定 |
| 連閃 | ドローを挟まずカードを連続発動するたび攻撃+1 (最大+5)。ドロー発動でリセット — 補充は時間と勢いの二重コスト |
| 熟成 / 変質 | 業火の種・鉄の蕾は手札で2閃寝かせると強化形態に変化、出来てから3閃で灰/錆に腐る。予約中は時計が凍結 |
| 烈閃 | シード由来の公開タイムライン地形 (約7〜10閃間隔)。その閃に解決した攻撃は+4 |
| 焦土 | 第30閃から両者に毎閃ダメージ (10閃ごとに加速)。試合は必ず終わる |
| 弱体 / 脆弱 | どちらも防御側: 弱体=被ダメージ×2、脆弱=+floor(dmg/2)。全ダメージ計算は整数演算 |

## モード

- **CPU対戦** — AI戦略ラダー Lv1ランダム / Lv2テンポ型 / Lv3読み型 (公開キュー読み・ジャストブロック・連閃維持・烈閃合わせ) / Lv4先読み型 (実シムのロールアウト探索)。強さ序列は決定論勝率テストで恒久保証
- **パズル (閃の詰め将棋)** — 固定盤面から制限閃数で削り切る5問。各問が想定解を内蔵し「解ける/放置では解けない」をテストで保証
- **AI検証ラボ** — headless 100戦実行 (対Lv1・任意ペア)、勝率表示、全対戦のリプレイ保存→ビューア直行
- **リプレイ** — 入力列+シードから完全再現。シーク/速度/視点切替
- **オンライン対戦** — rollback P2P。連勝ストリークによるマッチング帯

## Architecture

| Layer | Where | What |
|---|---|---|
| Pure deterministic reducer | `src/sim/` | cards, queue/reservation scheduler (frame-exact), 連閃, 熟成 (`tickMaturing`), 烈閃 (`events.ts`), 焦土, checksum |
| Future prediction | `src/sim/predict.ts` | "run the real reducer forward" — UI never re-implements sim logic. Cached by state signature, shifted per-frame |
| AI ladder | `src/ai/policy.ts` | Lv1–Lv4。Lv4 はスナップショット+実シムのロールアウトで候補手を評価 |
| Rollback engine | `src/net/rollback.ts` | snapshot, input-prediction, resimulate, FNV-1a-64 checksum |
| P2P transport | `src/net/matchbox.ts`, `wire.ts`, `session.ts` | matchbox JSON wire + WebRTC unreliable DataChannel |
| Offline session | `src/net/offline.ts` | fixed-step loop, AI policies, beginnerMode (閃送り), fixed matchSeed (パズル用) |
| Self-play lab | `src/lab/` | headless runner + localStorage replay store |
| Puzzles | `src/puzzles/defs.ts` | 盤面定義 + 想定解 (テストが恒久検証) |
| Screens | `src/ui/screens/` | Title / Lobby / SimpleGameplay + Timeline / DeckBuilder / ReplayViewer / LabDashboard / PuzzleScreen |
| Tests | `test/` | determinism, P2P consistency, AI ladder win rates, mature balance, puzzles, lab runner + Playwright scripts (`test/integration/`) |

注: 3D ビュー (`src/ui/scene/`) は v1 世代のまま新ルール未対応 — issue #5 参照。2D Simple が正。

## How P2P consistency is guaranteed

Both peers run the **same pure reducer** on the **same inputs in the same order**. The reducer's only RNG is a u64 LCG (`6364136223846793005 * state + 1`) seeded from the match seed and player handle — bit-identical to the Bevy source. State changes are funneled through a sorted message bus inside one frame, so message ordering is stable across machines.

Each peer:

1. Buffers local input with `INPUT_DELAY` frames of input delay (6 @ 60Hz).
2. Sends every frame's input to the peer (even empty frames, so the peer's prediction is never starved).
3. Predicts the remote's input as "no press" if no confirmation has arrived.
4. On every confirmed-input message, if the prediction was wrong, restores the snapshot at that frame and re-steps forward — bounded by `MAX_ROLLBACK = 120` frames (2 s).
5. Stalls itself if it gets more than 30 frames ahead of the remote's confirmed inputs (frame-advantage cap) — keeps rollback distance bounded under jitter.
6. Hashes its confirmed state every 30 frames and exchanges the hash with the peer; a mismatch surfaces as a `desync` event and the match halts rather than silently drifting.

## Tests

```bash
npm test                                   # vitest: 53 tests (determinism / P2P / AI ladder / balance / puzzles / lab)
node test/integration/puzzle-check.mjs     # パズルE2E (要 dev server)
node test/integration/lab-dashboard.mjs    # ラボE2E: 100戦実行→勝率→リプレイ遷移→永続化
node test/integration/spec-verify.mjs      # 重カード確定タイミングの仕様シナリオ
node test/integration/p2p-browser.mjs      # 2 real Chromium tabs over real WebRTC
```
