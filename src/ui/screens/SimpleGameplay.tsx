// 2D HUD-only view of the game (cast-time model v2).
//
// Layout, top to bottom:
//   - top bar
//   - opponent status panel  (HP, status pills, piles)
//   - opponent hand (face-down backs)
//   - battle zone:
//        opp casting:  [card name | ▓▓▓░░ | 0.3s remaining]
//        🛡 opp block
//        ─── divider ───
//        🛡 my block
//        my casting:   [card name | ▓░░░░ | 1.2s remaining]
//   - my hand (face-up, click to start cast; dimmed while casting)
//   - my status panel (HP, pills, piles)

import { useState } from "react";
import { CardEffect, CardType, getCardDef } from "../../sim/cards";
import { cardFlag } from "../../sim/input";
import { DT } from "../../sim/rules";
import { PlayerState } from "../../sim/state";
import { getActiveMode, getSession, useKeyboardInput } from "../hooks";
import { useStore } from "../store";
import { PilePeek } from "./PilePeek";
import { ResultPanel } from "./ResultPanel";

const AI_LABEL: Record<string, string> = {
  passive: "なし", random: "ランダム", greedyDefense: "防御型", greedyAttack: "攻撃型", heuristic: "バランス型",
};

type Peek =
  | { kind: "deck"; side: 0 | 1 }
  | { kind: "discard"; side: 0 | 1 }
  | null;

