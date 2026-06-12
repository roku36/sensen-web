// 2D HUD view of the cast-time game (v4 layout).
//
// Layout:
//   ┌──────────┬────────────────────────────────────────┐
//   │ topbar                                            │
//   ├──────────┼────────────────────────────────────────┤
//   │          │ opp hand row (6 fixed slots)           │
//   │ info col ├────────────────────────────────────────┤
//   │  - 相手  │ TIMELINE (tall)                        │
//   │   HP+buf │   ─ opp queue row                      │
//   │  - 自分  │   ─ block band (opp block ↑ from mid,  │
//   │   HP+buf │     self block ↓ from mid, predicted   │
//   │          │     decay/gains/hits along the queue)  │
//   │          │   ─ self queue row                     │
//   │          ├────────────────────────────────────────┤
//   │          │ self hand row (6 fixed slots)          │
//   │          ├────────────────────────────────────────┤
//   │          │ Draw button (6-card width)             │
//   └──────────┴────────────────────────────────────────┘

import { useEffect, useRef, useState } from "react";
import { aiLabel } from "../../ai/policy";
import { CardEffect, CardType, getCardDef } from "../../sim/cards";
import {
  cardFlag, INPUT_DRAW, INPUT_RESERVE_DRAW, reserveCardFlag,
} from "../../sim/input";
import { canReserveCard, futureEmptyAtDrawPosition } from "../../sim/reducer";
import {
  DRAW_SEN_PER_CARD, DT, FRAMES_PER_SEN, MAX_HAND_SIZE, SEC_PER_SEN,
  secToSen, SUDDEN_DEATH_RAMP_SEN, SUDDEN_DEATH_START_SEN,
} from "../../sim/rules";
import { PlayerState } from "../../sim/state";

import { OfflineSession } from "../../net/offline";
import { advanceFrames, getActiveMode, getSession, useKeyboardInput } from "../hooks";
import { BattleZone, dim } from "./Timeline";
import { useStore } from "../store";
import { PilePeek } from "./PilePeek";
import { ResultPanel } from "./ResultPanel";

type Peek =
  | { kind: "deck"; side: 0 | 1 }
  | { kind: "discard"; side: 0 | 1 }
  | null;

// ── Layout constants ──
const CARD_W = 130;
const CARD_H = 180;
const CARD_GAP = 8;
const HAND_ROW_WIDTH = CARD_W * MAX_HAND_SIZE + CARD_GAP * (MAX_HAND_SIZE - 1);

const BACK_W = 50;
const BACK_H = 70;
const BACK_GAP = 4;
const OPP_HAND_WIDTH = BACK_W * MAX_HAND_SIZE + BACK_GAP * (MAX_HAND_SIZE - 1);


