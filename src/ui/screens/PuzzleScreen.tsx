// パズルモード — 決定論シムの詰め将棋。
//
// 一覧から選ぶと beginnerMode の OfflineSession を起動し、initGame 直後の
// 状態を setupPuzzle で固定盤面に変形する。シムは「次の閃」を押すまで
// 凍結されるので、開始直後にオートパイロットが手を打ってしまうことは
// なく、純粋な計画パズルになる。クリア判定は store の game を監視。

import { useState } from "react";
import { PuzzleDef, PUZZLES, setupPuzzle } from "../../puzzles/defs";
import { OfflineSession } from "../../net/offline";
import { FRAMES_PER_SEN } from "../../sim/rules";
import { backToTitle, getSession, startOffline } from "../hooks";
import { useStore } from "../store";
import { SimpleGameplay } from "./SimpleGameplay";

export function PuzzleScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const game = useStore((s) => s.game);
  useStore((s) => s.gameFrame);
  const [active, setActive] = useState<PuzzleDef | null>(null);

  const start = async (def: PuzzleDef) => {
    // targetScreen=null: 画面は "puzzle" のまま (フリップするとこの
    // コンポーネントがアンマウントされ選択状態が消える)。デッキは
    // ダミー — 直後に setupPuzzle が盤面を上書きする。
    await startOffline([1, 1, 1, 1, 1], { beginnerMode: true, matchSeed: def.matchSeed }, null);
    const sess = getSession();
    if (sess instanceof OfflineSession) setupPuzzle(sess.state_(), def);
    setActive(def);
  };

  const exit = async () => {
    await backToTitle();
    useStore.getState().setScreen("puzzle");
    setActive(null);
  };

  // ── 一覧 ──
  if (!active) {
    return (
      <div style={page}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button style={ghostBtn} onClick={() => setScreen("title")}>← タイトル</button>
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: 2 }}>パズル — 閃の詰め将棋</h2>
          <span style={{ fontSize: 11, opacity: 0.55 }}>
            固定盤面から制限閃数以内に削り切れ · 「次の閃」で時間を進める
          </span>
        </div>
        <div style={grid}>
          {PUZZLES.map((p) => (
            <div key={p.id} style={card}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{p.title}</div>
              <div style={{ fontSize: 12, marginTop: 6, color: "#ffd166" }}>{p.goal}</div>
              <div style={{ fontSize: 11, marginTop: 6, opacity: 0.6, lineHeight: 1.5 }}>{p.hint}</div>
              <button style={startBtn} onClick={() => void start(p)}>挑戦する</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── プレイ中: SimpleGameplay の上に目標バナー + 結果オーバーレイ ──
  const frame = game ? game.frame : 0;
  const senUsed = Math.max(0, Math.floor((frame - 1) / FRAMES_PER_SEN));
  const result = game?.result ?? 0;
  const cleared = result === 1 && senUsed <= active.budgetSen;
  const failed = !cleared && (result !== 0 || senUsed > active.budgetSen);

  return (
    <>
      <SimpleGameplay />
      <div style={banner}>
        <b>{active.title}</b>
        <span style={{ marginLeft: 12, color: "#ffd166" }}>{active.goal}</span>
        <span style={{ marginLeft: 12, opacity: 0.8 }}>
          経過 {Math.min(senUsed, active.budgetSen)} / {active.budgetSen}閃
        </span>
      </div>
      {(cleared || failed) && (
        <div style={resultOverlay}>
          <div style={resultBox}>
            <div style={{ fontSize: 34, fontWeight: 800, color: cleared ? "#7fe3a4" : "#ff8a8a" }}>
              {cleared ? "成功！" : "失敗…"}
            </div>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>
              {cleared
                ? `${senUsed}閃で削り切った`
                : result === 1 ? "削り切ったが予算オーバー" : "予算内に削り切れなかった"}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "center" }}>
              <button style={startBtn} onClick={() => void start(active)}>リトライ</button>
              <button style={ghostBtn} onClick={() => void exit()}>一覧へ</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const page: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
  padding: 18, gap: 16, overflowY: "auto",
  background: "linear-gradient(180deg, #14141c 0%, #0a0a12 100%)",
  fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "white",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent", color: "#aaa", border: "1px solid #333",
  borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12,
};
const grid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 340px))", gap: 12,
};
const card: React.CSSProperties = {
  background: "#181822", border: "1px solid #2a2a35", borderRadius: 10, padding: 16,
  display: "flex", flexDirection: "column",
};
const startBtn: React.CSSProperties = {
  marginTop: 12, background: "#5a3a8a", color: "white", border: 0,
  borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const banner: React.CSSProperties = {
  position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
  background: "rgba(20, 18, 32, 0.92)", border: "1px solid #5a3a8a",
  borderRadius: 8, padding: "7px 16px", fontSize: 13, color: "white",
  zIndex: 50, pointerEvents: "none", whiteSpace: "nowrap",
};
const resultOverlay: React.CSSProperties = {
  position: "absolute", inset: 0, display: "grid", placeItems: "center",
  background: "rgba(0,0,0,0.65)", zIndex: 9999,
};
const resultBox: React.CSSProperties = {
  background: "#181822", border: "1px solid #3a3a4a", borderRadius: 14,
  padding: "30px 48px", textAlign: "center", color: "white",
};
