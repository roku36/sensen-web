// Post-victory draft. The winner picks one of 3 random cards from the pool;
// it's appended to their persisted deck via addCardToDeck. The candidates
// here are local-only (the match is over — no peer to sync with), so we use
// Math.random rather than the deterministic per-handle RNG.
//
// "Skip" is also offered: keep your deck as-is but continue the streak.

import { useMemo, useState } from "react";
import { CardId, getCardDef } from "../../sim/cards";
import { DRAFT_POOL } from "../../sim/draft-pool";
import { addCardToDeck } from "../../sim/deck-storage";
import { MiniCard } from "./MiniCard";

export function PostVictoryDraft({
  streak,
  onResolved,
}: {
  streak: number;
  onResolved: () => void;
}) {
  const candidates = useMemo(() => sample3FromPool(), []);
  const [picked, setPicked] = useState<CardId | null>(null);

  const pick = (c: CardId) => {
    if (picked != null) return;
    addCardToDeck(c);
    setPicked(c);
  };

  const continueOn = () => onResolved();

  return (
    <div style={panel}>
      <div style={subtitle}>連勝 {streak} · デッキにカードを追加</div>
      <div style={cards}>
        {candidates.map((c) => (
          <div
            key={c}
            role="button"
            tabIndex={0}
            onClick={picked != null ? undefined : () => pick(c)}
            style={{
              ...card,
              cursor: picked != null ? "default" : "pointer",
              outline: picked === c ? "2px solid #ffe066" : "none",
              opacity: picked != null && picked !== c ? 0.4 : 1,
            }}
          >
            <MiniCard cardId={c} />
            <div style={desc}>{getCardDef(c)?.description}</div>
          </div>
        ))}
      </div>
      <div style={btnRow}>
        {picked != null ? (
          <span style={pickedHint}>「{getCardDef(picked)?.name}」をデッキに追加しました</span>
        ) : (
          <span style={hint}>1枚を選ぶか、スキップして次のマッチへ</span>
        )}
        <button style={primaryBtn} onClick={continueOn}>{picked != null ? "次のマッチへ" : "スキップ"}</button>
      </div>
    </div>
  );
}

function sample3FromPool(): CardId[] {
  const used = new Set<number>();
  const out: CardId[] = [];
  while (out.length < 3 && used.size < DRAFT_POOL.length) {
    const i = Math.floor(Math.random() * DRAFT_POOL.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(DRAFT_POOL[i]);
  }
  return out;
}

const panel: React.CSSProperties = { marginTop: 14 };
const subtitle: React.CSSProperties = { fontSize: 13, opacity: 0.9, marginBottom: 10, textAlign: "center", letterSpacing: 2 };
const cards: React.CSSProperties = { display: "flex", gap: 10, justifyContent: "center" };
const card: React.CSSProperties = {
  background: "transparent", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: 10,
  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
  cursor: "pointer", color: "white", minWidth: 150, minHeight: 96,
};
const desc: React.CSSProperties = { fontSize: 11, opacity: 0.85, lineHeight: 1.3, textAlign: "center" };
const btnRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 };
const hint: React.CSSProperties = { fontSize: 11, opacity: 0.75 };
const pickedHint: React.CSSProperties = { fontSize: 12, color: "#ffe066" };
const primaryBtn: React.CSSProperties = { background: "white", color: "#222", border: 0, borderRadius: 8, padding: "8px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