export function SimpleGameplay() {
  useKeyboardInput();
  const game = useStore((s) => s.game);
  useStore((s) => s.gameFrame);
  const localPlayer = useStore((s) => s.localPlayer);
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const aiName = useStore((s) => s.aiOpponentName);
  const aiSpectate = useStore((s) => s.aiSpectate);
  const [peek, setPeek] = useState<Peek>(null);

  const mode = getActiveMode();
  const opponentTitle =
    mode === "offline" ? `CPU 相手 (${aiLabel(aiName)})` : "相手";
  const selfTitle =
    mode === "offline" && aiSpectate ? `CPU 自分 (${aiLabel(aiName)})` : "自分";

  if (!game) return null;
  const me = game.players[localPlayer];
  const op = game.players[(localPlayer ^ 1) as 0 | 1];
  const opSide = (localPlayer ^ 1) as 0 | 1;
  const now = game.frame * DT;

  return (
    <div style={page}>
      <div style={topBar}>
        <button style={ghostBtn} onClick={() => setScreen("title")}>← タイトル</button>
        <span style={{ opacity: 0.6, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
          {(() => {
            const sen = Math.floor(game.frame / FRAMES_PER_SEN);
            const sd = sen >= SUDDEN_DEATH_START_SEN;
            const dmg = sd ? 1 + Math.floor((sen - SUDDEN_DEATH_START_SEN) / SUDDEN_DEATH_RAMP_SEN) : 0;
            return (
              <>
                <span style={sd ? { color: "#ff6b5e", fontWeight: 700 } : undefined}>第{sen}閃</span>
                {sd && <span style={{ color: "#ff6b5e", marginLeft: 8 }}>焦土 −{dmg}HP/閃</span>}
                {!sd && sen >= SUDDEN_DEATH_START_SEN - 5 && (
                  <span style={{ color: "#ffb347", marginLeft: 8 }}>焦土まで {SUDDEN_DEATH_START_SEN - sen}閃</span>
                )}
              </>
            );
          })()}
          {typeof window !== "undefined" && window.location.search.includes("debug")
            ? ` · frame ${game.frame}` : ""}
        </span>
      </div>

      <div style={mainRow}>
        <div style={infoColumn}>
          <PlayerInfoCard player={op} title={opponentTitle} side={opSide} onPeek={setPeek} />
          <PlayerInfoCard player={me} title={selfTitle} side={localPlayer} onPeek={setPeek} />
        </div>

        <div style={rightStack}>
          <OpponentHand player={op} now={now} />
          <BattleZone game={game} op={op} me={me} now={now} />
          <SelfHand player={me} now={now} />
          <DrawButton player={me} />
          <AdvanceButton />
          <div style={controlsHint}>
            左クリック: 予約（もう一度で取消） · 右クリック: そのカード以降を取消 · Space: 全取消 · D: ドロー · 1〜6: カード選択
          </div>
          <div style={controlsHint}>
            連閃: カードを連続発動するたび攻撃+1（最大+5）· ドローが発動するとリセット
            　|　焦土: 第{SUDDEN_DEATH_START_SEN}閃から両者に毎閃ダメージ（加速・ブロック無視）
          </div>
        </div>
      </div>

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

      {/* ResultPanel は通常対戦 (screen "gameplay") 限定。パズルやリプレイ
          画面も SimpleGameplay を下敷きにするが、そこで描画すると連勝
          加算・敗北時の resetProfile (デッキ初期化!) という副作用まで
          発火してしまう (issue #2)。 */}
      {game.result !== 0 && screen === "gameplay" && (
        <ResultPanel result={game.result as 1 | 2 | 3} localPlayer={localPlayer} />
      )}
    </div>
  );
}

// ── Player info card. Block is NOT here anymore — it's a timeline. ──

function PlayerInfoCard({
  player, title, side, onPeek,
}: {
  player: PlayerState; title: string; side: 0 | 1; onPeek: (p: Peek) => void;
}) {
  const hpPct = player.hp / player.hpMax;
  const handCount = countCards(player.hand);
  // HP変化の数字ポップ。1閃未満の連続ドレイン (燃焼等) はノイズになる
  // ので |Δ| ≥ 0.5 のみ。state は表示専用 — sim には一切触れない。
  const [pops, setPops] = useState<{ id: number; text: string; color: string }[]>([]);
  const prevHp = useRef(player.hp);
  useEffect(() => {
    const d = player.hp - prevHp.current;
    prevHp.current = player.hp;
    if (Math.abs(d) < 0.5) return;
    const id = ++popSeq;
    const text = d < 0 ? `${Math.round(d)}` : `+${Math.round(d)}`;
    setPops((p) => [...p.slice(-3), { id, text, color: d < 0 ? "#ff6b5e" : "#7fe3a4" }]);
    const t = setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 900);
    return () => clearTimeout(t);
  }, [player.hp]);
  return (
    <div style={{ ...infoCard, position: "relative" }}>
      <div style={infoCardTitle}>{title}</div>
      <Bar pct={hpPct}
           color={hpPct > 0.4 ? "#34c759" : hpPct > 0.2 ? "#ffcc00" : "#ff3b30"}
           label={`HP ${Math.round(player.hp)} / ${player.hpMax}`} />
      {pops.map((p, i) => (
        <div key={p.id} className="dmg-pop" style={{
          position: "absolute", top: 28, right: 14 + i * 34,
          fontSize: 20, fontWeight: 900, color: p.color, zIndex: 10,
          textShadow: "0 0 8px rgba(0,0,0,0.9), 0 1px 2px black",
          fontFamily: "ui-monospace, monospace",
        }}>{p.text}</div>
      ))}
      <div style={pillRow}>
        {player.renzan >= 2 && (
          <span style={pill("#ffd166")}>
            連閃 ×{player.renzan}（攻撃+{Math.min(5, player.renzan - 1)}）
          </span>
        )}
        {player.thorns > 0 && <span style={pill("#ff9f43")}>棘 {Math.round(player.thorns)}</span>}
        {player.poison > 0 && <span style={pill("#5fc870")}>毒 {player.poison}</span>}
        {player.strength !== 0 && <span style={pill("#ff6961")}>筋力 {player.strength > 0 ? "+" : ""}{player.strength}</span>}
        {player.vulnerableSecs > 0 && <span style={pill("#ff8a00")}>脆弱 {player.vulnerableSecs.toFixed(1)}秒</span>}
        {player.weakSecs > 0 && <span style={pill("#a899ff")}>弱体 {player.weakSecs.toFixed(1)}秒</span>}
        {player.metallicize && <span style={pill("#9bb")}>金属化 +{player.metallicize.blockPerSec}/秒</span>}
        {player.combust && <span style={pill("#ff5757")}>燃焼 {player.combust.enemyPerSec}/秒</span>}
        {player.demonForm && <span style={pill("#c050ff")}>悪魔の姿 +{player.demonForm.strengthPerSec}筋力/秒</span>}
        {player.barricade && <span style={pill("#80ffe0")}>防壁</span>}
        {player.corruption && <span style={pill("#aa6688")}>腐敗</span>}
      </div>
      <div style={pileStack}>
        <Pile label="山札" n={player.deck.length} color="#5b9eff" onClick={() => onPeek({ kind: "deck", side })} />
        <Pile label="捨札" n={player.discard.length} color="#ff7a8a" onClick={() => onPeek({ kind: "discard", side })} />
        <Pile label="手札" n={handCount} color="#cccccc" />
      </div>
    </div>
  );
}

let popSeq = 0; // dmg-pop 一意ID (表示専用)

function countCards(hand: (number | null)[]): number {
  let n = 0;
  for (const c of hand) if (c !== null) n++;
  return n;
}

// ── Hands (fixed 6 slots, reserved derived from queue) ──

// Resolve a slot index to its pending-draw timing, if any. Walks the queue
// and finds the (single) draw entry that targets this slot, accounting for
// queue position: the head's draw fires at castStartedAt + offset, tail
// entries' draws fire after the cumulative wait for prior entries.
function slotPendingInfo(player: PlayerState, slotIndex: number, now: number):
  { startedAt: number; fillsAt: number } | null {
  if (player.queue.length === 0) return null;
  const head = player.queue[0];
  if (head.kind === "draw") {
    const pos = head.drawSlots.indexOf(slotIndex);
    if (pos >= 0 && pos >= head.drawFilledCount) {
      const startedAt = player.castStartedAt;
      return { startedAt, fillsAt: startedAt + (pos + 1) * SEC_PER_SEN };
    }
  }
  let tailStartAbs = player.castStartedAt + head.duration;
  for (let i = 1; i < player.queue.length; i++) {
    const ent = player.queue[i];
    if (ent.kind === "draw") {
      const pos = ent.drawSlots.indexOf(slotIndex);
      if (pos >= 0) {
        return {
          startedAt: tailStartAbs,
          fillsAt: tailStartAbs + (pos + 1) * SEC_PER_SEN,
        };
      }
    }
    tailStartAbs += ent.duration;
  }
  void now;
  return null;
}

function OpponentHand({ player, now }: { player: PlayerState; now: number }) {
  return (
    <div style={{ ...oppHandRow, width: OPP_HAND_WIDTH }}>
      {Array.from({ length: MAX_HAND_SIZE }).map((_, i) => {
        const card = player.hand[i];
        const pending = slotPendingInfo(player, i, now);
        if (card !== null) {
          const def = getCardDef(card);
          // [開示] cards are visible face-up to the opponent so they can
          // anticipate the threat. Render a mini name+cost chip instead
          // of the generic face-down back.
          if (def && def.reveal) return <RevealedBack key={i} def={def} />;
          return <div key={i} style={cardBack}><div style={cardBackSigil}>✦</div></div>;
        }
        if (pending !== null) {
          return <PendingBack key={i} info={pending} now={now} />;
        }
        return <div key={i} style={emptyBack} />;
      })}
    </div>
  );
}

function RevealedBack({ def }: { def: NonNullable<ReturnType<typeof getCardDef>> }) {
  const color = def.cardType === CardType.Attack ? "#e3553c"
    : def.cardType === CardType.Power ? "#b465e0"
    : "#5fa0e0";
  return (
    <div style={{
      ...cardBack,
      background: dim(color, 0.55),
      border: `2px solid ${color}`,
      flexDirection: "column", padding: "4px 3px",
      gap: 2,
    }}>
      <div style={{
        fontSize: 9, color: "#ffe066", fontWeight: 700, fontFamily: "ui-monospace, monospace",
      }}>{def.cost}閃</div>
      <div style={{
        fontSize: 9, color: "white", fontWeight: 600, textAlign: "center",
        lineHeight: 1.1, padding: "0 2px",
        textShadow: "0 1px 2px rgba(0,0,0,0.8)",
      }}>{def.name}</div>
      <div style={{
        fontSize: 7, color: "#ffe066", opacity: 0.85,
      }}>開示</div>
    </div>
  );
}

function SelfHand({ player, now }: { player: PlayerState; now: number }) {
  return (
    <div style={{ ...handRow, width: HAND_ROW_WIDTH }}>
      {Array.from({ length: MAX_HAND_SIZE }).map((_, i) => {
        const card = player.hand[i];
        const pending = slotPendingInfo(player, i, now);
        if (card !== null) {
          return <SimpleCard key={i} cardId={card} idx={i} player={player} now={now} />;
        }
        if (pending !== null) {
          return <PendingSlot key={i} info={pending} now={now} />;
        }
        return <div key={i} style={emptySlot} />;
      })}
    </div>
  );
}

function PendingSlot({ info, now }: { info: { startedAt: number; fillsAt: number }; now: number }) {
  const total = Math.max(0.001, info.fillsAt - info.startedAt);
  const elapsed = Math.max(0, now - info.startedAt);
  const fillPct = Math.max(0, Math.min(1, elapsed / total));
  const remainingSen = Math.max(0, secToSen(info.fillsAt - now));
  return (
    <div style={pendingSlotFront}>
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        height: `${fillPct * 100}%`,
        background: "linear-gradient(180deg, rgba(95,160,224,0.25) 0%, rgba(95,160,224,0.55) 100%)",
        // No transition: height is recomputed every frame already; a CSS
        // transition on top of that just lags behind and stutters.
        pointerEvents: "none",
      }} />
      <div style={pendingSlotLabel}>引いてる</div>
      <div style={pendingSlotCountdown}>{remainingSen.toFixed(1)}閃</div>
    </div>
  );
}

