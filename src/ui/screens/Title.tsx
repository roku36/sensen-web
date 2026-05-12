import { useState } from "react";
import { createTestDeck } from "../../sim/cards";
import { startOffline, startOnline } from "../hooks";

export function Title() {
  const [signalUrl, setSignalUrl] = useState("ws://localhost:3536/sensen?next=2");
  return (
    <div style={overlay}>
      <div style={panel}>
        <h1 style={{ fontSize: 56, margin: 0, letterSpacing: 8 }}>SENSEN</h1>
        <p style={{ opacity: 0.6, margin: "0 0 32px" }}>web port — react three fiber + p2p rollback</p>

        <button style={btn} onClick={() => startOffline(createTestDeck())}>
          Practice (offline)
        </button>
        <div style={{ height: 18 }} />
        <input
          style={input}
          value={signalUrl}
          onChange={(e) => setSignalUrl(e.target.value)}
          placeholder="matchbox signaling URL"
        />
        <button style={btn} onClick={() => startOnline(signalUrl, createTestDeck())}>
          Find Match (online)
        </button>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "auto" };
const panel: React.CSSProperties = { background: "rgba(0,0,0,0.6)", padding: 36, borderRadius: 16, minWidth: 380, textAlign: "center" };
const btn: React.CSSProperties = { background: "#5a3a8a", color: "white", border: 0, borderRadius: 8, padding: "12px 24px", fontSize: 18, cursor: "pointer", width: "100%" };
const input: React.CSSProperties = { background: "#1a1a22", color: "white", border: "1px solid #444", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 12, width: "calc(100% - 26px)" };
