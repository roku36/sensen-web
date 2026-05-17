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

import { useEffect, useRef, useState } from "react";
import { CardEffect, CardType, getCardDef } from "../../sim/cards";
import { cardFlag } from "../../sim/input";
import { queueRemainingTime } from "../../sim/reducer";
import { DT, MAX_HAND_SIZE } from "../../sim/rules";
import { PlayerState, ResolvedEntry } from "../../sim/state";

// Queue rendering scale: 35 px per second of cast time so a cost-3 chip is
// 105 px, cost-6 is 210 px — the visual proportion to commitment is direct.
const PX_PER_SEC = 35;
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
      <OpponentHand player={op} now={now} />

      <BattleZone op={op} me={me} now={now} />

      <SelfHand player={me} now={now} />
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

// ── Battle zone: unified shared-time timeline ──
//
// Single scrollable container. Time runs LEFT → RIGHT. Vertical NOW line
// (gold) at x = NOW_OFFSET. Opponent's queue boxes pinned to the TOP half;
// my queue boxes pinned to the BOTTOM half. Same X axis → vertically
// aligned column = simultaneous resolution. The whole thing scrolls
// horizontally (mouse wheel or trackpad) — both rows move together because
// they live in the same scroll viewport.

// Minimum future-side window. Set generously so the inner container is
// usually wider than the viewport — that guarantees the wheel→horizontal
// pan has something to scroll. The right side of the timeline becomes a
// "look-ahead" lane the player can pan into.
const MIN_TIMELINE_SEC = 30;
// Visible "past" budget left of the NOW line, in seconds. Resolved chips
// older than this aren't rendered (they'd be off-screen anyway). The inner
// container is wide enough to fit this much past plus the queue future, and
// the NOW line sits at a fixed inner X = HISTORY_SEC * PX_PER_SEC + EDGE_PAD.
const HISTORY_SEC = 14;
const EDGE_PAD = 20;
const NOW_OFFSET = HISTORY_SEC * PX_PER_SEC + EDGE_PAD; // ≈ 510 px
const ROW_HEIGHT = 60;          // each player's track height
const CENTER_GUTTER = 30;       // gap between top and bottom tracks
const BOX_HEIGHT = 46;
// On first mount, scroll so NOW is ~80 px from the left edge of the
// viewport. Past extends left (in-view), future extends right.
const NOW_VIEWPORT_LEFT_PX = 80;