function PendingBack({ info, now }: { info: { startedAt: number; fillsAt: number }; now: number }) {
  const total = Math.max(0.001, info.fillsAt - info.startedAt);
  const elapsed = Math.max(0, now - info.startedAt);
  const fillPct = Math.max(0, Math.min(1, elapsed / total));
  const remainingSen = Math.max(0, secToSen(info.fillsAt - now));
  return (
    <div style={pendingBack}>
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        height: `${fillPct * 100}%`,
        background: "linear-gradient(180deg, rgba(122,93,184,0.35) 0%, rgba(122,93,184,0.55) 100%)",
        // No transition: height is recomputed every frame already; a CSS
        // transition on top of that just lags behind and stutters.
        pointerEvents: "none",
      }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: "#a899ff", textShadow: "0 1px 2px black", zIndex: 1 }}>
        {remainingSen.toFixed(1)}閃
      </div>
    </div>
  );
}

function SimpleCard({ cardId, idx, player, now }: { cardId: number; idx: number; player: PlayerState; now: number }) {
  const def = getCardDef(cardId);
  const [hover, setHover] = useState(false);
  if (!def) return null;
  const unplayable = def.cost >= 900;
  // Reservation order: 1-based index in the manual reservations list, or 0
  // if not reserved. Shown as a yellow numbered badge on the card so the
  // player can see the planned play sequence.
  const reservationIdx = player.reservations.findIndex(
    (r) => r.kind === "card" && r.slotIndex === idx,
  );
  const reserved = reservationIdx >= 0;
  const reservationOrder = reservationIdx + 1;
  // Click gate: canReserveCard IS the sim's own reservation gate (single
  // source of truth — empty slot / status junk / heavy prereq feasibility,
  // frame-exact). The UI never disables a click the sim would accept, and
  // never allows one the sim would drop. Already-reserved cards stay
  // clickable: the same click CANCELS (toggle semantics).
  const prereqOk = (def.prereqQueueTime ?? 0) === 0 || reserved
    || canReserveCard(player, idx, now);
  const clickable = !unplayable && (reserved || canReserveCard(player, idx, now));

  const onClick = () => {
    if (!clickable) return;
    const flag = cardFlag(idx);
    if (flag !== null) getSession()?.pushLocalInput(flag);
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (unplayable) return;
    const flag = reserveCardFlag(idx);
    if (flag !== null) getSession()?.pushLocalInput(flag);
  };

  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        className={`hand-card${reserved ? " reserved-card" : ""}`}
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={!clickable}
        style={{
          ...cardStyle,
          background: typeColor(def.cardType, clickable),
          cursor: clickable ? "pointer" : "not-allowed",
          boxShadow: clickable
            ? "0 6px 18px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.4)"
            : "inset 0 1px 0 rgba(255,255,255,0.05)",
          border: reserved
            ? "1px solid rgba(255,224,102,0.9)"
            : `1px solid ${typeEdge(def.cardType, clickable)}`,
          outline: def.exhausts && !reserved ? "1px solid rgba(255,170,85,0.5)" : "none",
          outlineOffset: 2,
          opacity: clickable ? 1 : 0.55,
        }}
      >
        {!clickable && (
          <div aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", pointerEvents: "none" }} />
        )}
        {reserved && (
          <div aria-hidden style={{
            position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
            background: "#ffe066", color: "#1a1a22",
            padding: "2px 8px", borderRadius: 999,
            fontSize: 11, fontWeight: 700, letterSpacing: 1, zIndex: 3,
            boxShadow: "0 0 6px rgba(255, 224, 102, 0.6)",
          }}>{reservationOrder}</div>
        )}
        {def.matureInto !== undefined && (def.matureSen ?? 0) > 0 && (
          (() => {
            const total = (def.matureSen ?? 1) * FRAMES_PER_SEN;
            const age = player.handAge[idx] ?? 0;
            const remainSen = Math.max(0, (total - age) / FRAMES_PER_SEN);
            // Upgrading (熟成: orange, anticipation) vs rotting (変質:
            // red, urgency) — the player must read these differently.
            const next = getCardDef(def.matureInto);
            const rotting = !next || next.cost >= 900;
            const color = rotting ? "#ff5252" : "#ffb347";
            return (
              <div aria-hidden style={{
                position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 2,
                pointerEvents: "none",
              }}>
                <div style={{
                  height: 4, background: "rgba(0,0,0,0.5)",
                }}>
                  <div style={{
                    height: "100%", width: `${Math.min(100, (age / total) * 100)}%`,
                    background: color,
                  }} />
                </div>
                <div style={{
                  position: "absolute", right: 4, bottom: 6,
                  fontSize: 9, color, fontWeight: 700,
                  textShadow: "0 1px 2px black",
                }}>{rotting ? "変質" : "熟成"}まで {remainSen.toFixed(1)}閃</div>
              </div>
            );
          })()
        )}
        <div style={{ ...cardCostStyle, ...(unplayable ? { filter: "grayscale(1) brightness(0.7)" } : clickable ? {} : { filter: "saturate(0.4) brightness(0.75)" }) }}>
          {unplayable ? "✗" : def.cost}<span style={{ fontSize: 9, fontWeight: 700, marginLeft: 1 }}>閃</span>
        </div>
        {(def.prereqQueueTime ?? 0) > 0 && (
          <div style={{
            position: "absolute", top: 40, left: 6, zIndex: 2,
            fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
            background: prereqOk ? "rgba(40,120,70,0.85)" : "rgba(120,70,20,0.85)",
            color: prereqOk ? "#a8ffc8" : "#ffc890",
            border: `1px solid ${prereqOk ? "rgba(128,255,160,0.5)" : "rgba(255,154,64,0.5)"}`,
          }}>
            要{def.prereqQueueTime}閃
          </div>
        )}
        <div style={typeBadge}>
          {def.cardType === CardType.Attack ? "攻撃"
            : def.cardType === CardType.Skill ? "技"
            : def.cardType === CardType.Power ? "パワー" : "状態"}
          {def.exhausts && " · 1回限り"}
        </div>
        <div style={{ ...cardHeader, position: "relative" }}>{def.name}</div>
        <div style={{
          ...cardEffect, position: "relative",
          // 熟成/変質カードは下部にカウントダウンバー+ラベルが乗るので、
          // 説明文がそれと重ならないよう余白を確保する (issue #3)。
          ...(def.matureInto !== undefined ? { paddingBottom: 18 } : {}),
        }}>{def.description}</div>
        <div style={cardKeyHint}>{idx === 9 ? "0" : (idx + 1).toString()}</div>
      </button>
      {hover && <Tooltip def={def} />}
    </div>
  );
}

