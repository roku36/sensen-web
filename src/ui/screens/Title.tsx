import { useState } from "react";
import { loadDeck, loadStreak, streakBucket } from "../../sim/deck-storage";
import { startOffline, startOnline } from "../hooks";
import { useStore } from "../store";

export function Title() {
  const remembered = useStore((s) => s.lastSignalUrl);
  const [signalUrl, setSignalUrl] = useState(remembered);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const setScreen = useStore((s) => s.setScreen);
  const deckSize = loadDeck().length;
  const streak = loadStreak();
  return (
    <div style={overlay}>
      <div style={panel}>
        <h1 style={{ fontSize: 56, margin: 0, letterSpacing: 8 }}>SENSEN</h1>
        <p style={{ opacity: 0.6, margin: "0 0 12px" }}>web port — react three fiber + p2p rollback</p>
        {streak > 0 && (
          <div style={streakChip}>
            🔥 連勝 {streak}
            <span style={streakBucketHint}>(マッチング帯: {streakBucket(streak)})</span>
          </div>
        )}

        {/* View toggle: rich 3D vs simple HUD */}
        <div style={toggleRow}>
          <button style={toggleBtn(viewMode === "rich3d")} onClick={() => setViewMode("rich3d")}>3D Rich</button>
          <button style={toggleBtn(viewMode === "simple")} onClick={() => setViewMode("simple")}>2D Simple</button>
        </div>
        <p style={hint}>
          {viewMode === "rich3d"
            ? "Full Three.js scene with shaders & particles."
            : "HUD-only — readable numbers for balancing."}
        </p>

        <button style={btn} onClick={() => startOffline(loadDeck())}>
          Practice (offline)
        </button>
        <div style={{ height: 18 }} />
        <input
          style={input}
          value={signalUrl}
          onChange={(e) => setSignalUrl(e.target.value)}
          placeholder="matchbox signaling URL"
        />
        <button style={btn} onClick={() => startOnline(signalUrl, loadDeck())}>
          Find Match (online)
        </button>

        <div style={{ height: 14 }} />
        <button style={deckBtn} onClick={() => setScreen("deck")}>
          デッキ編集 ({deckSize}枚)
        </button>
      </div>
    </div>
  );
}

const toggleRow: React.CSSProperties = { display: "flex", gap: 0, marginBottom: 6, justifyContent: "center" };
const toggleBtn = (active: boolean): React.CSSProperties => ({
  background: active ? "#5a3a8a" : "#2a2a35",
  color: "white", border: 0, padding: "6px 16px", cursor: "pointer", fontSize: 13,
  borderRadius: 0,
});
const hint: React.CSSProperties = { fontSize: 11, opacity: 0.55, margin: "0 0 18px" };

const overlay: React.CSSProperties = { position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "auto" };
const panel: React.CSSProperties = { background: "rgba(0,0,0,0.6)", padding: 36, borderRadius: 16, minWidth: 380, textAlign: "center" };
const btn: React.CSSProperties = { background: "#5a3a8a", color: "white", border: 0, borderRadius: 8, padding: "12px 24px", fontSize: 18, cursor: "pointer", width: "100%" };
const input: React.CSSProperties = { background: "#1a1a22", color: "white", border: "1px solid #444", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 12, width: "calc(100% - 26px)" };
const deckBtn: React.CSSProperties = { background: "transparent", color: "#aaa", border: "1px solid #444", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", width: "100%" };
const streakChip: React.CSSProperties = { display: "inline-block", padding: "6px 14px", borderRadius: 999, background: "rgba(255,180,80,0.18)", color: "#ffd070", border: "1px solid rgba(255,180,80,0.45)", fontSize: 14, marginBottom: 18 };
const streakBucketHint: React.CSSProperties = { fontSize: 11, opacity: 0.7, marginLeft: 8 };