export function SimpleGameplay() {
  useKeyboardInput();
  const game = useStore((s) => s.game);
  useStore((s) => s.gameFrame); // re-render every sim step
  const localPlayer = useStore((s) => s.localPlayer);
  const setScreen = useStore((s) => s.setScreen);
  const aiName = useStore((s) => s.aiOpponentName);
  const aiSpectate = useStore((s) => s.aiSpectate);
  const [peek, setPeek] = useState<Peek>(null);

  const mode = getActiveMode();
  const opponentTitle =
    mode === "offline" ? `CPU 相手 (${AI_LABEL[aiName] ?? aiName})` : "相手";
  const selfTitle =
    mode === "offline" && aiSpectate ? `CPU 自分 (${AI_LABEL[aiName] ?? aiName})` : "自分";

  if (!game) return null;
  const me = game.players[localPlayer];
  const op = game.players[(localPlayer ^ 1) as 0 | 1];
  const now = game.frame * DT;

  return (
    <div style={page}>
      <div style={topBar}>
        <button style={ghostBtn} onClick={() => setScreen("title")}>← タイトル</button>
        <span style={{ opacity: 0.6, fontSize: 12 }}>frame {game.frame} · 2D · cast-time model</span>
      </div>

      <StatusPanel player={op} title={opponentTitle} mirrored side={(localPlayer ^ 1) as 0 | 1} onPeek={setPeek} />
      <OpponentHand count={op.hand.length} />

      <BattleZone op={op} me={me} now={now} />

      <SelfHand player={me} />
      <StatusPanel player={me} title={selfTitle} side={localPlayer} onPeek={setPeek} />

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

// ── Status panel (no energy bar in cast model) ──

function StatusPanel({
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
        <div style={pillRow}>
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

// ── Battle zone: cast bars + blocks (the "what is happening" core) ──

function BattleZone({ op, me, now }: { op: PlayerState; me: PlayerState; now: number }) {
  return (
    <div style={battleZone}>
      <CastBar player={op} now={now} side="top" label="相手のキャスト" />
      <BlockRow value={op.block} side="top" label="相手のブロック" />
      <div style={battleDivider} />
      <BlockRow value={me.block} side="bottom" label="自分のブロック" />
      <CastBar player={me} now={now} side="bottom" label="自分のキャスト" />
    </div>
  );
}

function CastBar({ player, now, side, label }: { player: PlayerState; now: number; side: "top" | "bottom"; label: string }) {
  if (player.queue.length === 0) {
    return (
      <div style={{ ...castRow, justifyContent: side === "top" ? "flex-end" : "flex-start" }}>
        <span style={castIdleText}>{label}: 待機中</span>
      </div>
    );
  }
  // Head is currently casting; rest are queued.
  const head = player.queue[0];
  const rest = player.queue.slice(1);
  const elapsed = now - player.castStartedAt;
  const headRemaining = Math.max(0, head.duration - elapsed);
  const headPct = head.duration > 0 ? Math.min(1, elapsed / head.duration) : 1;
  const queueTotal = headRemaining + rest.reduce((s, q) => s + q.duration, 0);
  return (
    <div style={{ ...castRow, justifyContent: side === "top" ? "flex-end" : "flex-start", flexDirection: side === "top" ? "row-reverse" : "row" }}>
      <div style={castLabel}>
        <span style={castName}>{label}</span>
        <span style={castSub}>{player.queue.length}枚 · 合計 {queueTotal.toFixed(1)}秒</span>
      </div>
      <div style={queueRow}>
        <QueueChip cardId={head.cardId} pct={headPct} remaining={headRemaining} duration={head.duration} isHead />
        {rest.map((q, i) => (
          <QueueChip key={i} cardId={q.cardId} pct={0} remaining={q.duration} duration={q.duration} />
        ))}
      </div>
    </div>
  );
}

function QueueChip({ cardId, pct, remaining, duration, isHead = false }: { cardId: number; pct: number; remaining: number; duration: number; isHead?: boolean }) {
  const def = getCardDef(cardId);
  const color = def?.cardType === CardType.Attack ? "#e3553c"
    : def?.cardType === CardType.Power ? "#b465e0"
    : "#5fa0e0";
  return (
    <div style={{ ...queueChip, opacity: isHead ? 1 : 0.7, borderColor: isHead ? color : "#444" }}>
      <div style={{ ...queueChipFill, width: `${pct * 100}%`, background: color }} />
      <div style={queueChipContent}>
        <span style={queueChipName}>{def?.name ?? "??"}</span>
        <span style={queueChipTime}>
          {isHead
            ? `${remaining.toFixed(1)}s / ${duration}s`
            : `${duration}s 待機`}
        </span>
      </div>
    </div>
  );
}

function BlockRow({ value, side, label }: { value: number; side: "top" | "bottom"; label: string }) {
  const hidden = value <= 0;
  return (
    <div style={{ ...blockShieldRow, justifyContent: side === "top" ? "flex-end" : "flex-start", opacity: hidden ? 0.35 : 1 }}>
      <div style={{ ...blockShield, background: hidden ? "transparent" : "linear-gradient(180deg, #2d6cb8 0%, #1b4170 100%)" }}>
        <span style={{ fontSize: 18 }}>🛡</span>
        <span style={blockNum}>{Math.round(value)}</span>
      </div>
      <span style={blockLabel}>{label}</span>
    </div>
  );
}

// ── Opponent hand: face-down backs ──

function OpponentHand({ count }: { count: number }) {
  return (
    <div style={oppHandRow}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={cardBack}><div style={cardBackSigil}>✦</div></div>
      ))}
      {count === 0 && <div style={{ fontSize: 11, opacity: 0.4 }}>(相手の手札なし)</div>}
    </div>
  );
}

// ── Self hand ──

function SelfHand({ player }: { player: PlayerState }) {
  return (
    <div style={handRow}>
      {player.hand.map((cardId, i) => (
        <SimpleCard key={i} cardId={cardId} idx={i} player={player} />
      ))}
    </div>
  );
}

function SimpleCard({ cardId, idx, player }: { cardId: number; idx: number; player: PlayerState }) {
  const def = getCardDef(cardId);
  const [hover, setHover] = useState(false);
  if (!def) return null;
  const unplayable = def.cost >= 900;
  // You can keep clicking to queue more casts; only status junk is unplayable.
  const clickable = !unplayable;

  const onClick = () => {
    if (!clickable) return;
    const flag = cardFlag(idx);
    if (flag !== null) getSession()?.pushLocalInput(flag);
  };

  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        onClick={onClick}
        disabled={!clickable}
        style={{
          ...cardStyle,
          background: typeColor(def.cardType, clickable),
          cursor: clickable ? "pointer" : "not-allowed",
          boxShadow: clickable ? "0 4px 12px rgba(0,0,0,0.4)" : "none",
          outline: def.exhausts ? "1px solid #ffaa55" : "none",
          opacity: clickable ? 1 : 0.55,
        }}
      >
        {!clickable && (
          <div aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", pointerEvents: "none" }} />
        )}
        <div style={{ ...cardCostStyle, color: clickable ? "#ffe580" : "#cfd6e0" }}>
          {unplayable ? "✗" : (def.cost % 1 === 0 ? def.cost.toFixed(0) : def.cost.toFixed(1)) + "s"}
        </div>
        <div style={typeBadge}>
          {def.cardType === CardType.Attack ? "攻撃"
            : def.cardType === CardType.Skill ? "技"
            : def.cardType === CardType.Power ? "パワー" : "状態"}
          {def.exhausts && " · 1回限り"}
        </div>
        <div style={{ ...cardHeader, position: "relative" }}>{def.name}</div>
        <div style={{ ...cardEffect, position: "relative" }}>{def.description}</div>
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
          : def.cardType === CardType.Power ? "パワー" : "状態"}
        {" · "}キャスト {def.cost >= 900 ? "不可" : def.cost + "秒"}
        {def.exhausts && " · 1回限り(除外)"}
      </div>
      <div style={tooltipBody}>{def.description}</div>
      <div style={tooltipMeta}>効果: {effectText(def.effect)}</div>
    </div>
  );
}