function DrawButton({ player }: { player: PlayerState }) {
  // Count slots that will be empty WHEN A NEW DRAW FIRES — i.e., future-empty
  // after all currently-reserved cards have fired. So with reservations
  // [card, card, card] (none fired yet), the Draw button shows "3枚" because
  // by the time the new draw reaches the head, those 3 slots are empty.
  const emptyCount = futureEmptyAtDrawPosition(player, player.reservations.length);
  let drawing = false;
  for (const q of player.queue) if (q.kind === "draw") { drawing = true; break; }
  // Stay clickable while a draw is already casting: the new draw goes onto
  // the reservation list and fires after the current draw drains.
  const enabled = emptyCount > 0;
  const costSen = emptyCount * DRAW_SEN_PER_CARD;
  // Draw is the DEFAULT forced reservation — shown only when the manual
  // reservation list is empty. Right-clicking the Draw button (or pressing
  // Space) clears the manual list.
  const isReservation = player.reservations.length === 0 && emptyCount > 0;

  const onClick = () => {
    if (!enabled) return;
    getSession()?.pushLocalInput(INPUT_DRAW);
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    getSession()?.pushLocalInput(INPUT_RESERVE_DRAW);
  };

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      disabled={!enabled}
      style={{
        ...drawButtonStyle,
        width: HAND_ROW_WIDTH,
        // Clickability drives the look — a draw being mid-cast does NOT
        // disable the button (another draw can still be reserved), so it
        // must not LOOK disabled while enabled.
        background: enabled ? "linear-gradient(180deg, #2c5b8e 0%, #1a3d6e 100%)" : "#1a1a22",
        color: enabled ? "#fff" : "#666",
        cursor: enabled ? "pointer" : "not-allowed",
        borderColor: isReservation ? "#ffe066" : enabled ? "#3a7fbf" : "#2a2a35",
        outline: isReservation ? "2px solid #ffe066" : "none",
        outlineOffset: -2,
      }}
      title={enabled ? `${emptyCount}枚 / ${costSen}閃` : "空きなし"}
    >
      {isReservation && (
        <span style={{
          background: "#ffe066", color: "#1a1a22", padding: "1px 6px",
          borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 1, marginRight: 8,
        }}>予約中</span>
      )}
      <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>⇊ ドロー (D)</span>
      <span style={{ fontSize: 12, opacity: 0.85, marginLeft: 12, fontFamily: "ui-monospace, monospace" }}>
        {drawing
          ? (enabled ? `実行中 · さらに予約 ${emptyCount}枚 (${costSen}閃)` : "実行中")
          : enabled ? `${emptyCount}枚 (合計 ${costSen}閃)` : "(空きなし)"}
      </span>
    </button>
  );
}

