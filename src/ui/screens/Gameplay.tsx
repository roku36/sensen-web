import { Canvas } from "@react-three/fiber";
import { Scene } from "../scene/Scene";
import { useStore } from "../store";
import { useKeyboardInput } from "../hooks";

export function Gameplay() {
  useKeyboardInput();
  const game = useStore((s) => s.game);
  const desync = useStore((s) => s.desyncFrame);
  const localPlayer = useStore((s) => s.localPlayer);
  const log = useStore((s) => s.log);

  const me = game?.players[localPlayer];
  const oppIdx = (localPlayer ^ 1) as 0 | 1;
  const opp = game?.players[oppIdx];
  const result = game?.result ?? 0;

  return (
    <>
      <Canvas shadows camera={{ position: [0, 8, 9], fov: 50 }}>
        <Scene />
      </Canvas>

      {/* HUD overlay */}
      <div style={hud}>
        <div style={hudTop}>
          <div>Frame: {game?.frame ?? 0}</div>
          <div>You: P{localPlayer}</div>
          <div style={{ opacity: 0.6 }}>Keys: 1-9, 0 = play card · D = draw</div>
        </div>
        {desync != null && (
          <div style={banner("rgba(180, 30, 30, 0.85)")}>
            ⚠ Desync detected at frame {desync}. Match halted.
          </div>
        )}
        {result === 1 && me?.hp && me.hp > 0 && (
          <div style={banner("rgba(30, 140, 50, 0.85)")}>VICTORY · {opp?.handle === oppIdx ? `P${oppIdx} fell` : "opponent down"}</div>
        )}
        {result === 2 && (
          <div style={banner("rgba(180, 50, 50, 0.85)")}>DEFEAT</div>
        )}
        {result === 3 && (
          <div style={banner("rgba(120, 120, 120, 0.85)")}>DRAW</div>
        )}
        <pre style={logBox}>{log.slice(-12).join("\n")}</pre>
      </div>
    </>
  );
}

const hud: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none", padding: 16 };
const hudTop: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#cdd" };
const banner = (bg: string): React.CSSProperties => ({
  position: "absolute", top: "40%", left: 0, right: 0, textAlign: "center", padding: 16, fontSize: 32, background: bg,
});
const logBox: React.CSSProperties = { position: "absolute", left: 16, bottom: 16, maxWidth: 400, fontSize: 10, color: "#7a8", background: "rgba(0,0,0,0.4)", padding: 6, borderRadius: 4 };