function BattleZone({ op, me, now }: { op: PlayerState; me: PlayerState; now: number }) {
  // Future = queue; Past = resolved history (positioned with NEGATIVE startRel
  // so they live to the left of the NOW line).
  const opQueue = computeQueueBoxes(op, now);
  const meQueue = computeQueueBoxes(me, now);
  const opHist = computeHistoryBoxes(op.resolvedCards, now);
  const meHist = computeHistoryBoxes(me.resolvedCards, now);

  const maxSec = Math.max(
    MIN_TIMELINE_SEC,
    Math.ceil((opQueue[opQueue.length - 1]?.endRel ?? 0) + 2),
    Math.ceil((meQueue[meQueue.length - 1]?.endRel ?? 0) + 2),
  );
  const innerWidth = NOW_OFFSET + maxSec * PX_PER_SEC + EDGE_PAD;
  const totalHeight = ROW_HEIGHT * 2 + CENTER_GUTTER;

  // Non-passive wheel listener so we can preventDefault and pan horizontally
  // even on touchpads (React's synthetic onWheel attaches passively by
  // default and silently drops scrollLeft updates in some Chrome versions).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Convert any wheel input (vertical OR horizontal) to horizontal pan.
      // Inverted so wheel-up (negative deltaY) pans toward the FUTURE
      // (right), wheel-down pans toward the PAST (left) — matches "drag
      // the timeline with the wheel" intuition.
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
      e.preventDefault();
      el.scrollLeft -= raw;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // Anchor NOW near viewport's left edge on first paint. We only do this
  // once so user scrolling isn't yanked back every frame.
  const didAnchor = useRef(false);
  useEffect(() => {
    if (didAnchor.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, NOW_OFFSET - NOW_VIEWPORT_LEFT_PX);
    didAnchor.current = true;
  }, []);

  return (
    <div style={battleZone}>
      <div style={timelineMetaRow}>
        <PlayerMeta player={op} label="相手" boxes={opQueue} />
        <PlayerMeta player={me} label="自分" boxes={meQueue} />
      </div>
      <div style={scrollWrap} className="no-scrollbar" ref={scrollRef}>
        <div style={{ ...timelineInner, width: innerWidth, height: totalHeight }}>
          {/* Past time grid (negative ticks). */}
          {Array.from({ length: HISTORY_SEC + 1 }).map((_, s) => (
            <TimeTick key={`p${s}`} sec={-s} totalHeight={totalHeight} />
          ))}
          {/* Future time grid (positive ticks). */}
          {Array.from({ length: maxSec + 1 }).map((_, s) => (
            <TimeTick key={`f${s}`} sec={s} totalHeight={totalHeight} />
          ))}
          {/* Center divider that visually unifies the two tracks. */}
          <div style={{ ...centerDivider, top: ROW_HEIGHT }} />
          <div style={{ ...nowDivider, left: NOW_OFFSET - 18, top: ROW_HEIGHT + CENTER_GUTTER / 2 - 8 }}>NOW</div>
          {/* NOW vertical line spans both tracks. */}
          <div style={{ ...nowLine, left: NOW_OFFSET, height: totalHeight }} />
          {/* Opponent history (top half, left of NOW, dimmed). */}
          {opHist.map((b, i) => (
            <QueueBox key={`oh${i}`} {...b} yTop={(ROW_HEIGHT - BOX_HEIGHT) / 2} />
          ))}
          {/* Opponent queue (top half, right of NOW). */}
          {opQueue.map((b, i) => (
            <QueueBox key={`o${i}`} {...b} yTop={(ROW_HEIGHT - BOX_HEIGHT) / 2} />
          ))}
          {/* Self history (bottom half, left of NOW, dimmed). */}
          {meHist.map((b, i) => (
            <QueueBox key={`mh${i}`} {...b} yTop={ROW_HEIGHT + CENTER_GUTTER + (ROW_HEIGHT - BOX_HEIGHT) / 2} />
          ))}
          {/* Self queue (bottom half, right of NOW). */}
          {meQueue.map((b, i) => (
            <QueueBox key={`m${i}`} {...b} yTop={ROW_HEIGHT + CENTER_GUTTER + (ROW_HEIGHT - BOX_HEIGHT) / 2} />
          ))}
          {/* Idle hints. */}
          {opQueue.length === 0 && <span style={{ ...idleHint, top: ROW_HEIGHT / 2 - 7 }}>相手キュー空</span>}
          {meQueue.length === 0 && <span style={{ ...idleHint, top: ROW_HEIGHT + CENTER_GUTTER + ROW_HEIGHT / 2 - 7 }}>自分キュー空</span>}
        </div>
      </div>
    </div>
  );
}

interface BoxLayout {
  cardId: number;
  duration: number;
  startRel: number;
  endRel: number;
  isHead: boolean;
  resolved?: boolean;
}

function computeQueueBoxes(player: PlayerState, now: number): BoxLayout[] {
  if (player.queue.length === 0) return [];
  let endRel = Math.max(0, player.queue[0].duration - (now - player.castStartedAt));
  return player.queue.map((q, i) => {
    if (i > 0) endRel += q.duration;
    return {
      cardId: q.cardId,
      duration: q.duration,
      endRel,
      startRel: endRel - q.duration,
      isHead: i === 0,
    };
  });
}

