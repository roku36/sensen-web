import { useEffect, useState } from "react";
import { useStore } from "../store";

export function Lobby() {
  const log = useStore((s) => s.log);
  const game = useStore((s) => s.game);
  const setScreen = useStore((s) => s.setScreen);
  const [dots, setDots] = useState("");

  useEffect(() => {
    if (game) setScreen("gameplay");
  }, [game, setScreen]);

  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={overlay}>
      <div style={panel}>
        <h1 style={{ fontSize: 40, margin: 0, letterSpacing: 6 }}>SENSEN</h1>
        <p style={{ opacity: 0.7, marginTop: 12 }}>Searching for opponent{dots}</p>
        <pre style={pre}>{log.join("\n")}</pre>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "absolute", inset: 0, display: "grid", placeItems: "center" };
const panel: React.CSSProperties = { background: "rgba(0,0,0,0.6)", padding: 32, borderRadius: 16, minWidth: 460, textAlign: "center" };
const pre: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "#aaa", maxHeight: 220, overflow: "auto", background: "#11111a", padding: 8, borderRadius: 6 };