// Beginner-mode "次の閃" button. Only renders when the active session is
// an OfflineSession with beginnerMode = true. Each click advances the sim
// by exactly 1 閃 (= SEC_PER_SEN seconds = SEC_PER_SEN/DT frames).
//
// Source of truth is the SESSION's option, not the title-screen checkbox
// in the store — puzzle mode creates beginner sessions directly without
// touching the checkbox, and the two must not disagree.
function AdvanceButton() {
  useStore((s) => s.gameFrame); // re-check when a session starts ticking
  const sess = getSession();
  const beginner = sess instanceof OfflineSession && !!sess.opts.beginnerMode;
  if (!beginner || getActiveMode() !== "offline") return null;
  const onClick = () => {
    advanceFrames(Math.round(SEC_PER_SEN / DT));
  };
  const onClickHalf = () => {
    advanceFrames(Math.round((SEC_PER_SEN / 2) / DT));
  };
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 4 }}>
      <button onClick={onClickHalf} style={advanceBtnStyle}>+0.5 閃</button>
      <button onClick={onClick} style={{ ...advanceBtnStyle, background: "#3a6c3a", borderColor: "#5a9c5a" }}>
        次の閃 (+1 閃)
      </button>
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
        {" · "}キャスト {def.cost >= 900 ? "不可" : def.cost + "閃"}
        {(def.prereqQueueTime ?? 0) > 0 && ` · 要${def.prereqQueueTime}閃`}
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
        background: "#22222a", border: `1px solid ${color}33`, minWidth: 50,
        cursor: onClick ? "pointer" : "default", color: "inherit",
      }}
      title={onClick ? "クリックで中身を見る" : undefined}
    >
      <div style={{ color, fontSize: 10, opacity: 0.7 }}>{label}</div>
      <div style={{ color, fontSize: 16, fontWeight: 600 }}>{n}</div>
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
    case "Poison": return `相手に毒${e.amount}`;
    case "Counter": return `発動中、被ダメージの2倍を反射`;
    case "Combo": return e.effects.map(effectText).join(" + ");
  }
}

