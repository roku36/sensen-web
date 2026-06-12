// AI lab dashboard — headless self-play win rates vs the Lv1 baseline.
//
// Each level row has a "100戦実行" button: matches run HEADLESSLY in the
// browser, chunked one-per-macrotask so the UI stays responsive, sides
// alternating to cancel the first/second-player advantage. Every match's
// full input record is saved as a Replay (localStorage, bounded), and each
// row in the match list links straight into the existing ReplayViewer.

import { useEffect, useRef, useState } from "react";
import { LabMatch, runLabMatch } from "../../lab/selfplay";
import { clearLabMatches, loadLabMatches, saveLabMatches } from "../../lab/replay-store";
import { downloadReplay } from "../../replay/format";
import { useStore } from "../store";

const LEVELS: { key: string; label: string; desc: string }[] = [
  { key: "lv1", label: "Lv1 ランダム", desc: "ベースライン同士 (≈50%が健全)" },
  { key: "lv2", label: "Lv2 テンポ型", desc: "閃あたりの価値効率" },
  { key: "lv3", label: "Lv3 読み型", desc: "公開キュー読み + ジャストブロック" },
  { key: "lv4", label: "Lv4 先読み型", desc: "ロールアウト探索 (実行に数十秒)" },
];

const RUN_COUNT = 100;

interface RunState { running: boolean; done: number; total: number }

