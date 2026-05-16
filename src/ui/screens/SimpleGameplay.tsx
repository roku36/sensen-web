// 2D HUD-only view of the same game. No Three.js, no shaders — pure DOM so
// you can A/B numbers without being seduced by visual polish.
//
// Same input path as the 3D view: clicks/keys go through getSession().pushLocalInput.

import { useEffect, useState } from "react";
import { CardType, getCardDef } from "../../sim/cards";
import { cardFlag, INPUT_DRAW } from "../../sim/input";
import { COMBO_WINDOW, DRAW_COST } from "../../sim/rules";
import { PlayerState } from "../../sim/state";
import { getSession, useKeyboardInput } from "../hooks";
import { useStore } from "../store";

export function SimpleGameplay() {
  useKeyboardInput();
  const game = useStore((s) => s.game);
  const localPlayer = useStore((s) => s.localPlayer);
  const setScreen = useStore((s) => s.setScreen);

  // Force re-render at ~30Hz so the bars track the sim.
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  if (!game) return null;
  const me = game.players[localPlayer];
  const op = game.players[(localPlayer ^ 1) as 0 | 1];

  return (
    <div style={page}>
      <div style={topBar}>
        <button style={ghostBtn} onClick={() => setScreen("title")}>← Title</button>
        <span style={{ opacity: 0.6, fontSize: 12 }}>frame {game.frame} · simple view</span>
      </div>

      {/* Opponent panel */}
      <PlayerPanel player={op} title="OPPONENT" mirrored />

      <Center game={game} />

      {/* Self panel */}
      <PlayerPanel player={me} title="YOU" />

      <SelfHand player={me} />
    </div>
  );
}

function Center({ game }: { game: any }) {
  const result = game.result as 0 | 1 | 2 | 3;
  if (result === 0) return null;
  const text = result === 1 ? "P0 WINS" : result === 2 ? "P1 WINS" : "DRAW";
  return (
    <div style={banner}>{text}</div>
  );
}

