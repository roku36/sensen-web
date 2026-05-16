// Lobby — waiting for an opponent. Shows live signaling log, and offers a
// Retry button after a timeout so a stuck lobby (matchbox ghost peer, single
// peer in room, dead WebRTC negotiation) can be recovered without a reload.

import { useEffect, useState } from "react";
import { createTestDeck } from "../../sim/cards";
import { backToTitle, startOnline } from "../hooks";
import { useStore } from "../store";

const STUCK_AFTER_MS = 12_000;

export function Lobby() {
  const log = useStore((s) => s.log);
  const game = useStore((s) => s.game);
  const setScreen = useStore((s) => s.setScreen);
  const lastUrl = useStore((s) => s.lastSignalUrl);
  const [dots, setDots] = useState("");
  const [stuck, setStuck] = useState(false);

  useEffect(() => { if (game) setScreen("gameplay"); }, [game, setScreen]);

  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 400);
    return () => clearInterval(id);
  }, []);

  // After STUCK_AFTER_MS without entering gameplay, surface the retry path.
  useEffect(() => {
    setStuck(false);
    const id = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  const retry = () => { setStuck(false); void startOnline(lastUrl, createTestDeck()); };
  const cancel = () => { void backToTitle(); };

  return (
    <div style={overlay}>
      <div style={panel}>
        <h1 style={{ fontSize: 40, margin: 0, letterSpacing: 6 }}>SENSEN</h1>
        <p style={{ opacity: 0.7, marginTop: 12 }}>対戦相手を探しています{dots}</p>
        <pre style={pre}>{log.join("\n")}</pre>
        {stuck ? (
          <>
            <p style={{ color: "#ffb070", fontSize: 13, marginTop: 16 }}>
              繋がりません。matchbox の ghost peer か、相手側の接続失敗かもしれません。
            </p>
            <div style={btnRow}>
              <button style={primaryBtn} onClick={retry}>再接続</button>
              <button style={ghostBtn} onClick={cancel}>タイトルへ</button>
            </div>
          </>
        ) : (
          <button style={ghostBtn} onClick={cancel}>キャンセル</button>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "absolute", inset: 0, display: "grid", placeItems: "center" };
const panel: React.CSSProperties = { background: "rgba(0,0,0,0.6)", padding: 32, borderRadius: 16, minWidth: 460, textAlign: "center" };
const pre: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "#aaa", maxHeight: 220, overflow: "auto", background: "#11111a", padding: 8, borderRadius: 6 };
const btnRow: React.CSSProperties = { display: "flex", gap: 8, marginTop: 12, justifyContent: "center" };
const primaryBtn: React.CSSProperties = { background: "white", color: "#222", border: 0, borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "white", border: "1px solid #555", borderRadius: 8, padding: "8px 16px", fontSize: 13, marginTop: 16, cursor: "pointer", opacity: 0.85 };