export function LabDashboard() {
  const setScreen = useStore((s) => s.setScreen);
  const setLoadedReplay = useStore((s) => s.setLoadedReplay);
  const [matches, setMatches] = useState<LabMatch[]>(() => loadLabMatches());
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [filter, setFilter] = useState<string>("all");
  const [pairA, setPairA] = useState("lv4");
  const [pairB, setPairB] = useState("lv3");
  const cancelled = useRef(false);

  // Reset on (re)mount — React StrictMode mounts→cleans→remounts, and the
  // ref survives that cycle; without the reset the run loop would see a
  // stale cancelled=true and never start.
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  // Run RUN_COUNT headless matches of `level` vs `opponent`, chunked per
  // macrotask. `runKey` identifies the progress slot in the UI.
  const startRun = (level: string, opponent = "lv1", runKey = level) => {
    if (runs[runKey]?.running) return;
    setRuns((r) => ({ ...r, [runKey]: { running: true, done: 0, total: RUN_COUNT } }));
    const baseSeed = BigInt(Date.now()) * 1000n;
    const fresh: LabMatch[] = [];
    let i = 0;
    const heavy = level === "lv4" || opponent === "lv4";
    const tick = () => {
      if (cancelled.current) return;
      // A couple of matches per macrotask keeps fast levels snappy while
      // never blocking the frame for long on lv4.
      const batch = heavy ? 1 : 4;
      for (let b = 0; b < batch && i < RUN_COUNT; b++, i++) {
        fresh.push(runLabMatch(level, baseSeed + BigInt(i), (i % 2) as 0 | 1, opponent));
      }
      setRuns((r) => ({ ...r, [runKey]: { running: i < RUN_COUNT, done: i, total: RUN_COUNT } }));
      if (i < RUN_COUNT) {
        setTimeout(tick, 0);
      } else {
        setMatches((prev) => {
          const next = [...prev, ...fresh];
          saveLabMatches(next);
          return next;
        });
      }
    };
    setTimeout(tick, 0);
  };

  const openReplay = (m: LabMatch) => {
    setLoadedReplay(m.replay);
    setScreen("replay");
  };

  const statsFor = (level: string, opponent = "lv1") => {
    const ms = matches.filter((m) => m.level === level && (m.opponent ?? "lv1") === opponent);
    const wins = ms.filter((m) => m.won).length;
    const draws = ms.filter((m) => m.draw).length;
    const losses = ms.length - wins - draws;
    const points = wins + draws * 0.5;
    return { n: ms.length, wins, draws, losses, rate: ms.length > 0 ? (points / ms.length) * 100 : null };
  };

  const shown = (filter === "all" ? matches : matches.filter((m) => m.level === filter))
    .slice(-60).reverse();

  return (
    <div style={page}>
      <div style={topRow}>
        <button style={ghostBtn} onClick={() => setScreen("title")}>← タイトル</button>
        <h2 style={{ margin: 0, fontSize: 20, letterSpacing: 2 }}>AI 検証ラボ</h2>
        <span style={{ fontSize: 11, opacity: 0.55 }}>
          headless 自己対戦 · 対戦相手は常に Lv1 · 先後交互 · リプレイ保存 {matches.length} 件
        </span>
        <button
          style={{ ...ghostBtn, marginLeft: "auto", color: "#ff8a8a", borderColor: "#663333" }}
          onClick={() => { clearLabMatches(); setMatches([]); }}
        >全履歴を消去</button>
      </div>

      {/* Level rows */}
      <div style={levelGrid}>
        {LEVELS.map((lv) => {
          const st = statsFor(lv.key);
          const run = runs[lv.key];
          return (
            <div key={lv.key} style={levelCard}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{lv.label}</span>
                <span style={{ fontSize: 10, opacity: 0.55 }}>{lv.desc}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
                <div style={rateBox}>
                  {st.rate === null ? (
                    <span style={{ fontSize: 12, opacity: 0.4 }}>未計測</span>
                  ) : (
                    <>
                      <span style={{ fontSize: 26, fontWeight: 800, color: rateColor(st.rate) }}>
                        {st.rate.toFixed(1)}%
                      </span>
                      <span style={{ fontSize: 10, opacity: 0.6 }}>
                        {st.wins}勝 {st.losses}敗 {st.draws}分 / {st.n}戦
                      </span>
                    </>
                  )}
                </div>
                <button
                  style={{ ...runBtn, opacity: run?.running ? 0.5 : 1 }}
                  disabled={run?.running}
                  onClick={() => startRun(lv.key)}
                >
                  {run?.running ? `実行中 ${run.done}/${run.total}` : `${RUN_COUNT}戦実行`}
                </button>
              </div>
              {run?.running && (
                <div style={progressTrack}>
                  <div style={{ ...progressFill, width: `${(run.done / run.total) * 100}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pair comparison: any level vs any level (ladder verification). */}
      <div style={{ ...levelCard, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>ペア比較</span>
        <select style={pairSelect} value={pairA} onChange={(e) => setPairA(e.target.value)}>
          {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
        <span style={{ opacity: 0.6, fontSize: 12 }}>vs</span>
        <select style={pairSelect} value={pairB} onChange={(e) => setPairB(e.target.value)}>
          {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
        <button
          style={{ ...runBtn, opacity: runs.pair?.running ? 0.5 : 1 }}
          disabled={runs.pair?.running}
          onClick={() => startRun(pairA, pairB, "pair")}
        >
          {runs.pair?.running ? `実行中 ${runs.pair.done}/${runs.pair.total}` : `${RUN_COUNT}戦実行`}
        </button>
        {(() => {
          const st = statsFor(pairA, pairB);
          if (st.rate === null) return <span style={{ fontSize: 11, opacity: 0.4 }}>未計測のペアです</span>;
          return (
            <span style={{ fontSize: 13 }}>
              <b style={{ color: rateColor(st.rate), fontSize: 18 }}>{st.rate.toFixed(1)}%</b>
              <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 11 }}>
                {pairA} 視点 · {st.wins}勝 {st.losses}敗 {st.draws}分 / {st.n}戦
              </span>
            </span>
          );
        })()}
      </div>

      {/* Match list */}
      <div style={listHeader}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>プレイ履歴 (新しい順・最大60件表示)</span>
        <div style={{ display: "flex", gap: 4 }}>
          {["all", ...LEVELS.map((l) => l.key)].map((k) => (
            <button
              key={k}
              style={{ ...filterBtn, background: filter === k ? "#5a3a8a" : "#22222a" }}
              onClick={() => setFilter(k)}
            >{k === "all" ? "全て" : k}</button>
          ))}
        </div>
      </div>
      <div style={list}>
        {shown.length === 0 && <div style={{ opacity: 0.4, fontSize: 12, padding: 12 }}>まだ対戦履歴がありません。「{RUN_COUNT}戦実行」を押してください。</div>}
        {shown.map((m) => (
          <div key={m.id} style={listRow}>
            <span style={{ width: 110, fontWeight: 700 }}>{m.level} <span style={{ opacity: 0.5, fontWeight: 400 }}>vs {m.opponent ?? "lv1"}</span></span>
            <span style={{ width: 64, opacity: 0.7 }}>{m.side === 0 ? "先手" : "後手"}</span>
            <span style={{
              width: 44, fontWeight: 800,
              color: m.won ? "#7fe3a4" : m.draw ? "#ffd166" : "#ff8a8a",
            }}>{m.won ? "勝ち" : m.draw ? "引分" : "負け"}</span>
            <span style={{ width: 90, opacity: 0.6, fontFamily: "ui-monospace, monospace" }}>
              {(m.finalFrame / 60).toFixed(1)}秒
            </span>
            <span style={{ flex: 1, opacity: 0.45, fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
              seed {m.replay.matchSeed}
            </span>
            <button style={viewBtn} onClick={() => openReplay(m)}>▶ リプレイを見る</button>
            <button
              style={{ ...viewBtn, background: "#262630", borderColor: "#3a3a4a", color: "#aab" }}
              title="リプレイをJSONとして保存"
              onClick={() => downloadReplay(m.replay, `sensen-lab-${m.id}.json`)}
            >⬇</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function rateColor(rate: number): string {
  if (rate >= 65) return "#7fe3a4";
  if (rate >= 50) return "#ffd166";
  return "#ff8a8a";
}

const page: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
  padding: 18, gap: 12, overflowY: "auto",
  background: "linear-gradient(180deg, #14141c 0%, #0a0a12 100%)",
  fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "white",
};
const topRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14 };
const ghostBtn: React.CSSProperties = {
  background: "transparent", color: "#aaa", border: "1px solid #333",
  borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12,
};
const levelGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10,
};
const levelCard: React.CSSProperties = {
  background: "#181822", border: "1px solid #2a2a35", borderRadius: 10, padding: 12,
};
const rateBox: React.CSSProperties = { display: "flex", flexDirection: "column", minWidth: 120 };
const runBtn: React.CSSProperties = {
  background: "#2c5b8e", color: "white", border: "1px solid #3a7fbf",
  borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const progressTrack: React.CSSProperties = {
  marginTop: 8, height: 6, background: "#0c0c12", borderRadius: 3, overflow: "hidden",
};
const progressFill: React.CSSProperties = { height: "100%", background: "#5fa0e0" };
const listHeader: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4,
};
const filterBtn: React.CSSProperties = {
  color: "white", border: "1px solid #333", borderRadius: 5,
  padding: "2px 10px", fontSize: 11, cursor: "pointer",
};
const list: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2,
};
const listRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, fontSize: 12,
  background: "#16161e", border: "1px solid #23232d", borderRadius: 6,
  padding: "6px 10px",
};
const pairSelect: React.CSSProperties = {
  background: "#1a1a22", color: "white", border: "1px solid #444",
  borderRadius: 6, padding: "5px 8px", fontSize: 12,
};
const viewBtn: React.CSSProperties = {
  background: "#1f3a5c", color: "#bdd6f0", border: "1px solid #3a7fbf",
  borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer",
};