function PlayerPanel({ player, title, mirrored = false }: { player: PlayerState; title: string; mirrored?: boolean }) {
  const hpPct = player.hp / player.hpMax;
  const energyPct = player.cost / player.costMax;
  return (
    <div style={{ ...panel, flexDirection: mirrored ? "row-reverse" : "row" }}>
      <div style={{ flex: 1 }}>
        <div style={panelLabel}>{title}</div>
        <Bar pct={hpPct} color={hpPct > 0.4 ? "#34c759" : hpPct > 0.2 ? "#ffcc00" : "#ff3b30"} label={`${Math.round(player.hp)} / ${player.hpMax} HP`} flash={false} />
        <Bar pct={energyPct} color="#ffd166" label={`${player.cost.toFixed(1)} / ${player.costMax} energy (+${player.costRate.toFixed(2)}/s)`} small />
        <div style={pill("#5fa0e0")}>Block {Math.round(player.block)}</div>
        {player.thorns > 0 && <div style={pill("#ff9f43")}>Thorns {Math.round(player.thorns)}</div>}
        {player.strength !== 0 && <div style={pill("#ff6961")}>Str {player.strength > 0 ? "+" : ""}{player.strength}</div>}
        {player.vulnerableSecs > 0 && <div style={pill("#ff8a00")}>Vuln {player.vulnerableSecs.toFixed(1)}s</div>}
        {player.weakSecs > 0 && <div style={pill("#a899ff")}>Weak {player.weakSecs.toFixed(1)}s</div>}
        {player.metallicize && <div style={pill("#9bb")}>Metallicize +{player.metallicize.blockPerSec}/s</div>}
        {player.combust && <div style={pill("#ff5757")}>Combust {player.combust.enemyPerSec}/s</div>}
        {player.demonForm && <div style={pill("#c050ff")}>DemonForm +{player.demonForm.strengthPerSec}str/s</div>}
        {player.barricade && <div style={pill("#80ffe0")}>Barricade</div>}
      </div>
      <div style={pileStack}>
        <Pile label="Deck" n={player.deck.length} color="#5b9eff" />
        <Pile label="Discard" n={player.discard.length} color="#ff7a8a" />
        <Pile label="Hand" n={player.hand.length} color="#cccccc" />
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
  if (!def) return null;
  const isCorruptionDiscount = !!player.corruption && def.cardType === CardType.Skill;
  const now = (useStore.getState().game?.frame ?? 0) / 60;
  const isComboReady =
    player.lastPlayedCard === cardId && now - player.lastPlayedAt < COMBO_WINDOW;
  const baseCost = isCorruptionDiscount ? 0 : def.cost;
  const effectiveCost = isComboReady ? baseCost * 0.5 : baseCost;
  const isCharge = !!def.chargeAttack;
  const playable =
    def.cost !== 999 &&
    (isCharge ? player.cost >= player.costMax - 0.01 : player.cost >= effectiveCost);

  const onClick = () => {
    const flag = cardFlag(idx);
    if (flag !== null) getSession()?.pushLocalInput(flag);
  };

  return (
    <button
      onClick={onClick}
      disabled={!playable}
      style={{
        ...cardStyle,
        background: typeColor(def.cardType, playable),
        cursor: playable ? "pointer" : "not-allowed",
        boxShadow: isComboReady ? "0 0 16px #ffe066" : (playable ? "0 4px 12px rgba(0,0,0,0.4)" : "none"),
        opacity: playable ? 1 : 0.5,
      }}
      title={effectLabel(def.effect)}
    >
      <div style={cardCost(isComboReady)}>
        {def.cost === 999 ? "✗" : isCharge ? "★" : effectiveCost.toFixed(1).replace(".0", "")}
        {isComboReady && <span style={{ fontSize: 9, marginLeft: 2, color: "#ffe066" }}>combo</span>}
      </div>
      <div style={cardHeader}>{def.name}</div>
      <div style={cardEffect}>{effectLabel(def.effect)}</div>
      <div style={cardKeyHint}>{idx === 9 ? "0" : (idx + 1).toString()}</div>
    </button>
  );
}

function DrawCard({ player }: { player: PlayerState }) {
  const ok = player.cost >= DRAW_COST;
  return (
    <button
      style={{ ...cardStyle, ...drawCard, opacity: ok ? 1 : 0.5, cursor: ok ? "pointer" : "not-allowed" }}
      onClick={() => getSession()?.pushLocalInput(INPUT_DRAW)}
    >
      <div style={cardCost(false)}>{DRAW_COST}</div>
      <div style={cardHeader}>Draw</div>
      <div style={cardEffect}>Draw 1 card</div>
      <div style={cardKeyHint}>D</div>
    </button>
  );
}

function Bar({ pct, color, label, small = false, flash = false }: { pct: number; color: string; label: string; small?: boolean; flash?: boolean }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...barTrack, height: small ? 10 : 18 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%`, height: "100%", background: color, transition: "width 0.15s ease-out", boxShadow: flash ? "0 0 12px white" : "none" }} />
      </div>
      <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Pile({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <div style={{ textAlign: "center", padding: "4px 8px", borderRadius: 6, background: "#22222a", border: `1px solid ${color}33`, minWidth: 60 }}>
      <div style={{ color, fontSize: 10, opacity: 0.7 }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 600 }}>{n}</div>
    </div>
  );
}

function effectLabel(e: any): string {
  switch (e.kind) {
    default: return e.kind ?? "";
    case "Damage": return `Deal ${e.amount}${e.pierceBlock ? ` (pierce ${(e.pierceBlock * 100) | 0}%)` : ""}`;
    case "MultiHit": return `${e.damage} × ${e.hits}${e.pierceBlock ? ` (pierce ${(e.pierceBlock * 100) | 0}%)` : ""}`;
    case "Heal": return `Heal ${e.amount}`;
    case "Draw": return `Draw ${e.count}`;
    case "Block": return `Block ${e.amount}`;
    case "Thorns": return `+${e.amount} Thorns`;
    case "Strength": return `+${e.amount} Str`;
    case "Vulnerable": return `Vuln ${e.duration}s`;
    case "SelfVulnerable": return `Self-Vuln ${e.duration}s`;
    case "Weak": return `Weak ${e.duration}s`;
    case "Accelerate": return `Accel +${e.bonusRate}/s for ${e.duration}s`;
    case "BodySlam": return `Damage = current Block`;
    case "Bloodletting": return e.amount < 0 ? `Lose ${-e.amount} HP` : `Heal ${e.amount}`;
    case "DoubleBlock": return `Double Block`;
    case "DoubleStrength": return `Double Str`;
    case "Rage": return `Rage: +${e.blockPerAttack} Block on Attack`;
    case "Metallicize": return `+${e.blockPerSecond} Block/s`;
    case "Combust": return `Combust ${e.enemyDmgPerSec}/s`;
    case "DemonForm": return `+${e.strengthPerSecond} Str/s`;
    case "Barricade": return `Block doesn't decay`;
    case "Juggernaut": return `Damage on Block`;
    case "DarkEmbrace": return `+${e.draw} draw on exhaust`;
    case "Evolve": return `+${e.draw} draw on status`;
    case "FeelNoPain": return `+${e.block} Block on exhaust`;
    case "FireBreathing": return `${e.damage} dmg on status draw`;
    case "Rupture": return `+${e.strength} Str on self-dmg`;
    case "Corruption": return `Skills cost 0 + exhaust`;
    case "Brutality": return `Self-dmg + draw`;
    case "Exhaust": return `Unplayable`;
    case "AddStatus": return `Add status to discard`;
    case "Combo": return e.effects.map(effectLabel).join(" · ");
  }
  return "";
}