function computeHistoryBoxes(resolved: ResolvedEntry[], now: number): BoxLayout[] {
  const out: BoxLayout[] = [];
  for (const r of resolved) {
    const endRel = r.resolvedAt - now;           // ≤ 0
    const startRel = endRel - r.duration;        // < endRel
    if (endRel < -HISTORY_SEC) continue;         // off-screen left, skip
    out.push({
      cardId: r.cardId,
      duration: r.duration,
      startRel, endRel,
      isHead: false,
      resolved: true,
    });
  }
  return out;
}

function PlayerMeta({ player, label, boxes }: { player: PlayerState; label: string; boxes: BoxLayout[] }) {
  const totalSec = boxes[boxes.length - 1]?.endRel ?? 0;
  return (
    <div style={timelineHeader}>
      <span style={timelineLabel}>{label}</span>
      <BlockBadge value={player.block} />
      {boxes.length > 0 && (
        <span style={timelineSub}>
          {boxes.length}枚 · 合計 {totalSec.toFixed(1)}秒
        </span>
      )}
    </div>
  );
}

function TimeTick({ sec, totalHeight }: { sec: number; totalHeight: number }) {
  const x = NOW_OFFSET + sec * PX_PER_SEC;
  if (x < 0) return null;
  const isMajor = sec % 5 === 0;
  const isPast = sec < 0;
  return (
    <>
      <div style={{
        position: "absolute", left: x, top: 0, height: totalHeight, width: 1,
        background: isMajor
          ? (isPast ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)")
          : (isPast ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)"),
      }} />
      {sec !== 0 && (
        <div style={{
          position: "absolute", left: x + 2, top: totalHeight / 2 - 6,
          fontSize: 9,
          color: isPast ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.4)",
          fontFamily: "ui-monospace, monospace",
          pointerEvents: "none",
        }}>{sec > 0 ? `${sec}s` : `${sec}s`}</div>
      )}
    </>
  );
}

function QueueBox({ cardId, duration, startRel, endRel, isHead, yTop, resolved }: BoxLayout & { yTop: number }) {
  const def = getCardDef(cardId);
  const baseColor = def?.cardType === CardType.Attack ? "#e3553c"
    : def?.cardType === CardType.Power ? "#b465e0"
    : "#5fa0e0";
  // Resolved cards fade in saturation/opacity — same hue so eyes can track
  // identity, but they're clearly "in the past".
  const color = resolved ? dim(baseColor, 0.45) : baseColor;
  const left = NOW_OFFSET + startRel * PX_PER_SEC;
  const w = duration * PX_PER_SEC;
  const glow = !resolved && isHead && endRel < 0.4;
  const glowIntensity = glow ? 1 - endRel / 0.4 : 0;
  return (
    <div
      style={{
        position: "absolute",
        left, width: w, height: BOX_HEIGHT,
        top: yTop,
        background: color,
        border: `2px solid ${glow ? "#fff" : color}`,
        boxSizing: "border-box",       // prevents overlap between adjacent boxes
        boxShadow: glow
          ? `0 0 ${10 + 20 * glowIntensity}px rgba(255,255,200,${0.4 + 0.5 * glowIntensity})`
          : resolved ? "none" : "0 2px 6px rgba(0,0,0,0.4)",
        borderRadius: 6,
        padding: "3px 8px",
        color: resolved ? "rgba(255,255,255,0.55)" : "white",
        overflow: "hidden",
        opacity: resolved ? 0.55 : (isHead ? 1 : 0.85),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-end",
        textAlign: "right",
      }}
    >
      <div style={queueBoxName}>{def?.name ?? "??"}</div>
      <div style={queueBoxMeta}>
        {resolved ? "発動済" : isHead ? `あと ${Math.max(0, endRel).toFixed(1)}s` : `${duration}s`}
      </div>
    </div>
  );
}

