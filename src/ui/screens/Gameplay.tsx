import { Canvas } from "@react-three/fiber";
import { Scene } from "../scene/Scene";
import { useStore } from "../store";
import { useKeyboardInput } from "../hooks";
import { ResultPanel } from "./ResultPanel";

export function Gameplay() {
  useKeyboardInput();
  const game = useStore((s) => s.game);
  const desync = useStore((s) => s.desyncFrame);
  const localPlayer = useStore((s) => s.localPlayer);
  const log = useStore((s) => s.log);

  const result = game?.result ?? 0;

  return (
    <>
      <Canvas shadows camera={{ position: [0, 3.2, 9.5], fov: 55 }}>
        <Scene />
      </Canvas>

      {/* HUD overlay */}
      <div style={hud}>
        <div style={hudTop}>
          <div>Frame: {game?.frame ?? 0}</div>
          <div>You: P{localPlayer}</div>
          <div style={{ opacity: 0.6 }}>1-9, 0 = カード · D = ドロー</div>
        </div>
        {desync != null && (
          <div style={banner}>⚠ デシンク検出 (frame {desync})。試合中止。</div>
        )}
        <pre style={logBox}>{log.slice(-12).join("\n")}</pre>
      </div>

      {/* Post-match panel — covers screen, offers rematch / back to title. */}
      {result !== 0 && <ResultPanel result={result as 1 | 2 | 3} localPlayer={localPlayer} />}
    </>
  );
}

const hud: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none", padding: 16 };
const hudTop: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#cdd" };
const banner: React.CSSProperties = {
  position: "absolute", top: "30%", left: 0, right: 0, textAlign: "center", padding: 16, fontSize: 24, background: "rgba(180, 30, 30, 0.85)",
};
const logBox: React.CSSProperties = { position: "absolute", left: 16, bottom: 16, maxWidth: 400, fontSize: 10, color: "#7a8", background: "rgba(0,0,0,0.4)", padding: 6, borderRadius: 4 };
