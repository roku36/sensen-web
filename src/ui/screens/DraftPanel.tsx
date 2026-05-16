// Mid-match draft offer. Shows the 3 candidate cards floating above the
// hand; click or press Z/X/C to pick. The pick goes to the discard pile.
//
// Both peers' offers are computed deterministically by the reducer from
// the match seed + per-player RNG, so each side sees identical candidates
// for their own player. The opponent's offer is ALSO simulated locally
// (we have full state for both) so we can render a "相手が選択中…" hint.

import { CardId, getCardDef } from "../../sim/cards";
import { INPUT_PICK_1, INPUT_PICK_2, INPUT_PICK_3 } from "../../sim/input";
import { DRAFT_TTL_SECS } from "../../sim/rules";
import { PlayerState } from "../../sim/state";
import { getSession } from "../hooks";
import { MiniCard } from "./MiniCard";

export function DraftPanel({
  player,
  nowSec,
}: {
  player: PlayerState;
  nowSec: number;
}) {
  if (!player.offer) return null;
  const remaining = Math.max(0, DRAFT_TTL_SECS - (nowSec - player.offer.spawnedAt));
  const flags = [INPUT_PICK_1, INPUT_PICK_2, INPUT_PICK_3];
  const keys = ["Z", "X", "C"];

  const pick = (i: number) => getSession()?.pushLocalInput(flags[i]);

  return (
    <div style={panel}>
      <div style={header}>
        <span style={titleStyle}>カード選択</span>
        <span style={timer}>{remaining.toFixed(1)}秒</span>
      </div>
      <div style={cards}>
        {player.offer.cards.map((c, i) => (
          <DraftCard key={i} cardId={c} keyHint={keys[i]} onClick={() => pick(i)} />
        ))}
      </div>
      <div style={hint}>1枚を選んで捨札に追加・無選択なら次へ</div>
    </div>
  );
}

function DraftCard({ cardId, keyHint, onClick }: { cardId: CardId; keyHint: string; onClick: () => void }) {
  const def = getCardDef(cardId);
  if (!def) return null;
  // <div role=button> instead of nested <button> (MiniCard already renders one).
  return (
    <div role="button" tabIndex={0} onClick={onClick} style={card}>
      <div style={key}>[{keyHint}]</div>
      <MiniCard cardId={cardId} />
      <div style={desc}>{def.description}</div>
    </div>
  );
}

export function OpponentDraftHint({ opponent }: { opponent: PlayerState }) {
  if (!opponent.offer) return null;
  return (
    <div style={oppHint}>相手がカードを選択中…</div>
  );
}

const panel: React.CSSProperties = {
  position: "absolute", left: "50%", top: "30%", transform: "translateX(-50%)",
  background: "rgba(20,20,32,0.97)", border: "1px solid #6a4ab0",
  borderRadius: 12, padding: 16, minWidth: 480, zIndex: 80,
  boxShadow: "0 8px 32px rgba(120,60,200,0.3)",
};
const header: React.CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 };
const titleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 700, letterSpacing: 2 };
const timer: React.CSSProperties = { fontSize: 12, opacity: 0.7, fontFamily: "ui-monospace, monospace" };
const cards: React.CSSProperties = { display: "flex", gap: 12, justifyContent: "center" };
const card: React.CSSProperties = {
  background: "transparent", border: "1px solid #555", borderRadius: 8, padding: 10,
  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
  cursor: "pointer", color: "white", maxWidth: 160, minHeight: 110,
};
const key: React.CSSProperties = { fontSize: 13, opacity: 0.65, fontFamily: "ui-monospace, monospace" };
const desc: React.CSSProperties = { fontSize: 11, opacity: 0.85, lineHeight: 1.3, textAlign: "center" };
const hint: React.CSSProperties = { fontSize: 11, opacity: 0.55, marginTop: 10, textAlign: "center" };
const oppHint: React.CSSProperties = { position: "absolute", right: 16, top: 60, fontSize: 12, opacity: 0.65, color: "#c89aff" };
