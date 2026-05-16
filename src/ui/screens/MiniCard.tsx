// Compact card chip used by the pile-peek modal and the deck builder.
// Read-only — name, type, cost. Tooltip on hover.

import { useState } from "react";
import { CardType, getCardDef } from "../../sim/cards";

export function MiniCard({
  cardId,
  count,
  onClick,
  ghost = false,
}: {
  cardId: number;
  count?: number; // when non-1, render a ×N badge
  onClick?: () => void;
  ghost?: boolean; // dim — used by deck builder for "click to add"
}) {
  const def = getCardDef(cardId);
  const [hover, setHover] = useState(false);
  if (!def) return null;
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        onClick={onClick}
        style={{
          ...mini,
          background: typeColor(def.cardType),
          opacity: ghost ? 0.55 : 1,
          cursor: onClick ? "pointer" : "default",
        }}
      >
        <span style={miniCost}>{def.cost === 999 ? "✗" : def.cost}</span>
        <span style={miniName}>{def.name}</span>
        {count != null && count > 1 && <span style={miniCount}>×{count}</span>}
      </button>
      {hover && (
        <div style={tipBox}>
          <div style={{ fontWeight: 700 }}>{def.name}</div>
          <div style={{ fontSize: 10, opacity: 0.65, marginTop: 2 }}>
            {typeLabel(def.cardType)} · コスト {def.cost === 999 ? "—" : def.cost}
            {def.exhausts && " · 1回限り"}
          </div>
          <div style={{ fontSize: 11, marginTop: 4, lineHeight: 1.35 }}>{def.description}</div>
        </div>
      )}
    </div>
  );
}

export function typeLabel(t: CardType): string {
  return t === CardType.Attack ? "攻撃" : t === CardType.Skill ? "技" : t === CardType.Power ? "パワー" : "状態";
}

function typeColor(t: CardType): string {
  switch (t) {
    case CardType.Attack: return "#7a2424";
    case CardType.Skill:  return "#234064";
    case CardType.Power:  return "#5a2670";
    case CardType.Status: return "#444";
  }
}

const mini: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "4px 10px 4px 8px", borderRadius: 6,
  border: "1px solid rgba(0,0,0,0.4)", color: "white",
  fontSize: 12, fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const miniCost: React.CSSProperties = { fontWeight: 700, color: "#ffe580" };
const miniName: React.CSSProperties = { whiteSpace: "nowrap" };
const miniCount: React.CSSProperties = { opacity: 0.7, fontSize: 11 };
const tipBox: React.CSSProperties = {
  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
  marginBottom: 6, padding: "8px 10px", background: "rgba(20,20,28,0.97)",
  border: "1px solid #444", borderRadius: 6, minWidth: 220, maxWidth: 280,
  boxShadow: "0 4px 16px rgba(0,0,0,0.6)", zIndex: 200, pointerEvents: "none", color: "#fff",
};