// Card face: layered gradient per type — a lit top edge, a deep diagonal
// body, and a darker base so the frame reads as物. Inactive = desaturated.
function typeColor(t: CardType, active: boolean): string {
  const sheen = "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 26%, rgba(0,0,0,0) 45%)";
  if (!active) {
    const flat: Record<number, string> = {
      [CardType.Attack]: "linear-gradient(160deg, #4a2326 0%, #321a1e 60%, #241318 100%)",
      [CardType.Skill]:  "linear-gradient(160deg, #1f3450 0%, #182638 60%, #121c2a 100%)",
      [CardType.Power]:  "linear-gradient(160deg, #3a2450 0%, #2a1a3c 60%, #1e1430 100%)",
      [CardType.Status]: "linear-gradient(160deg, #333 0%, #222 100%)",
    };
    return `${sheen}, ${flat[t]}`;
  }
  const body: Record<number, string> = {
    [CardType.Attack]: "linear-gradient(160deg, #d8403c 0%, #a02430 46%, #5e1622 100%)",
    [CardType.Skill]:  "linear-gradient(160deg, #3d83d8 0%, #2456a0 46%, #16335e 100%)",
    [CardType.Power]:  "linear-gradient(160deg, #a050d8 0%, #6e2ea0 46%, #401a5e 100%)",
    [CardType.Status]: "linear-gradient(160deg, #555 0%, #3a3a3a 100%)",
  };
  return `${sheen}, ${body[t]}`;
}

