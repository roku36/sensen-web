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
        <span style={{ fontSize: 16, fontFamily: MINCHO, fontWeight: 800, letterSpacing: 3, color: "rgba(232,228,218,0.85)" }}>
          {(() => {
            const sen = Math.floor(game.frame / FRAMES_PER_SEN);
            const sd = sen >= SUDDEN_DEATH_START_SEN;
            const dmg = sd ? 1 + Math.floor((sen - SUDDEN_DEATH_START_SEN) / SUDDEN_DEATH_RAMP_SEN) : 0;
            return (
              <>
                <span style={sd ? { color: SHU } : undefined}>第{sen}閃</span>
                {sd && <span style={{ color: SHU, marginLeft: 10, fontSize: 12 }}>焦土 −{dmg}HP/閃</span>}
                {!sd && sen >= SUDDEN_DEATH_START_SEN - 5 && (
                  <span style={{ color: SHU, opacity: 0.7, marginLeft: 10, fontSize: 12 }}>焦土まで {SUDDEN_DEATH_START_SEN - sen}閃</span>
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
            左クリック: 予約（もう一度で取消） · 右クリック: そのカード以降を取消 · Space: 全取消 · D: 1枚ドロー · 1〜6: カード選択
            　|　無操作 = 1枚ドロー（満杯なら休息 · HP+1）
          </div>
          <div style={controlsHint}>
            連閃: カードを連続発動するたび攻撃+1（最大+5）· ドローで−1 · 休息で全リセット
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
          <span style={pill("#e8e4da")}>
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
          return <div key={i} style={cardBack}><div style={cardBackSigil}>閃</div></div>;
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
        background: "rgba(51, 82, 110, 0.55)", // 藍鉄 flat
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
        background: "rgba(51, 82, 110, 0.55)", // 藍鉄 flat
        // No transition: height is recomputed every frame already; a CSS
        // transition on top of that just lags behind and stutters.
        pointerEvents: "none",
      }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(232,228,218,0.85)", textShadow: "0 1px 2px black", zIndex: 1 }}>
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
        className="hand-card"
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={!clickable}
        style={{
          ...cardStyle,
          background: typeColor(def.cardType, clickable),
          cursor: clickable ? "pointer" : "not-allowed",
          // 予約 = 朱の縁。それ以外は紙の hairline。影は使わない。
          border: reserved
            ? `2px solid ${SHU}`
            : `1px solid ${typeEdge(def.cardType, clickable)}`,
          outline: def.exhausts && !reserved ? "1px dashed rgba(232,228,218,0.25)" : "none",
          outlineOffset: 2,
          opacity: clickable ? 1 : 0.5,
        }}
      >
        {!clickable && (
          <div aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", pointerEvents: "none" }} />
        )}
        {reserved && (
          <div aria-hidden style={{
            position: "absolute", top: -9, left: "50%", transform: "translateX(-50%)",
            background: SHU, color: KAMI,
            padding: "1px 8px",
            fontSize: 11, fontWeight: 800, letterSpacing: 1, zIndex: 3,
            fontFamily: MINCHO,
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
        <div style={{ ...cardCostStyle, opacity: clickable ? 1 : 0.45 }}>
          {unplayable ? "✗" : def.cost}<span style={{ fontSize: 9, fontWeight: 800, marginLeft: 1 }}>閃</span>
        </div>
        {(def.prereqQueueTime ?? 0) > 0 && (
          <div style={{
            position: "absolute", top: 36, left: 0, zIndex: 2,
            fontSize: 9, fontWeight: 700, padding: "1px 6px", letterSpacing: 1,
            // 充足 = 静かな紙。未満 = 朱 (まだ刃が届かない)。
            background: prereqOk ? "rgba(232,228,218,0.14)" : SHU,
            color: prereqOk ? "rgba(232,228,218,0.8)" : KAMI,
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
  // 1枚ドロー: 新しいドローが発火する時点でスロットが確保できるか
  // (先行予約のスロット解放・先行ドローの1枠消費を織り込む)。
  const emptyCount = futureEmptyAtDrawPosition(player, player.reservations.length);
  let drawing = false;
  for (const q of player.queue) if (q.kind === "draw") { drawing = true; break; }
  // Stay clickable while a draw is already casting: the new draw goes onto
  // the reservation list and fires after the current draw drains.
  const enabled = emptyCount > 0;
  const reservedDraws = player.reservations.filter((r) => r.kind === "draw").length;
  const isReservation = reservedDraws > 0;

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
        background: enabled ? "#33526e" : "#17171a",
        color: enabled ? KAMI : "rgba(232,228,218,0.35)",
        cursor: enabled ? "pointer" : "not-allowed",
        borderColor: isReservation ? SHU : enabled ? "rgba(232,228,218,0.22)" : "rgba(232,228,218,0.08)",
        outline: "none",
      }}
      title={enabled ? "1枚ドロー · 1閃 (連打で続けて予約)" : "空きなし"}
    >
      {isReservation && (
        <span style={{
          background: SHU, color: KAMI, padding: "1px 8px",
          fontSize: 10, fontWeight: 800, letterSpacing: 1, marginRight: 8, fontFamily: MINCHO,
        }}>予約 ×{reservedDraws}</span>
      )}
      <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>⇊ 1枚ドロー (D)</span>
      <span style={{ fontSize: 12, opacity: 0.85, marginLeft: 12, fontFamily: "ui-monospace, monospace" }}>
        {drawing
          ? (enabled ? "実行中 · 連打で続けて引く" : "実行中")
          : enabled ? `1閃 · 空き${emptyCount}枠` : "(空きなし)"}
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
      <button onClick={onClick} style={{ ...advanceBtnStyle, background: SHU, borderColor: SHU, fontFamily: MINCHO, fontWeight: 800 }}>
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

// 機能色 — flat 塗り。テーマ色ではなくゲームプレイ上の識別
// (docs/design-language.md: 攻撃=弁柄 / 技=藍鉄 / パワー=紫紺)。
function typeColor(t: CardType, active: boolean): string {
  const on: Record<number, string> = {
    [CardType.Attack]: "#8e3a30",
    [CardType.Skill]:  "#33526e",
    [CardType.Power]:  "#544668",
    [CardType.Status]: "#3a3a3e",
  };
  const off: Record<number, string> = {
    [CardType.Attack]: "#46241f",
    [CardType.Skill]:  "#1f2e3c",
    [CardType.Power]:  "#2e2738",
    [CardType.Status]: "#28282c",
  };
  return (active ? on : off)[t];
}

// 縁は紙の hairline。タイプで変えない (色の氾濫を防ぐ)。
function typeEdge(_t: CardType, active: boolean): string {
  return active ? "rgba(232,228,218,0.22)" : "rgba(232,228,218,0.08)";
}

// ── styles ──

const MINCHO = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
const SHU = "#e8472b";
const KAMI = "#e8e4da";

const page: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
  padding: 14, gap: 10,
  background: "#0f0f11", // 墨。装飾しない
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
  padding: 10, background: "#17171a", border: "1px solid rgba(232,228,218,0.10)", borderRadius: 2,
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
  width: BACK_W, height: BACK_H, borderRadius: 2,
  background: "#1c1c20",
  border: "1px solid rgba(232,228,218,0.16)",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};
const cardBackSigil: React.CSSProperties = {
  color: "rgba(232,228,218,0.30)", fontSize: 18,
  fontFamily: MINCHO, fontWeight: 800,
};
const emptyBack: React.CSSProperties = {
  width: BACK_W, height: BACK_H, borderRadius: 2,
  background: "rgba(232,228,218,0.02)",
  border: "1px dashed rgba(232,228,218,0.10)",
  flexShrink: 0,
};
const pendingBack: React.CSSProperties = {
  position: "relative", overflow: "hidden",
  width: BACK_W, height: BACK_H, borderRadius: 2,
  background: "#17171a",
  border: "1px dashed rgba(232,228,218,0.30)",
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
  border: "1px dashed rgba(232,228,218,0.30)",
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
  width: CARD_W, height: CARD_H, padding: 10, borderRadius: 2, // 刃 — 直角
  display: "flex", flexDirection: "column", justifyContent: "space-between", color: KAMI,
  position: "relative", textAlign: "left", flexShrink: 0,
  overflow: "hidden",
};
// 閃コスト札 — 紙地に墨文字、右下を45°で切り落とす (唯一のモチーフ:斜め切り)。
const cardCostStyle: React.CSSProperties = {
  position: "absolute", top: 0, left: 0,
  minWidth: 34, height: 30, padding: "0 8px 4px 6px",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: KAMI, color: "#16161a",
  fontSize: 16, fontWeight: 800, fontFamily: MINCHO,
  clipPath: "polygon(0 0, 100% 0, 100% 55%, 72% 100%, 0 100%)",
  zIndex: 2,
};
const typeBadge: React.CSSProperties = {
  position: "absolute", top: 8, right: 8, fontSize: 10, fontWeight: 700, letterSpacing: 2,
  color: "rgba(232,228,218,0.75)", zIndex: 2,
};
const cardHeader: React.CSSProperties = {
  fontWeight: 800, fontSize: 15, marginTop: 34, letterSpacing: 2,
  fontFamily: MINCHO, zIndex: 2,
  borderBottom: "1px solid rgba(232,228,218,0.22)", paddingBottom: 4,
};
const cardEffect: React.CSSProperties = { fontSize: 11, opacity: 0.95, lineHeight: 1.3, marginTop: 4, zIndex: 2 };
const cardKeyHint: React.CSSProperties = { position: "absolute", bottom: 6, right: 8, fontSize: 11, opacity: 0.6, fontFamily: "ui-monospace, monospace", zIndex: 2 };

const drawButtonStyle: React.CSSProperties = {
  marginLeft: "auto", marginRight: "auto",
  height: 44, borderRadius: 2, border: "1px solid",
  display: "flex", alignItems: "center", justifyContent: "center",
  gap: 8, fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const controlsHint: React.CSSProperties = {
  textAlign: "center", fontSize: 11, opacity: 0.45, marginTop: 2,
  letterSpacing: 0.5,
};
const advanceBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 2,
  background: "#222226", color: KAMI,
  border: "1px solid rgba(232,228,218,0.25)",
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
