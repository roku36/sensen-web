// Post-match panel.
//
// Win  → bump streak, show PostVictoryDraft (pick a card → goes to deck),
//        then "次のマッチへ" stays in the same streak bucket.
// Loss → reset streak and deck to defaults, banner explains, single button
//        back to title or restart from streak 0.
// Draw → counts as a streak reset (defensive — currently the sim can't
//        produce a draw in practice but the panel handles it cleanly).

import { useEffect, useRef, useState } from "react";
import { bumpStreak, loadStreak, resetProfile } from "../../sim/deck-storage";
import { backToTitle, getActiveMode, rematchOffline, rematchOnline } from "../hooks";
import { PostVictoryDraft } from "./PostVictoryDraft";

export function ResultPanel({
  result,
  localPlayer,
}: {
  result: 1 | 2 | 3;
  localPlayer: 0 | 1;
}) {
  const won = (result === 1 && localPlayer === 0) || (result === 2 && localPlayer === 1);
  const draw = result === 3;
  const mode = getActiveMode();

  // Persist the streak change ONCE per panel mount. useState initializers
  // run twice under React.StrictMode in dev, which would double-bump on a
  // win, so we put the side effect in a useEffect guarded by a ref.
  const previousStreak = useRef<number>(loadStreak()).current;
  const [streakAfter, setStreakAfter] = useState<number>(previousStreak);
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (won) setStreakAfter(bumpStreak());
    else { resetProfile(); setStreakAfter(0); }
  }, [won, draw]);

  return (
    <div style={overlay}>
      <div style={{ ...box, background: bgColor(won, draw) }}>
        <div style={resultText}>{draw ? "引き分け" : won ? "勝利" : "敗北"}</div>

        {won && (
          <div style={streakBadge}>連勝 {previousStreak} → {streakAfter} 🔥</div>
        )}
        {!won && !draw && previousStreak > 0 && (
          <div style={streakReset}>連勝 {previousStreak} → 0 (デッキ・連勝リセット)</div>
        )}

        {won && mode === "online" && <PostVictoryDraft streak={streakAfter} onResolved={rematchOnline} />}
        {won && mode === "offline" && <PostVictoryDraft streak={streakAfter} onResolved={rematchOffline} />}

        {!won && (
          <div style={btnRow}>
            {mode === "online" ? (
              <button style={primaryBtn} onClick={rematchOnline}>もう一度</button>
            ) : (
              <button style={primaryBtn} onClick={rematchOffline}>もう一度</button>
            )}
            <button style={ghostBtn} onClick={() => void backToTitle()}>タイトルへ</button>
          </div>
        )}

        {won && (
          <div style={{ marginTop: 10, textAlign: "center" }}>
            <button style={ghostBtn} onClick={() => void backToTitle()}>連勝をやめてタイトルへ</button>
          </div>
        )}
      </div>
    </div>
  );
}

const bgColor = (won: boolean, draw: boolean) =>
  draw ? "rgba(120,120,120,0.93)" : won ? "rgba(30,140,50,0.93)" : "rgba(180,50,50,0.93)";

const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, display: "grid", placeItems: "center",
  background: "rgba(0,0,0,0.55)", zIndex: 100, pointerEvents: "auto",
};
const box: React.CSSProperties = {
  padding: "26px 36px", borderRadius: 16, textAlign: "center",
  border: "1px solid rgba(255,255,255,0.15)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  minWidth: 480, maxWidth: 640,
};
const resultText: React.CSSProperties = {
  fontSize: 44, fontWeight: 700, marginBottom: 8, letterSpacing: 4,
  textShadow: "0 2px 8px rgba(0,0,0,0.5)",
};
const streakBadge: React.CSSProperties = { fontSize: 16, opacity: 0.95, marginBottom: 4 };
const streakReset: React.CSSProperties = { fontSize: 13, opacity: 0.85, marginBottom: 8 };
const btnRow: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch", marginTop: 12 };
const primaryBtn: React.CSSProperties = { background: "white", color: "#222", border: 0, borderRadius: 8, padding: "12px 18px", fontSize: 16, fontWeight: 600, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "white", border: 0, padding: "8px 18px", fontSize: 13, cursor: "pointer", opacity: 0.75 };
