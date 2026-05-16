// 2D HUD-only view of the same game. No Three.js, no shaders — pure DOM so
// you can A/B numbers without being seduced by visual polish.
//
// Same input path as the 3D view: clicks/keys go through getSession().pushLocalInput.
// Re-renders are driven by the store's gameFrame counter (subscribed in App).

import { useState } from "react";
import { CardEffect, CardType, getCardDef } from "../../sim/cards";
import { cardFlag, INPUT_DRAW } from "../../sim/input";
import { DRAW_COST } from "../../sim/rules";
import { PlayerState } from "../../sim/state";
import { getSession, useKeyboardInput } from "../hooks";
import { useStore } from "../store";
import { DraftPanel, OpponentDraftHint } from "./DraftPanel";
import { PilePeek } from "./PilePeek";
import { ResultPanel } from "./ResultPanel";

type Peek =
  | { kind: "deck"; side: 0 | 1 }
  | { kind: "discard"; side: 0 | 1 }
  | null;

export function SimpleGameplay() {
  useKeyboardInput();
  const game = useStore((s) => s.game);
  // Subscribe to per-frame ticks so bars update every sim step (60Hz).
  useStore((s) => s.gameFrame);
  const localPlayer = useStore((s) => s.localPlayer);
  const setScreen = useStore((s) => s.setScreen);
  const [peek, setPeek] = useState<Peek>(null);

  if (!game) return null;
  const me = game.players[localPlayer];
  const op = game.players[(localPlayer ^ 1) as 0 | 1];

  return (
    <div style={page}>
      <div style={topBar}>
        <button style={ghostBtn} onClick={() => setScreen("title")}>← タイトル</button>
        <span style={{ opacity: 0.6, fontSize: 12 }}>frame {game.frame} · 2D</span>
      </div>

      <PlayerPanel player={op} title="相手" mirrored side={(localPlayer ^ 1) as 0 | 1} onPeek={setPeek} />
      <PlayerPanel player={me} title="自分" side={localPlayer} onPeek={setPeek} />
      <SelfHand player={me} />
      <OpponentDraftHint opponent={op} />
      <DraftPanel player={me} nowSec={game.frame / 60} />

      {peek?.kind === "deck" && (
        <PilePeek
          title={peek.side === localPlayer ? "自分の山札" : "相手の山札"}
          cards={game.players[peek.side].deck}
          ordered={false}
          onClose={() => setPeek(null)}
        />
      )}
      {peek?.kind === "discard" && (
        <PilePeek
          title={peek.side === localPlayer ? "自分の捨札" : "相手の捨札"}
          cards={game.players[peek.side].discard}
          ordered
          onClose={() => setPeek(null)}
        />
      )}

      {game.result !== 0 && (
        <ResultPanel result={game.result as 1 | 2 | 3} localPlayer={localPlayer} />
      )}
    </div>
  );
}