function Bar({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...barTrack, height: 18 }}>
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
        background: "#22222a", border: `1px solid ${color}33`, minWidth: 56,
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
    case "Draw": return `${e.count}枚追加ドロー`;
    case "Block": return `ブロック+${e.amount}`;
    case "Thorns": return `棘+${e.amount}`;
    case "Strength": return `筋力+${e.amount}`;
    case "Vulnerable": return `相手に脆弱${e.duration}秒`;
    case "SelfVulnerable": return `自分に脆弱${e.duration}秒`;
    case "Weak": return `相手に弱体${e.duration}秒`;
    case "Accelerate": return `(現在無効)`;
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
    case "Corruption": return `スキルが0秒キャスト・除外`;
    case "Brutality": return `毎秒自分${e.selfDmgPerSec}+${e.drawInterval}秒ごと${e.draw}枚`;
    case "Exhaust": return `効果なし(除外)`;
    case "AddStatus": return `状態カードを追加`;
    case "Combo": return e.effects.map(effectText).join(" + ");
  }
}

function typeColor(t: CardType, active: boolean): string {
  const dim = active ? 1 : 0.55;
  switch (t) {
    case CardType.Attack: return `rgba(${(193 * dim) | 0}, ${(45 * dim) | 0}, ${(45 * dim) | 0}, 1)`;
    case CardType.Skill:  return `rgba(${(45 * dim) | 0}, ${(105 * dim) | 0}, ${(193 * dim) | 0}, 1)`;
    case CardType.Power:  return `rgba(${(140 * dim) | 0}, ${(60 * dim) | 0}, ${(193 * dim) | 0}, 1)`;
    case CardType.Status: return "#444";
  }
}

// ── styles ──

const page: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: 14, gap: 10,
  background: "linear-gradient(180deg, #14141c 0%, #0a0a12 100%)",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const topBar: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "#aaa", border: "1px solid #333", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
const panel: React.CSSProperties = { display: "flex", padding: 10, background: "#181822", border: "1px solid #2a2a35", borderRadius: 10, gap: 16, alignItems: "center" };
const panelLabel: React.CSSProperties = { fontSize: 12, opacity: 0.6, letterSpacing: 2, marginBottom: 4 };
const pillRow: React.CSSProperties = { marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 };
const pileStack: React.CSSProperties = { display: "flex", gap: 6, flexShrink: 0, alignItems: "stretch" };
const barTrack: React.CSSProperties = { background: "#0c0c12", border: "1px solid #2a2a35", borderRadius: 4, overflow: "hidden" };
const pill = (color: string): React.CSSProperties => ({ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: `${color}22`, color, fontSize: 11, border: `1px solid ${color}55` });

const oppHandRow: React.CSSProperties = { display: "flex", gap: 4, justifyContent: "center", minHeight: 72, alignItems: "center" };
const cardBack: React.CSSProperties = {
  width: 50, height: 70, borderRadius: 6,
  background: "linear-gradient(135deg, #2a2438 0%, #15101e 100%)",
  border: "1px solid #4a3d6a",
  display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "inset 0 0 8px rgba(160, 110, 255, 0.15), 0 2px 6px rgba(0,0,0,0.4)",
};
const cardBackSigil: React.CSSProperties = { color: "#7a5db8", opacity: 0.55, fontSize: 24 };

