// Post-match panel — shown when game.result !== 0. Offers immediate rematch
// (online or offline) without bouncing back to the title screen.

import { backToTitle, rematchOffline, rematchOnline } from "../hooks";

export function ResultPanel({
  result,
  localPlayer,
}: {
  result: 1 | 2 | 3;
  localPlayer: 0 | 1;
}) {
  const won = (result === 1 && localPlayer === 0) || (result === 2 && localPlayer === 1);
  const draw = result === 3;
  const text = draw ? "引き分け" : won ? "勝利" : "敗北";
  const color = draw ? "rgba(120,120,120,0.92)" : won ? "rgba(30,140,50,0.92)" : "rgba(180,50,50,0.92)";

  return (
    <div style={overlay}>
      <div style={{ ...box, background: color }}>
        <div style={resultText}>{text}</div>
        <div style={btnRow}>
          <button style={primaryBtn} onClick={rematchOnline}>
            次のマッチ (オンライン)
          </button>
          <button style={secondaryBtn} onClick={rematchOffline}>
            もう一度 (オフライン)
          </button>
          <button style={ghostBtn} onClick={backToTitle}>
            タイトルへ
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, display: "grid", placeItems: "center",
  background: "rgba(0,0,0,0.55)", zIndex: 100, pointerEvents: "auto",
};
const box: React.CSSProperties = {
  padding: "32px 40px", borderRadius: 16, textAlign: "center",
  border: "1px solid rgba(255,255,255,0.15)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  minWidth: 360,
};
const resultText: React.CSSProperties = {
  fontSize: 48, fontWeight: 700, marginBottom: 24, letterSpacing: 4,
  textShadow: "0 2px 8px rgba(0,0,0,0.5)",
};
const btnRow: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" };
const primaryBtn: React.CSSProperties = {
  background: "white", color: "#222", border: 0, borderRadius: 8,
  padding: "12px 18px", fontSize: 16, fontWeight: 600, cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.18)", color: "white", border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent", color: "white", border: 0,
  padding: "8px 18px", fontSize: 13, cursor: "pointer", opacity: 0.75,
};