function typeColor(t: CardType, playable: boolean): string {
  const dim = playable ? 1 : 0.55;
  switch (t) {
    case CardType.Attack: return `rgba(${Math.round(193 * dim)}, ${Math.round(45 * dim)}, ${Math.round(45 * dim)}, 1)`;
    case CardType.Skill:  return `rgba(${Math.round(45 * dim)}, ${Math.round(105 * dim)}, ${Math.round(193 * dim)}, 1)`;
    case CardType.Power:  return `rgba(${Math.round(140 * dim)}, ${Math.round(60 * dim)}, ${Math.round(193 * dim)}, 1)`;
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
const pileStack: React.CSSProperties = { display: "flex", gap: 6, flexShrink: 0 };
const barTrack: React.CSSProperties = { background: "#0c0c12", border: "1px solid #2a2a35", borderRadius: 4, overflow: "hidden" };
const pill = (color: string): React.CSSProperties => ({ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: `${color}22`, color, fontSize: 11, marginRight: 6, marginTop: 4, border: `1px solid ${color}55` });
const handRow: React.CSSProperties = { display: "flex", gap: 8, justifyContent: "center", marginTop: "auto", overflowX: "auto", paddingBottom: 8 };
const cardStyle: React.CSSProperties = {
  width: 130, height: 180, padding: 10, borderRadius: 8, border: "1px solid #00000040",
  display: "flex", flexDirection: "column", justifyContent: "space-between", color: "white",
  position: "relative", textAlign: "left", flexShrink: 0,
};
const drawCard: React.CSSProperties = { background: "#3a2a55", border: "1px solid #6a4ab0" };
const cardCost = (combo: boolean): React.CSSProperties => ({
  position: "absolute", top: 6, left: 8, fontSize: 22, fontWeight: 700,
  color: combo ? "#ffe066" : "#ffe580", textShadow: "0 1px 2px black",
  display: "flex", alignItems: "center",
});
const cardHeader: React.CSSProperties = { fontWeight: 600, fontSize: 13, marginTop: 22, textShadow: "0 1px 2px black" };
const cardEffect: React.CSSProperties = { fontSize: 11, opacity: 0.92, lineHeight: 1.25, marginTop: 4 };
const cardKeyHint: React.CSSProperties = { position: "absolute", bottom: 6, right: 8, fontSize: 11, opacity: 0.6, fontFamily: "ui-monospace, monospace" };
const banner: React.CSSProperties = { position: "absolute", top: "40%", left: 0, right: 0, textAlign: "center", padding: 16, fontSize: 32, background: "rgba(0,0,0,0.7)" };
