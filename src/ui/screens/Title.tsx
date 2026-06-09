import { useState } from "react";
import { policies } from "../../ai/policy";
import { loadDeck, loadStreak, streakBucket } from "../../sim/deck-storage";
import { startOffline, startOnline } from "../hooks";
import { useStore } from "../store";
import { pickReplayFile } from "./ReplayViewer";

// AI options surfaced on Title — labels in Japanese, key matches a policy
// factory exported from ../../ai/policy.
const AI_LEVELS: { key: string; label: string; desc: string }[] = [
  { key: "passive", label: "なし",          desc: "相手は何もしない (練習用)" },
  { key: "lv1",     label: "Lv1 ランダム",  desc: "出せる手から無作為にプレイ" },
  { key: "lv2",     label: "Lv2 テンポ型",  desc: "閃あたりの価値効率だけで選ぶ" },
  { key: "lv3",     label: "Lv3 読み型",    desc: "相手キューを読み、着弾に合わせてブロック" },
  { key: "lv4",     label: "Lv4 先読み型",  desc: "数閃先までシミュレートして最善手 (最強)" },
];

export function Title() {
  const remembered = useStore((s) => s.lastSignalUrl);
  const [signalUrl, setSignalUrl] = useState(remembered);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const setScreen = useStore((s) => s.setScreen);
  const aiName = useStore((s) => s.aiOpponentName);
  const setAiName = useStore((s) => s.setAiOpponentName);
  const spectate = useStore((s) => s.aiSpectate);
  const setSpectate = useStore((s) => s.setAiSpectate);
  const beginner = useStore((s) => s.beginnerMode);
  const setBeginner = useStore((s) => s.setBeginnerMode);
  const deckSize = loadDeck().length;
  const streak = loadStreak();

  const startSolo = () => {
    const oppFact = policies[aiName] ?? policies.heuristic;
    const selfFact = spectate ? oppFact : undefined;
    void startOffline(loadDeck(), {
      opponentPolicy: oppFact,
      selfPolicy: selfFact,
      beginnerMode: beginner,
    });
  };

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

        {/* View toggle */}
        <div style={toggleRow}>
          <button style={toggleBtn(viewMode === "rich3d")} onClick={() => setViewMode("rich3d")}>3D Rich</button>
          <button style={toggleBtn(viewMode === "simple")} onClick={() => setViewMode("simple")}>2D Simple</button>
        </div>

        {/* AI opponent picker */}
        <div style={{ marginTop: 8, marginBottom: 10, textAlign: "left" }}>
          <label style={sectionLabel}>CPU 対戦相手</label>
          <select style={select} value={aiName} onChange={(e) => setAiName(e.target.value)}>
            {AI_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label} — {l.desc}</option>)}
          </select>
          <label style={checkboxRow}>
            <input type="checkbox" checked={spectate} onChange={(e) => setSpectate(e.target.checked)} />
            <span>AI vs AI 観戦 (自分側も CPU が操作)</span>
          </label>
          <label style={checkboxRow}>
            <input type="checkbox" checked={beginner} onChange={(e) => setBeginner(e.target.checked)} />
            <span>初心者モード (CPU 戦のみ・「次の閃」ボタンで進行)</span>
          </label>
        </div>

        <button style={btn} onClick={startSolo}>
          {spectate ? "AI 同士の試合を観戦" : `CPU と対戦 (${AI_LEVELS.find((l) => l.key === aiName)?.label})`}
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
        <div style={{ height: 8 }} />
        <button style={deckBtn} onClick={async () => {
          const r = await pickReplayFile();
          if (r) { useStore.getState().setLoadedReplay(r); setScreen("replay"); }
        }}>
          リプレイを開く…
        </button>
        <div style={{ height: 8 }} />
        <button style={deckBtn} onClick={() => setScreen("lab")}>
          AI 検証ラボ (headless 自己対戦)
        </button>
      </div>
    </div>
  );
}

const toggleRow: React.CSSProperties = { display: "flex", gap: 0, marginBottom: 4, justifyContent: "center" };
const toggleBtn = (active: boolean): React.CSSProperties => ({
  background: active ? "#5a3a8a" : "#2a2a35",
  color: "white", border: 0, padding: "6px 16px", cursor: "pointer", fontSize: 13,
  borderRadius: 0,
});
const sectionLabel: React.CSSProperties = { display: "block", fontSize: 11, opacity: 0.7, letterSpacing: 1, marginBottom: 4 };
const select: React.CSSProperties = { background: "#1a1a22", color: "white", border: "1px solid #444", borderRadius: 6, padding: "6px 10px", fontSize: 12, width: "100%" };
const checkboxRow: React.CSSProperties = { display: "flex", gap: 6, fontSize: 11, opacity: 0.85, marginTop: 6, cursor: "pointer", color: "#ccc" };

const overlay: React.CSSProperties = { position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "auto" };
const panel: React.CSSProperties = { background: "rgba(0,0,0,0.6)", padding: 32, borderRadius: 16, minWidth: 380, maxWidth: 460, textAlign: "center" };
const btn: React.CSSProperties = { background: "#5a3a8a", color: "white", border: 0, borderRadius: 8, padding: "12px 24px", fontSize: 16, cursor: "pointer", width: "100%" };
const input: React.CSSProperties = { background: "#1a1a22", color: "white", border: "1px solid #444", borderRadius: 8, padding: "10px 12px", fontSize: 14, marginBottom: 12, width: "calc(100% - 26px)" };
const deckBtn: React.CSSProperties = { background: "transparent", color: "#aaa", border: "1px solid #444", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", width: "100%" };
const streakChip: React.CSSProperties = { display: "inline-block", padding: "6px 14px", borderRadius: 999, background: "rgba(255,180,80,0.18)", color: "#ffd070", border: "1px solid rgba(255,180,80,0.45)", fontSize: 14, marginBottom: 14 };
const streakBucketHint: React.CSSProperties = { fontSize: 11, opacity: 0.7, marginLeft: 8 };
