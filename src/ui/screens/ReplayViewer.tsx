// Replay viewer. Loads a Replay file, lets you scrub / play / change speed,
// renders the reconstructed GameState via the same SimpleGameplay HUD by
// pushing the engine's state into the store every frame.

import { useEffect, useRef, useState } from "react";
import { decodeReplay, Replay } from "../../replay/format";
import { ReplayEngine } from "../../replay/engine";
import { useStore } from "../store";

interface Props { replay: Replay; onExit: () => void; }

export function ReplayViewer({ replay, onExit }: Props) {
  const engineRef = useRef<ReplayEngine | null>(null);
  if (!engineRef.current) engineRef.current = new ReplayEngine(replay);
  const engine = engineRef.current;

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [perspective, setPerspective] = useState<0 | 1>(0);

  // Push the replayed state into the store so SimpleGameplay (rendered
  // beneath this overlay) shows it.
  useEffect(() => {
    const s = engine.seek(cursor);
    useStore.getState().setLocalPlayer(perspective);
    useStore.getState().setGame(s);
  }, [cursor, perspective, engine]);

  // Play loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0; let last = performance.now(); let acc = 0;
    const tick = () => {
      const now = performance.now();
      acc += ((now - last) / 1000) * speed;
      last = now;
      const dt = 1 / 60;
      while (acc >= dt) {
        engine.advanceOne();
        acc -= dt;
      }
      const f = engine.cursorFrame();
      setCursor(f);
      useStore.getState().setGame(engine.current());
      if (f >= engine.totalFrames()) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, engine]);

  const total = engine.totalFrames();
  const seconds = (cursor / 60).toFixed(1);
  const totalSeconds = (total / 60).toFixed(1);

  return (
    <div style={overlay}>
      <div style={bar}>
        <button style={btn} onClick={onExit}>← 終了</button>
        <button style={btn} onClick={() => setPlaying((p) => !p)}>{playing ? "⏸ 一時停止" : "▶ 再生"}</button>
        <button style={btn} onClick={() => setCursor(Math.max(0, cursor - 60))}>‹ 1秒</button>
        <button style={btn} onClick={() => setCursor(Math.min(total, cursor + 60))}>1秒 ›</button>
        <input
          type="range"
          min={0}
          max={total}
          value={cursor}
          onChange={(e) => setCursor(parseInt(e.target.value, 10))}
          style={slider}
        />
        <span style={meta}>{seconds}s / {totalSeconds}s · frame {cursor}/{total}</span>
        <div style={speedGroup}>
          {[0.5, 1, 2, 4].map((s) => (
            <button key={s} style={s === speed ? speedBtnActive : speedBtn} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
        <div style={persGroup}>
          視点:
          <button style={perspective === 0 ? speedBtnActive : speedBtn} onClick={() => setPerspective(0)}>P0</button>
          <button style={perspective === 1 ? speedBtnActive : speedBtn} onClick={() => setPerspective(1)}>P1</button>
        </div>
      </div>
    </div>
  );
}

// File picker entry point — used from Title.
export function pickReplayFile(): Promise<Replay | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        const text = await f.text();
        resolve(decodeReplay(text));
      } catch (e) {
        alert("リプレイ読み込み失敗: " + (e as Error).message);
        resolve(null);
      }
    };
    input.click();
  });
}

const overlay: React.CSSProperties = {
  position: "absolute", bottom: 0, left: 0, right: 0, padding: 12,
  background: "rgba(20,20,28,0.92)", borderTop: "1px solid #333",
  zIndex: 90, pointerEvents: "auto",
};
const bar: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
const btn: React.CSSProperties = { background: "#2a2a36", color: "white", border: "1px solid #444", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" };
const slider: React.CSSProperties = { flex: 1, minWidth: 200, accentColor: "#a070ff" };
const meta: React.CSSProperties = { fontSize: 12, color: "#aaa", fontFamily: "ui-monospace, monospace", minWidth: 160, textAlign: "center" };
const speedGroup: React.CSSProperties = { display: "flex", gap: 4, marginLeft: 8 };
const speedBtn: React.CSSProperties = { background: "transparent", color: "#aaa", border: "1px solid #333", borderRadius: 4, padding: "4px 8px", fontSize: 12, cursor: "pointer" };
const speedBtnActive: React.CSSProperties = { ...speedBtn, background: "#5a3a8a", color: "white", borderColor: "#a070ff" };
const persGroup: React.CSSProperties = { display: "flex", gap: 4, alignItems: "center", color: "#ccc", fontSize: 12 };