function PlayerPanel({
  player, title, mirrored = false, side, onPeek,
}: {
  player: PlayerState; title: string; mirrored?: boolean;
  side: 0 | 1; onPeek: (p: Peek) => void;
}) {
  const hpPct = player.hp / player.hpMax;
  return (
    <div style={{ ...panel, flexDirection: mirrored ? "row-reverse" : "row" }}>
      <div style={{ flex: 1 }}>
        <div style={panelLabel}>{title}</div>
        <Bar pct={hpPct} color={hpPct > 0.4 ? "#34c759" : hpPct > 0.2 ? "#ffcc00" : "#ff3b30"}
             label={`HP ${Math.round(player.hp)} / ${player.hpMax}`} />
        <Bar pct={Math.min(1, player.cost / 5)} color="#ffd166"
             label={`エネルギー ${player.cost.toFixed(1)} (+${player.costRate.toFixed(2)}/秒)`} small />
        <div style={pillRow}>
          <span style={pill("#5fa0e0")}>ブロック {Math.round(player.block)}</span>
          {player.thorns > 0 && <span style={pill("#ff9f43")}>棘 {Math.round(player.thorns)}</span>}
          {player.strength !== 0 && <span style={pill("#ff6961")}>筋力 {player.strength > 0 ? "+" : ""}{player.strength}</span>}
          {player.vulnerableSecs > 0 && <span style={pill("#ff8a00")}>脆弱 {player.vulnerableSecs.toFixed(1)}秒</span>}
          {player.weakSecs > 0 && <span style={pill("#a899ff")}>弱体 {player.weakSecs.toFixed(1)}秒</span>}
          {player.metallicize && <span style={pill("#9bb")}>金属化 +{player.metallicize.blockPerSec}/秒</span>}
          {player.combust && <span style={pill("#ff5757")}>燃焼 {player.combust.enemyPerSec}/秒</span>}
          {player.demonForm && <span style={pill("#c050ff")}>悪魔の姿 +{player.demonForm.strengthPerSec}筋力/秒</span>}
          {player.barricade && <span style={pill("#80ffe0")}>防壁</span>}
          {player.corruption && <span style={pill("#aa6688")}>腐敗</span>}
        </div>
      </div>
      <div style={pileStack}>
        <Pile label="山札" n={player.deck.length} color="#5b9eff" onClick={() => onPeek({ kind: "deck", side })} />
        <Pile label="捨札" n={player.discard.length} color="#ff7a8a" onClick={() => onPeek({ kind: "discard", side })} />
        <Pile label="手札" n={player.hand.length} color="#cccccc" />
      </div>
    </div>
  );
}

function SelfHand({ player }: { player: PlayerState }) {
  return (
    <div style={handRow}>
      {player.hand.map((cardId, i) => (
        <SimpleCard key={i} cardId={cardId} idx={i} player={player} />
      ))}
      <DrawCard player={player} />
    </div>
  );
}

function SimpleCard({ cardId, idx, player }: { cardId: number; idx: number; player: PlayerState }) {
  const def = getCardDef(cardId);
  const [hover, setHover] = useState(false);
  if (!def) return null;
  const isCorruptionDiscount = !!player.corruption && def.cardType === CardType.Skill;
  const cost = isCorruptionDiscount ? 0 : def.cost;
  const playable = def.cost !== 999 && player.cost >= cost;

  const onClick = () => {
    const flag = cardFlag(idx);
    if (flag !== null) getSession()?.pushLocalInput(flag);
  };

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        onClick={onClick}
        disabled={!playable}
        style={{
          ...cardStyle,
          background: typeColor(def.cardType, playable),
          cursor: playable ? "pointer" : "not-allowed",
          boxShadow: playable ? "0 4px 12px rgba(0,0,0,0.4)" : "none",
          opacity: playable ? 1 : 0.55,
          outline: def.exhausts ? "1px solid #ffaa55" : "none",
        }}
      >
        <div style={cardCostStyle}>
          {def.cost === 999 ? "✗" : cost % 1 === 0 ? cost.toFixed(0) : cost.toFixed(1)}
        </div>
        <div style={typeBadge}>
          {def.cardType === CardType.Attack ? "攻撃"
            : def.cardType === CardType.Skill ? "技"
            : def.cardType === CardType.Power ? "パワー"
            : "状態"}
          {def.exhausts && " · 1回限り"}
        </div>
        <div style={cardHeader}>{def.name}</div>
        <div style={cardEffect}>{def.description}</div>
        <div style={cardKeyHint}>{idx === 9 ? "0" : (idx + 1).toString()}</div>
      </button>
      {hover && <Tooltip def={def} />}
    </div>
  );
}

function Tooltip({ def }: { def: ReturnType<typeof getCardDef> }) {
  if (!def) return null;
  return (
    <div style={tooltipBox}>
      <div style={tooltipTitle}>{def.name}</div>
      <div style={tooltipMeta}>
        {def.cardType === CardType.Attack ? "攻撃"
          : def.cardType === CardType.Skill ? "技"
          : def.cardType === CardType.Power ? "パワー"
          : "状態"}
        {" · "}コスト {def.cost === 999 ? "—" : def.cost}
        {def.exhausts && " · 1回限り(除外)"}
      </div>
      <div style={tooltipBody}>{def.description}</div>
      <div style={tooltipMeta}>効果: {effectText(def.effect)}</div>
    </div>
  );
}