const battleZone: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px",
  background: "rgba(40, 30, 60, 0.25)",
  border: "1px solid rgba(110, 80, 170, 0.35)",
  borderRadius: 10,
};
const battleDivider: React.CSSProperties = {
  height: 1, background: "linear-gradient(90deg, transparent, rgba(180,140,255,0.45), transparent)",
};
const castRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, minHeight: 36 };
const castIdleText: React.CSSProperties = { fontSize: 11, opacity: 0.4, fontStyle: "italic" };
const castLabel: React.CSSProperties = { display: "flex", flexDirection: "column", minWidth: 140 };
const castName: React.CSSProperties = { fontWeight: 700, fontSize: 14, color: "white" };
const castSub: React.CSSProperties = { fontSize: 10, opacity: 0.55 };
const queueRow: React.CSSProperties = { display: "flex", flex: 1, gap: 6, minWidth: 0, overflowX: "auto" };
const queueChip: React.CSSProperties = {
  position: "relative", minWidth: 110, maxWidth: 180, height: 38, padding: "4px 8px",
  border: "1.5px solid #444", borderRadius: 6,
  background: "#0c0c12", color: "white",
  overflow: "hidden", flex: "0 0 auto",
};
const queueChipFill: React.CSSProperties = { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.55 };
const queueChipContent: React.CSSProperties = { position: "relative", display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" };
const queueChipName: React.CSSProperties = { fontWeight: 700, fontSize: 12, lineHeight: 1, textShadow: "0 1px 2px rgba(0,0,0,0.8)" };
const queueChipTime: React.CSSProperties = { fontSize: 10, opacity: 0.85, fontFamily: "ui-monospace, monospace", marginTop: 2 };

const blockShieldRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, minHeight: 32 };
const blockShield: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px",
  borderRadius: 8, border: "1px solid rgba(95,160,224,0.7)",
  minWidth: 70, justifyContent: "center",
  boxShadow: "0 0 12px rgba(95,160,224,0.25)",
};
const blockNum: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: "white" };
const blockLabel: React.CSSProperties = { fontSize: 11, opacity: 0.75 };

const handRow: React.CSSProperties = { display: "flex", gap: 8, justifyContent: "center", overflowX: "auto", paddingBottom: 4 };
const cardStyle: React.CSSProperties = {
  width: 130, height: 180, padding: 10, borderRadius: 8, border: "1px solid #00000040",
  display: "flex", flexDirection: "column", justifyContent: "space-between", color: "white",
  position: "relative", textAlign: "left", flexShrink: 0,
};
const cardCostStyle: React.CSSProperties = {
  position: "absolute", top: 6, left: 8, fontSize: 18, fontWeight: 700,
  textShadow: "0 1px 2px black", zIndex: 2,
};
const typeBadge: React.CSSProperties = {
  position: "absolute", top: 8, right: 8, fontSize: 10, opacity: 0.92,
  background: "rgba(0,0,0,0.45)", padding: "1px 6px", borderRadius: 4, zIndex: 2,
};
const cardHeader: React.CSSProperties = { fontWeight: 600, fontSize: 13, marginTop: 32, textShadow: "0 1px 2px black", zIndex: 2 };
const cardEffect: React.CSSProperties = { fontSize: 11, opacity: 0.95, lineHeight: 1.3, marginTop: 4, zIndex: 2 };
const cardKeyHint: React.CSSProperties = { position: "absolute", bottom: 6, right: 8, fontSize: 11, opacity: 0.6, fontFamily: "ui-monospace, monospace", zIndex: 2 };

const tooltipBox: React.CSSProperties = {
  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
  marginBottom: 8, padding: "10px 12px", background: "rgba(20, 20, 28, 0.97)",
  border: "1px solid #444", borderRadius: 8, minWidth: 220, maxWidth: 300,
  boxShadow: "0 4px 16px rgba(0,0,0,0.6)", zIndex: 50, pointerEvents: "none",
};
const tooltipTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14, marginBottom: 4 };
const tooltipMeta: React.CSSProperties = { fontSize: 11, opacity: 0.65, marginTop: 4 };
const tooltipBody: React.CSSProperties = { fontSize: 12, opacity: 0.95, lineHeight: 1.4 };