// Mix a hex color with black by factor 0..1 (0 = black, 1 = original).
function dim(hex: string, k: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = Math.round(parseInt(m[1], 16) * k);
  const g = Math.round(parseInt(m[2], 16) * k);
  const b = Math.round(parseInt(m[3], 16) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

function BlockBadge({ value }: { value: number }) {
  if (value <= 0) return null;
  return <span style={blockBadge}>🛡 {Math.round(value)}</span>;
}

// ── Opponent hand: face-down backs + same draw-timer slot as self ──

function OpponentHand({ player, now }: { player: PlayerState; now: number }) {
  const drawIn = Math.max(0, player.nextDrawAt - now);
  const showSlot = player.hand.length < MAX_HAND_SIZE;
  return (
    <div style={oppHandRow}>
      {player.hand.map((_, i) => (
        <div key={i} style={cardBack}><div style={cardBackSigil}>✦</div></div>
      ))}
      {showSlot && <NextCardSlot drawIn={drawIn} totalDelay={player.drawTimerTotal} backFacing />}
      {player.hand.length === 0 && !showSlot && <div style={{ fontSize: 11, opacity: 0.4 }}>(相手の手札なし)</div>}
    </div>
  );
}

// ── Self hand: 6-slot row with a face-down countdown slot for next draw ──

function SelfHand({ player, now }: { player: PlayerState; now: number }) {
  const drawIn = Math.max(0, player.nextDrawAt - now);
  const showSlot = player.hand.length < MAX_HAND_SIZE;
  return (
    <div style={handRow}>
      {player.hand.map((cardId, i) => (
        <SimpleCard key={i} cardId={cardId} idx={i} player={player} now={now} />
      ))}
      {showSlot && <NextCardSlot drawIn={drawIn} totalDelay={player.drawTimerTotal} />}
    </div>
  );
}

// Empty slot showing a countdown until the next card is drawn. When drawIn
// hits 0, the sim will replace this slot with a real card on the next frame.
function NextCardSlot({ drawIn, totalDelay, backFacing = false }: { drawIn: number; totalDelay: number; backFacing?: boolean }) {
  const fillPct = totalDelay > 0 ? 1 - drawIn / totalDelay : 1;
  return (
    <div style={backFacing ? nextSlotBack : nextSlotFront}>
      {/* Water-fill from the bottom representing time-to-draw. */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        height: `${Math.max(0, Math.min(100, fillPct * 100))}%`,
        background: backFacing
          ? "linear-gradient(180deg, rgba(122,93,184,0.35) 0%, rgba(122,93,184,0.55) 100%)"
          : "linear-gradient(180deg, rgba(95,160,224,0.30) 0%, rgba(95,160,224,0.55) 100%)",
        transition: "height 80ms linear",
        pointerEvents: "none",
      }} />
      <div style={nextSlotLabel}>次の札</div>
      <div style={nextSlotCountdown}>{drawIn.toFixed(1)}s</div>
    </div>
  );
}

function SimpleCard({ cardId, idx, player, now }: { cardId: number; idx: number; player: PlayerState; now: number }) {
  const def = getCardDef(cardId);
  const [hover, setHover] = useState(false);
  if (!def) return null;
  const unplayable = def.cost >= 900;
  // Prereq gate: card requires this much already-queued time before it can
  // be added. Show it greyed out (but still clickable to read the tooltip)
  // until the queue has enough committed time.
  const queued = queueRemainingTime(player, now);
  const prereq = def.prereqQueueTime ?? 0;
  const prereqOk = prereq <= queued;
  const clickable = !unplayable && prereqOk;

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
          {unplayable ? "✗" : def.cost + "s"}
          {prereq > 0 && (
            <span style={{ fontSize: 10, marginLeft: 4, color: prereqOk ? "#80ffa0" : "#ff9a40" }}>
              要{prereq}s
            </span>
          )}
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

// Empty hand slot waiting for the next draw. Matches the card silhouette so
// the row visually keeps its 6-slot shape; a water-fill animates from the
// bottom up as the timer counts down.
const nextSlotFront: React.CSSProperties = {
  position: "relative", overflow: "hidden",
  width: 130, height: 180, borderRadius: 8,
  background: "rgba(20, 28, 40, 0.55)",
  border: "1px dashed rgba(95,160,224,0.45)",
  display: "flex", flexDirection: "column", justifyContent: "flex-end",
  alignItems: "center", padding: "6px 4px", color: "#bdd6f0",
  flexShrink: 0,
};
const nextSlotBack: React.CSSProperties = {
  position: "relative", overflow: "hidden",
  width: 50, height: 70, borderRadius: 6,
  background: "rgba(30, 24, 44, 0.6)",
  border: "1px dashed rgba(122,93,184,0.45)",
  display: "flex", flexDirection: "column", justifyContent: "flex-end",
  alignItems: "center", padding: "4px 2px", color: "#a899ff",
  flexShrink: 0,
};
const nextSlotLabel: React.CSSProperties = {
  fontSize: 10, opacity: 0.7, marginBottom: 2, zIndex: 1, position: "relative",
  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
};
const nextSlotCountdown: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace",
  marginBottom: 4, zIndex: 1, position: "relative",
  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
};

const battleZone: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px",
  background: "rgba(40, 30, 60, 0.25)",
  border: "1px solid rgba(110, 80, 170, 0.35)",
  borderRadius: 10,
};
const timelineMetaRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: 12,
  padding: "0 4px",
};
const timelineHeader: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "2px 4px",
  fontSize: 11, opacity: 0.85,
};
const timelineLabel: React.CSSProperties = { fontWeight: 700, letterSpacing: 1 };
const timelineSub: React.CSSProperties = { fontSize: 10, opacity: 0.55, fontFamily: "ui-monospace, monospace" };
// Scrollable viewport: clips the inner timeline and allows horizontal scroll.
// The inner div is sized to fit the longest queue, and the wheel handler
// translates vertical wheel deltas into horizontal scroll so trackpad users
// don't need shift-wheel.
const scrollWrap: React.CSSProperties = {
  position: "relative", width: "100%",
  overflowX: "auto", overflowY: "hidden",
  background: "rgba(0,0,0,0.30)",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.05)",
};
const timelineInner: React.CSSProperties = {
  position: "relative",
  // height + width are set inline based on max queue size
};
const centerDivider: React.CSSProperties = {
  position: "absolute", left: 0, right: 0, height: CENTER_GUTTER,
  background: "linear-gradient(180deg, rgba(255,224,102,0) 0%, rgba(255,224,102,0.12) 50%, rgba(255,224,102,0) 100%)",
  pointerEvents: "none",
};
const nowDivider: React.CSSProperties = {
  position: "absolute", left: NOW_OFFSET - 22, width: 36,
  height: 16, lineHeight: "16px",
  fontSize: 9, color: "#1a1a22", letterSpacing: 2, fontWeight: 700,
  fontFamily: "ui-monospace, monospace", textAlign: "center",
  background: "#ffe066", borderRadius: 4,
  pointerEvents: "none", zIndex: 3,
  boxShadow: "0 0 6px rgba(255,224,102,0.55)",
};
const nowLine: React.CSSProperties = {
  position: "absolute", top: 0, width: 2,
  background: "linear-gradient(180deg, #fff 0%, #ffe066 50%, #fff 100%)",
  boxShadow: "0 0 8px rgba(255,224,102,0.6)",
  zIndex: 2,
};
const idleHint: React.CSSProperties = {
  position: "absolute", left: NOW_OFFSET + 8,
  fontSize: 11, opacity: 0.4, fontStyle: "italic",
};
const queueBoxName: React.CSSProperties = { fontWeight: 700, fontSize: 12, lineHeight: 1.1, textShadow: "0 1px 2px rgba(0,0,0,0.8)" };
const queueBoxMeta: React.CSSProperties = { fontSize: 10, opacity: 0.9, fontFamily: "ui-monospace, monospace", marginTop: 2 };
const blockBadge: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "2px 8px", borderRadius: 999,
  background: "rgba(95,160,224,0.2)", color: "#bdd6f0",
  border: "1px solid rgba(95,160,224,0.5)",
  fontSize: 11, fontWeight: 600,
};

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