// Card frame edge color per type (the thin lit border).
function typeEdge(t: CardType, active: boolean): string {
  if (!active) return "rgba(255,255,255,0.08)";
  switch (t) {
    case CardType.Attack: return "rgba(255,140,120,0.55)";
    case CardType.Skill:  return "rgba(120,180,255,0.55)";
    case CardType.Power:  return "rgba(200,140,255,0.55)";
    case CardType.Status: return "rgba(255,255,255,0.15)";
  }
}

// ── styles ──

const page: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
  padding: 14, gap: 10,
  // 深い藍黒の場 + 上方からの閃光の名残 (静的レイヤーのみ — 再描画コスト0)
  background: [
    "radial-gradient(1200px 500px at 50% -10%, rgba(120, 90, 220, 0.10), rgba(0,0,0,0) 60%)",
    "radial-gradient(900px 400px at 85% 110%, rgba(40, 120, 200, 0.07), rgba(0,0,0,0) 60%)",
    "radial-gradient(700px 380px at 12% 105%, rgba(200, 150, 60, 0.05), rgba(0,0,0,0) 60%)",
    "linear-gradient(180deg, #131320 0%, #0b0b13 55%, #08080e 100%)",
  ].join(", "),
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const topBar: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "#aaa", border: "1px solid #333", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 };

const mainRow: React.CSSProperties = {
  display: "flex", gap: 12, flex: 1, minHeight: 0, alignItems: "flex-start",
};
const infoColumn: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 8,
  width: 260, flexShrink: 0,
};
const infoCard: React.CSSProperties = {
  padding: 10, background: "#181822", border: "1px solid #2a2a35", borderRadius: 10,
  display: "flex", flexDirection: "column", gap: 6,
};
const infoCardTitle: React.CSSProperties = {
  fontSize: 12, opacity: 0.75, letterSpacing: 1.5, fontWeight: 600, marginBottom: 2,
};
const rightStack: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0,
};

const pillRow: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4 };
const pileStack: React.CSSProperties = { display: "flex", gap: 6, marginTop: 4 };
const barTrack: React.CSSProperties = { background: "#0c0c12", border: "1px solid #2a2a35", borderRadius: 4, overflow: "hidden" };
const pill = (color: string): React.CSSProperties => ({ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: `${color}22`, color, fontSize: 11, border: `1px solid ${color}55` });

