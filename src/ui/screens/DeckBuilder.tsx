// Deck builder. Two columns:
//   - Left: catalogue of all defineable cards (excluding Status which are
//     only added in-game by other cards). Click → add to deck.
//   - Right: current deck. Click → remove one copy.
//
// Constraints: 10 ≤ size ≤ 30. Save persists to localStorage; the next match
// (offline or online) starts with this deck.

import { useMemo, useState } from "react";
import { allCards, CardId, CardType, getCardDef } from "../../sim/cards";
import { loadDeck, MAX_DECK_SIZE, MIN_DECK_SIZE, resetDeck, saveDeck } from "../../sim/deck-storage";
import { useStore } from "../store";
import { MiniCard, typeLabel } from "./MiniCard";

export function DeckBuilder() {
  const setScreen = useStore((s) => s.setScreen);
  const [deck, setDeck] = useState<CardId[]>(() => loadDeck());

  // Group available cards by type for the catalogue.
  const catalogue = useMemo(() => {
    const byType: Record<CardType, CardId[]> = { 0: [], 1: [], 2: [], 3: [] };
    for (const c of allCards()) {
      if (c.cardType === CardType.Status) continue; // status cards aren't player-added
      byType[c.cardType].push(c.id);
    }
    return byType;
  }, []);

  const aggregated = useMemo(() => {
    const counts = new Map<CardId, number>();
    for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort(([a], [b]) => {
        const da = getCardDef(a), db = getCardDef(b);
        if (!da || !db) return 0;
        if (da.cardType !== db.cardType) return da.cardType - db.cardType;
        return da.cost - db.cost;
      });
  }, [deck]);

  const add = (id: CardId) => {
    if (deck.length >= MAX_DECK_SIZE) return;
    setDeck((d) => [...d, id]);
  };
  const removeOne = (id: CardId) => {
    setDeck((d) => {
      const i = d.lastIndexOf(id);
      if (i < 0) return d;
      const next = d.slice();
      next.splice(i, 1);
      return next;
    });
  };

  const save = () => { saveDeck(deck); setScreen("title"); };
  const cancel = () => setScreen("title");
  const reset = () => { resetDeck(); setDeck(loadDeck()); };

  const sizeOk = deck.length >= MIN_DECK_SIZE && deck.length <= MAX_DECK_SIZE;

  return (
    <div style={page}>
      <div style={top}>
        <button style={ghostBtn} onClick={cancel}>← キャンセル</button>
        <h2 style={{ margin: 0, letterSpacing: 4 }}>デッキ編集</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={ghostBtn} onClick={reset}>初期デッキ</button>
          <button
            style={{ ...primaryBtn, opacity: sizeOk ? 1 : 0.4, cursor: sizeOk ? "pointer" : "not-allowed" }}
            disabled={!sizeOk}
            onClick={save}
          >
            保存
          </button>
        </div>
      </div>

      <div style={cols}>
        {/* Left: catalogue */}
        <div style={col}>
          <div style={colHeader}>カード一覧 (クリックで追加)</div>
          {([CardType.Attack, CardType.Skill, CardType.Power] as const).map((t) => (
            <div key={t} style={{ marginBottom: 12 }}>
              <div style={sectionLabel}>{typeLabel(t)}</div>
              <div style={cardWrap}>
                {catalogue[t].map((id) => (
                  <MiniCard key={id} cardId={id} ghost onClick={() => add(id)} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Right: current deck */}
        <div style={col}>
          <div style={colHeader}>
            現在のデッキ ({deck.length}枚 · {MIN_DECK_SIZE}〜{MAX_DECK_SIZE})
            {!sizeOk && (
              <span style={{ color: "#ff8a55", marginLeft: 12, fontSize: 12 }}>
                {deck.length < MIN_DECK_SIZE ? `あと${MIN_DECK_SIZE - deck.length}枚必要` : "枚数オーバー"}
              </span>
            )}
          </div>
          <div style={cardWrap}>
            {aggregated.length === 0 && <div style={{ opacity: 0.5, padding: 16 }}>(空)</div>}
            {aggregated.map(([id, count]) => (
              <MiniCard key={id} cardId={id} count={count} onClick={() => removeOne(id)} />
            ))}
          </div>
          <p style={hint}>
            注意: 両ピアは同じデッキを使う想定。オンラインマッチでは自分のローカル保存デッキが両者に適用されます。
          </p>
        </div>
      </div>
    </div>
  );
}

const page: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: 18, gap: 14,
  background: "linear-gradient(180deg, #14141c 0%, #0a0a12 100%)",
  fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "white", overflow: "hidden",
};
const top: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
const cols: React.CSSProperties = { display: "flex", gap: 18, flex: 1, minHeight: 0 };
const col: React.CSSProperties = { flex: 1, background: "#181822", border: "1px solid #2a2a35", borderRadius: 10, padding: 14, overflowY: "auto" };
const colHeader: React.CSSProperties = { fontSize: 14, opacity: 0.85, marginBottom: 12, letterSpacing: 1 };
const sectionLabel: React.CSSProperties = { fontSize: 11, opacity: 0.55, letterSpacing: 2, marginBottom: 6 };
const cardWrap: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "#aaa", border: "1px solid #333", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13 };
const primaryBtn: React.CSSProperties = { background: "white", color: "#222", border: 0, borderRadius: 6, padding: "6px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const hint: React.CSSProperties = { fontSize: 11, opacity: 0.55, marginTop: 12 };