function DrawCard({ player }: { player: PlayerState }) {
  const ok = player.cost >= DRAW_COST;
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        style={{ ...cardStyle, ...drawCard, opacity: ok ? 1 : 0.55, cursor: ok ? "pointer" : "not-allowed" }}
        onClick={() => getSession()?.pushLocalInput(INPUT_DRAW)}
      >
        <div style={cardCostStyle}>{DRAW_COST}</div>
        <div style={typeBadge}>ドロー</div>
        <div style={cardHeader}>引く</div>
        <div style={cardEffect}>山札から1枚引く。</div>
        <div style={cardKeyHint}>D</div>
      </button>
      {hover && (
        <div style={tooltipBox}>
          <div style={tooltipTitle}>ドロー</div>
          <div style={tooltipBody}>エネルギーを{DRAW_COST}消費して山札から1枚引く。山札が尽きたら捨札をシャッフルして補充。</div>
        </div>
      )}
    </div>
  );
}

function Bar({ pct, color, label, small = false }: { pct: number; color: string; label: string; small?: boolean }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...barTrack, height: small ? 10 : 18 }}>
        {/* No CSS transition — width updates instantly so the bar tracks the
            simulation step exactly instead of trailing behind. */}
        <div style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%`, height: "100%", background: color }} />
      </div>
      <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Pile({ label, n, color, onClick }: { label: string; n: number; color: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        textAlign: "center", padding: "4px 8px", borderRadius: 6,
        background: "#22222a", border: `1px solid ${color}33`, minWidth: 60,
        cursor: onClick ? "pointer" : "default", color: "inherit",
      }}
      title={onClick ? "クリックで中身を見る" : undefined}
    >
      <div style={{ color, fontSize: 10, opacity: 0.7 }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 600 }}>{n}</div>
    </button>
  );
}

function effectText(e: CardEffect): string {
  switch (e.kind) {
    case "Damage": return `${e.amount}ダメージ${e.pierceBlock ? `(貫通${(e.pierceBlock * 100) | 0}%)` : ""}`;
    case "MultiHit": return `${e.damage}ダメージ×${e.hits}${e.pierceBlock ? `(貫通${(e.pierceBlock * 100) | 0}%)` : ""}`;
    case "Heal": return `${e.amount}回復`;
    case "Draw": return `${e.count}枚ドロー`;
    case "Block": return `ブロック+${e.amount}`;
    case "Thorns": return `棘+${e.amount}`;
    case "Strength": return `筋力+${e.amount}`;
    case "Vulnerable": return `相手に脆弱${e.duration}秒`;
    case "SelfVulnerable": return `自分に脆弱${e.duration}秒`;
    case "Weak": return `相手に弱体${e.duration}秒`;
    case "Accelerate": return `コスト+${e.bonusRate}/秒を${e.duration}秒`;
    case "BodySlam": return `現在のブロックと同じダメージ`;
    case "Bloodletting": return e.amount < 0 ? `自分が${-e.amount}ダメージ` : `${e.amount}回復`;
    case "DoubleBlock": return `現在のブロックを2倍`;
    case "DoubleStrength": return `現在の筋力を2倍`;
    case "Rage": return `攻撃ごとブロック+${e.blockPerAttack}を10秒`;
    case "Metallicize": return `毎秒ブロック+${e.blockPerSecond}`;
    case "Combust": return `毎秒、自分${e.selfDmgPerSec}・相手${e.enemyDmgPerSec}ダメージ`;
    case "DemonForm": return `毎秒筋力+${e.strengthPerSecond}`;
    case "Barricade": return `ブロックが減らなくなる`;
    case "Juggernaut": return `ブロック獲得時に${e.damageOnBlock}ダメージ`;
    case "DarkEmbrace": return `除外時${e.draw}枚ドロー`;
    case "Evolve": return `状態カード引き時${e.draw}枚追加ドロー`;
    case "FeelNoPain": return `除外時ブロック+${e.block}`;
    case "FireBreathing": return `状態カード引き時${e.damage}ダメージ`;
    case "Rupture": return `自傷時筋力+${e.strength}`;
    case "Corruption": return `スキルが0コスト・除外`;
    case "Brutality": return `毎秒自分${e.selfDmgPerSec}+${e.drawInterval}秒ごと${e.draw}枚`;
    case "Exhaust": return `効果なし(除外)`;
    case "AddStatus": return `状態カードを追加`;
    case "Combo": return e.effects.map(effectText).join(" + ");
  }
}

function typeColor(t: CardType, playable: boolean): string {
  const dim = playable ? 1 : 0.55;
  switch (t) {
    case CardType.Attack: return `rgba(${(193 * dim) | 0}, ${(45 * dim) | 0}, ${(45 * dim) | 0}, 1)`;
    case CardType.Skill:  return `rgba(${(45 * dim) | 0}, ${(105 * dim) | 0}, ${(193 * dim) | 0}, 1)`;
    case CardType.Power:  return `rgba(${(140 * dim) | 0}, ${(60 * dim) | 0}, ${(193 * dim) | 0}, 1)`;
    case CardType.Status: return "#444";
  }
}

// ── styles ────────────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: 16, gap: 14,
  background: "linear-gradient(180deg, #14141c 0%, #0a0a12 100%)",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const topBar: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "#aaa", border: "1px solid #333", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
const panel: React.CSSProperties = { display: "flex", padding: 12, background: "#181822", border: "1px solid #2a2a35", borderRadius: 10, gap: 16, alignItems: "center" };
const panelLabel: React.CSSProperties = { fontSize: 12, opacity: 0.6, letterSpacing: 2, marginBottom: 6 };
const pillRow: React.CSSProperties = { marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 };
const pileStack: React.CSSProperties = { display: "flex", gap: 6, flexShrink: 0 };
const barTrack: React.CSSProperties = { background: "#0c0c12", border: "1px solid #2a2a35", borderRadius: 4, overflow: "hidden" };
const pill = (color: string): React.CSSProperties => ({ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: `${color}22`, color, fontSize: 11, border: `1px solid ${color}55` });
const handRow: React.CSSProperties = { display: "flex", gap: 8, justifyContent: "center", marginTop: "auto", overflowX: "auto", paddingBottom: 8 };
const cardStyle: React.CSSProperties = {
  width: 130, height: 180, padding: 10, borderRadius: 8, border: "1px solid #00000040",
  display: "flex", flexDirection: "column", justifyContent: "space-between", color: "white",
  position: "relative", textAlign: "left", flexShrink: 0,
};
const drawCard: React.CSSProperties = { background: "#3a2a55", border: "1px solid #6a4ab0" };
const cardCostStyle: React.CSSProperties = {
  position: "absolute", top: 6, left: 8, fontSize: 22, fontWeight: 700,
  color: "#ffe580", textShadow: "0 1px 2px black",
};
const typeBadge: React.CSSProperties = {
  position: "absolute", top: 8, right: 8, fontSize: 10, opacity: 0.85,
  background: "rgba(0,0,0,0.35)", padding: "1px 6px", borderRadius: 4,
};
const cardHeader: React.CSSProperties = { fontWeight: 600, fontSize: 13, marginTop: 32, textShadow: "0 1px 2px black" };
const cardEffect: React.CSSProperties = { fontSize: 11, opacity: 0.92, lineHeight: 1.3, marginTop: 4 };
const cardKeyHint: React.CSSProperties = { position: "absolute", bottom: 6, right: 8, fontSize: 11, opacity: 0.6, fontFamily: "ui-monospace, monospace" };
const tooltipBox: React.CSSProperties = {
  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
  marginBottom: 8, padding: "10px 12px", background: "rgba(20, 20, 28, 0.97)",
  border: "1px solid #444", borderRadius: 8, minWidth: 220, maxWidth: 300,
  boxShadow: "0 4px 16px rgba(0,0,0,0.6)", zIndex: 50, pointerEvents: "none",
};
const tooltipTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14, marginBottom: 4 };
const tooltipMeta: React.CSSProperties = { fontSize: 11, opacity: 0.65, marginTop: 4 };
const tooltipBody: React.CSSProperties = { fontSize: 12, opacity: 0.95, lineHeight: 1.4 };
