// Modal that lists the contents of a pile (deck or discard). Deck contents
// are shown sorted+aggregated (the order is hidden info — it's been
// shuffled, like Slay the Spire's draw-pile peek). Discard shows in
// most-recently-discarded-first order so you can see what was just played.

import { CardId, getCardDef } from "../../sim/cards";
import { MiniCard } from "./MiniCard";

export function PilePeek({
  title,
  cards,
  ordered,
  onClose,
}: {
  title: string;
  cards: CardId[];
  /** true → render in given order; false → group by id and show counts */
  ordered: boolean;
  onClose: () => void;
}) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <span style={titleStyle}>{title}</span>
          <span style={countStyle}>{cards.length}枚</span>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>
        {cards.length === 0 ? (
          <div style={emptyMsg}>(空)</div>
        ) : (
          <div style={cardGrid}>
            {ordered
              ? cards.slice().reverse().map((id, i) => <MiniCard key={`${i}-${id}`} cardId={id} />)
              : aggregateCards(cards).map(({ id, count }) => <MiniCard key={id} cardId={id} count={count} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function aggregateCards(cards: CardId[]): { id: CardId; count: number }[] {
  const counts = new Map<CardId, number>();
  for (const c of cards) counts.set(c, (counts.get(c) ?? 0) + 1);
  return Array.from(counts, ([id, count]) => ({ id, count }))
    .sort((a, b) => {
      // sort by type first, then cost, then name
      const da = getCardDef(a.id), db = getCardDef(b.id);
      if (!da || !db) return 0;
      if (da.cardType !== db.cardType) return da.cardType - db.cardType;
      return da.cost - db.cost;
    });
}

const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, display: "grid", placeItems: "center",
  background: "rgba(0,0,0,0.55)", zIndex: 200,
};
const panel: React.CSSProperties = {
  background: "#1a1a24", border: "1px solid #333", borderRadius: 12,
  padding: 16, minWidth: 400, maxWidth: "min(900px, 90vw)",
  maxHeight: "80vh", display: "flex", flexDirection: "column",
};
const header: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 };
const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 700 };
const countStyle: React.CSSProperties = { fontSize: 12, opacity: 0.6 };
const closeBtn: React.CSSProperties = { marginLeft: "auto", background: "transparent", color: "#aaa", border: "1px solid #444", borderRadius: 6, padding: "4px 10px", fontSize: 14, cursor: "pointer" };
const cardGrid: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, overflowY: "auto" };
const emptyMsg: React.CSSProperties = { fontSize: 14, opacity: 0.5, padding: 16, textAlign: "center" };