const oppHandRow: React.CSSProperties = {
  display: "flex", gap: BACK_GAP, height: BACK_H + 4, alignItems: "center",
  marginLeft: "auto", marginRight: "auto",
};
const cardBack: React.CSSProperties = {
  width: BACK_W, height: BACK_H, borderRadius: 6,
  background: "linear-gradient(135deg, #2a2438 0%, #15101e 100%)",
  border: "1px solid #4a3d6a",
  display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "inset 0 0 8px rgba(160, 110, 255, 0.15), 0 2px 6px rgba(0,0,0,0.4)",
  flexShrink: 0,
};
const cardBackSigil: React.CSSProperties = { color: "#7a5db8", opacity: 0.55, fontSize: 22 };
const emptyBack: React.CSSProperties = {
  width: BACK_W, height: BACK_H, borderRadius: 6,
  background: "rgba(20, 20, 28, 0.4)",
  border: "1px dashed rgba(122,93,184,0.18)",
  flexShrink: 0,
};
const pendingBack: React.CSSProperties = {
  position: "relative", overflow: "hidden",
  width: BACK_W, height: BACK_H, borderRadius: 6,
  background: "rgba(30, 24, 44, 0.55)",
  border: "1px dashed rgba(122,93,184,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};

const handRow: React.CSSProperties = {
  display: "flex", gap: CARD_GAP, height: CARD_H,
  marginLeft: "auto", marginRight: "auto",
};
const emptySlot: React.CSSProperties = {
  width: CARD_W, height: CARD_H, borderRadius: 8,
  background: "rgba(20, 20, 28, 0.4)",
  border: "1px dashed rgba(110, 110, 130, 0.25)",
  flexShrink: 0,
};
const pendingSlotFront: React.CSSProperties = {
  position: "relative", overflow: "hidden",
  width: CARD_W, height: CARD_H, borderRadius: 8,
  background: "rgba(20, 28, 40, 0.55)",
  border: "1px dashed rgba(95,160,224,0.55)",
  display: "flex", flexDirection: "column", justifyContent: "flex-end",
  alignItems: "center", padding: "6px 4px", color: "#bdd6f0",
  flexShrink: 0,
};
const pendingSlotLabel: React.CSSProperties = {
  fontSize: 10, opacity: 0.7, marginBottom: 2, zIndex: 1, position: "relative",
  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
};
const pendingSlotCountdown: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace",
  marginBottom: 4, zIndex: 1, position: "relative",
  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
};

const cardStyle: React.CSSProperties = {
  width: CARD_W, height: CARD_H, padding: 10, borderRadius: 11,
  display: "flex", flexDirection: "column", justifyContent: "space-between", color: "white",
  position: "relative", textAlign: "left", flexShrink: 0,
  overflow: "hidden",
};
// 閃コストの宝玉 — 金のラジアルグラデーションの円形バッジ。
const cardCostStyle: React.CSSProperties = {
  position: "absolute", top: 6, left: 6,
  minWidth: 30, height: 30, padding: "0 6px",
  display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 999,
  background: "radial-gradient(circle at 32% 28%, #fff3c0 0%, #ffd84d 38%, #b8860b 100%)",
  color: "#241a00", fontSize: 14, fontWeight: 800,
  border: "1px solid rgba(255,235,160,0.9)",
  boxShadow: "0 2px 6px rgba(0,0,0,0.55), inset 0 -2px 3px rgba(120,80,0,0.45)",
  textShadow: "none", zIndex: 2,
};
const typeBadge: React.CSSProperties = {
  position: "absolute", top: 9, right: 8, fontSize: 10, fontWeight: 700, letterSpacing: 1,
  background: "rgba(0,0,0,0.5)", padding: "2px 7px", borderRadius: 999, zIndex: 2,
  border: "1px solid rgba(255,255,255,0.16)",
};
const cardHeader: React.CSSProperties = {
  fontWeight: 700, fontSize: 14, marginTop: 34, letterSpacing: 1,
  textShadow: "0 1px 3px rgba(0,0,0,0.9)", zIndex: 2,
  borderBottom: "1px solid rgba(255,255,255,0.18)", paddingBottom: 4,
};
const cardEffect: React.CSSProperties = { fontSize: 11, opacity: 0.95, lineHeight: 1.3, marginTop: 4, zIndex: 2 };
const cardKeyHint: React.CSSProperties = { position: "absolute", bottom: 6, right: 8, fontSize: 11, opacity: 0.6, fontFamily: "ui-monospace, monospace", zIndex: 2 };

const drawButtonStyle: React.CSSProperties = {
  marginLeft: "auto", marginRight: "auto",
  height: 44, borderRadius: 8, border: "1px solid #3a7fbf",
  display: "flex", alignItems: "center", justifyContent: "center",
  gap: 8, fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const controlsHint: React.CSSProperties = {
  textAlign: "center", fontSize: 11, opacity: 0.45, marginTop: 2,
  letterSpacing: 0.5,
};
const advanceBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  background: "#2a4a2a", color: "white",
  border: "1px solid #4a7c4a",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const tooltipBox: React.CSSProperties = {
  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
  marginBottom: 8, padding: "10px 12px", background: "rgba(20, 20, 28, 0.97)",
  border: "1px solid #444", borderRadius: 8, minWidth: 220, maxWidth: 300,
  boxShadow: "0 4px 16px rgba(0,0,0,0.6)", zIndex: 50, pointerEvents: "none",
};
const tooltipTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14, marginBottom: 4 };
const tooltipMeta: React.CSSProperties = { fontSize: 11, opacity: 0.65, marginTop: 4 };
const tooltipBody: React.CSSProperties = { fontSize: 12, opacity: 0.95, lineHeight: 1.4 };
