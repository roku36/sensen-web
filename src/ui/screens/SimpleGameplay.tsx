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
import { CardEffect, CardId, CardType, getCardDef } from "../../sim/cards";
import {
  cardFlag, INPUT_DRAW, INPUT_RESERVE_DRAW, reserveCardFlag,
} from "../../sim/input";
import { queueRemainingTime, reservedSlotSet } from "../../sim/reducer";
import {
  DRAW_SEN_PER_CARD, DT, MAX_HAND_SIZE, SEC_PER_SEN, secToSen,
} from "../../sim/rules";
import { PlayerState, QueueEntry, ResolvedEntry } from "../../sim/state";

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

// ── Layout constants ──
const PX_PER_SEC = 35;
const CARD_W = 130;
const CARD_H = 180;
const CARD_GAP = 8;
const HAND_ROW_WIDTH = CARD_W * MAX_HAND_SIZE + CARD_GAP * (MAX_HAND_SIZE - 1);

const BACK_W = 50;
const BACK_H = 70;
const BACK_GAP = 4;
const OPP_HAND_WIDTH = BACK_W * MAX_HAND_SIZE + BACK_GAP * (MAX_HAND_SIZE - 1);

// Timeline geometry. The block band sits between the two queue rows.
// Opp block grows UPWARD from the center axis, self block grows DOWNWARD.
const HISTORY_SEC = 14;
const EDGE_PAD = 20;
const NOW_OFFSET = HISTORY_SEC * PX_PER_SEC + EDGE_PAD; // ≈ 510 px
const QUEUE_ROW = 56;
const BLOCK_BAND = 180;          // 90 px per side
const BLOCK_HALF = BLOCK_BAND / 2;
const BOX_HEIGHT = 44;
const MIN_TIMELINE_SEC = 30;
const NOW_VIEWPORT_LEFT_PX = 80;
const TIMELINE_HEIGHT = QUEUE_ROW * 2 + BLOCK_BAND;

// Y coordinates within the inner timeline div.
const OPP_QUEUE_Y_TOP = (QUEUE_ROW - BOX_HEIGHT) / 2;
const BLOCK_TOP = QUEUE_ROW;                    // upper edge of opp's block area
const BLOCK_CENTER = QUEUE_ROW + BLOCK_HALF;     // horizontal axis (block = 0)
const BLOCK_BOTTOM = QUEUE_ROW + BLOCK_BAND;     // lower edge of self's block area
const SELF_QUEUE_Y_TOP = QUEUE_ROW + BLOCK_BAND + (QUEUE_ROW - BOX_HEIGHT) / 2;

// Block height mapping: EXPONENTIAL-NARROWER. The first few block units
// take big visual chunks; high block values pack tightly so even 30+
// fits. Asymptote at BLOCK_HALF. blockHeight(0) = 0.
//
//   h(b) = BLOCK_HALF * (1 - exp(-b / BLOCK_SCALE_K))
//
// With BLOCK_SCALE_K = 6 the first block unit uses ~15% of BLOCK_HALF,
// block 10 reaches ~80%, block 30 essentially fills the half.
const BLOCK_SCALE_K = 6;
function blockHeight(b: number): number {
  if (b <= 0) return 0;
  return BLOCK_HALF * (1 - Math.exp(-b / BLOCK_SCALE_K));
}
// How much vertical space ONE block unit gets at the given current value
// (used to position pierce marks just outside the current block tip).
function blockUnitHeight(b: number): number {
  return blockHeight(b + 1) - blockHeight(b);
}

export function SimpleGameplay() {
  useKeyboardInput();
  const game = useStore((s) => s.game);
  useStore((s) => s.gameFrame);
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
  const opSide = (localPlayer ^ 1) as 0 | 1;
  const now = game.frame * DT;

  return (
    <div style={page}>
      <div style={topBar}>
        <button style={ghostBtn} onClick={() => setScreen("title")}>← タイトル</button>
        <span style={{ opacity: 0.6, fontSize: 12 }}>frame {game.frame} · 2D · cast-time model</span>
      </div>

      <div style={mainRow}>
        <div style={infoColumn}>
          <PlayerInfoCard player={op} title={opponentTitle} side={opSide} onPeek={setPeek} />
          <PlayerInfoCard player={me} title={selfTitle} side={localPlayer} onPeek={setPeek} />
        </div>

        <div style={rightStack}>
          <OpponentHand player={op} now={now} />
          <BattleZone op={op} me={me} now={now} />
          <SelfHand player={me} now={now} />
          <DrawButton player={me} />
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

      {game.result !== 0 && (
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
  return (
    <div style={infoCard}>
      <div style={infoCardTitle}>{title}</div>
      <Bar pct={hpPct}
           color={hpPct > 0.4 ? "#34c759" : hpPct > 0.2 ? "#ffcc00" : "#ff3b30"}
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
      <div style={pileStack}>
        <Pile label="山札" n={player.deck.length} color="#5b9eff" onClick={() => onPeek({ kind: "deck", side })} />
        <Pile label="捨札" n={player.discard.length} color="#ff7a8a" onClick={() => onPeek({ kind: "discard", side })} />
        <Pile label="手札" n={handCount} color="#cccccc" />
      </div>
    </div>
  );
}

function countCards(hand: (number | null)[]): number {
  let n = 0;
  for (const c of hand) if (c !== null) n++;
  return n;
}

// ── Battle zone: timeline with center block band ──

function BattleZone({ op, me, now }: { op: PlayerState; me: PlayerState; now: number }) {
  // Hide-opp-queue rule: second player (me.handle === 1) shouldn't see
  // first player's queue until they've themselves committed something.
  // Otherwise the 0.5閃 offset becomes pure reflex advantage.
  const hideOppQueue = me.handle === 1 && me.openedAt === null;

  const opQueue = computeQueueLayout(op, now);
  const meQueue = computeQueueLayout(me, now);
  const opHist = computeHistoryBoxes(op.resolvedCards, now);
  const meHist = computeHistoryBoxes(me.resolvedCards, now);

  const maxSec = Math.max(
    MIN_TIMELINE_SEC,
    Math.ceil(opQueue.totalSec + 2),
    Math.ceil(meQueue.totalSec + 2),
  );
  const innerWidth = NOW_OFFSET + maxSec * PX_PER_SEC + EDGE_PAD;

  // Block trajectories (current + predicted) for both players.
  // When opp's queue is hidden, opp's block trajectory still shows the
  // CURRENT value (everyone can see that) but no predicted hits/decays from
  // the hidden cards. Easiest: pass an empty queue when hidden.
  const opForBlock = hideOppQueue ? { ...op, queue: [] } : op;
  const meForBlock = hideOppQueue ? { ...me, queue: me.queue.slice() } : me;
  const opForMeBlock = hideOppQueue ? { ...op, queue: [] } : op;
  const opBlock = blockTrajectoryAt(opForBlock, meForBlock, now, maxSec);
  const meBlock = blockTrajectoryAt(me, opForMeBlock, now, maxSec);

  // Scroll setup.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft -= raw;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
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
      <div style={scrollWrap} className="no-scrollbar" ref={scrollRef}>
        <div style={{ ...timelineInner, width: innerWidth, height: TIMELINE_HEIGHT }}>
          {Array.from({ length: Math.ceil(HISTORY_SEC / SEC_PER_SEN) + 1 }).map((_, s) => (
            <TimeTick key={`p${s}`} sen={-s} totalHeight={TIMELINE_HEIGHT} />
          ))}
          {Array.from({ length: Math.ceil(maxSec / SEC_PER_SEN) + 1 }).map((_, s) => (
            <TimeTick key={`f${s}`} sen={s} totalHeight={TIMELINE_HEIGHT} />
          ))}
          {/* Block band background. */}
          <div style={{
            position: "absolute", left: 0, right: 0,
            top: BLOCK_TOP, height: BLOCK_BAND,
            background: "linear-gradient(180deg, rgba(95,160,224,0.05) 0%, rgba(255,224,102,0.10) 50%, rgba(95,160,224,0.05) 100%)",
            pointerEvents: "none",
          }} />
          {/* Horizontal axis (block = 0). */}
          <div style={{
            position: "absolute", left: 0, right: 0,
            top: BLOCK_CENTER, height: 1,
            background: "rgba(255,224,102,0.55)",
            boxShadow: "0 0 4px rgba(255,224,102,0.5)",
            pointerEvents: "none",
          }} />
          {/* SVG block trajectories. innerWidth wide, BLOCK_BAND tall, shifted to start at BLOCK_TOP. */}
          <svg
            width={innerWidth} height={BLOCK_BAND}
            style={{ position: "absolute", left: 0, top: BLOCK_TOP, pointerEvents: "none" }}
          >
            <BlockArea history={op.blockHistory} trajectory={opBlock} side="opp" nowSec={now} maxSec={maxSec} hidden={hideOppQueue} />
            <BlockArea history={me.blockHistory} trajectory={meBlock} side="self" nowSec={now} maxSec={maxSec} />
            {!hideOppQueue && <BlockEventMarks events={opBlock.events} side="opp" />}
            <BlockEventMarks events={meBlock.events} side="self" />
          </svg>
          <div style={{ ...nowDivider, left: NOW_OFFSET - 18, top: BLOCK_CENTER - 8 }}>NOW</div>
          <div style={{ ...nowLine, left: NOW_OFFSET, height: TIMELINE_HEIGHT }} />
          {/* Queue chips. Opp queue + history are hidden until the local
              second-player has committed something. */}
          {!hideOppQueue && opHist.map((b, i) => (
            <QueueBox key={`oh${i}`} {...b} yTop={OPP_QUEUE_Y_TOP} />
          ))}
          {!hideOppQueue && opQueue.boxes.map((b, i) => (
            <QueueBox key={`o${i}`} {...b} yTop={OPP_QUEUE_Y_TOP} />
          ))}
          {hideOppQueue && (
            <div style={{
              position: "absolute", left: NOW_OFFSET - 200, top: OPP_QUEUE_Y_TOP + 8,
              width: 400, textAlign: "center",
              fontSize: 11, color: "rgba(255,255,255,0.45)", fontStyle: "italic",
              pointerEvents: "none",
            }}>(後攻：自分が行動するまで相手のキューは隠されます)</div>
          )}
          {meHist.map((b, i) => (
            <QueueBox key={`mh${i}`} {...b} yTop={SELF_QUEUE_Y_TOP} />
          ))}
          {meQueue.boxes.map((b, i) => (
            <QueueBox key={`m${i}`} {...b} yTop={SELF_QUEUE_Y_TOP} />
          ))}
          {opQueue.boxes.length === 0 && <span style={{ ...idleHint, top: QUEUE_ROW / 2 - 7 }}>相手キュー空</span>}
          {meQueue.boxes.length === 0 && <span style={{ ...idleHint, top: SELF_QUEUE_Y_TOP + BOX_HEIGHT / 2 - 7 }}>自分キュー空</span>}
        </div>
      </div>
    </div>
  );
}

// ── Queue / history box layout ──

interface BoxLayout {
  cardId: number | null;     // null for draw entries
  drawSlots?: number[] | null;
  drawFilledCount?: number;
  duration: number;
  startRel: number;
  endRel: number;
  isHead: boolean;
  resolved?: boolean;
}

interface QueueLayout {
  boxes: BoxLayout[];
  totalSec: number;
}

function computeQueueLayout(player: PlayerState, now: number): QueueLayout {
  if (player.queue.length === 0) return { boxes: [], totalSec: 0 };
  let endRel = Math.max(0, player.queue[0].duration - (now - player.castStartedAt));
  const boxes: BoxLayout[] = player.queue.map((q, i) => {
    if (i > 0) endRel += q.duration;
    const isCard = q.kind === "card";
    return {
      cardId: isCard ? (q as { cardId: CardId }).cardId : null,
      drawSlots: !isCard ? (q as { drawSlots: number[] }).drawSlots : null,
      drawFilledCount: !isCard ? (q as { drawFilledCount: number }).drawFilledCount : undefined,
      duration: q.duration,
      endRel,
      startRel: endRel - q.duration,
      isHead: i === 0,
    };
  });
  return { boxes, totalSec: endRel };
}

function computeHistoryBoxes(resolved: ResolvedEntry[], now: number): BoxLayout[] {
  const out: BoxLayout[] = [];
  for (const r of resolved) {
    const endRel = r.resolvedAt - now;
    const startRel = endRel - r.duration;
    if (endRel < -HISTORY_SEC) continue;
    out.push({
      cardId: r.cardId, duration: r.duration,
      startRel, endRel, isHead: false, resolved: true,
    });
  }
  return out;
}

// Ticks are now PER-閃 (1 tick = SEC_PER_SEN seconds = 1 閃).
function TimeTick({ sen, totalHeight }: { sen: number; totalHeight: number }) {
  const x = NOW_OFFSET + sen * SEC_PER_SEN * PX_PER_SEC;
  if (x < 0) return null;
  const isMajor = sen % 5 === 0;
  const isPast = sen < 0;
  return (
    <>
      <div style={{
        position: "absolute", left: x, top: 0, height: totalHeight, width: 1,
        background: isMajor
          ? (isPast ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)")
          : (isPast ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)"),
      }} />
      {sen !== 0 && (
        <div style={{
          position: "absolute", left: x + 2, top: 4,
          fontSize: 9,
          color: isPast ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.4)",
          fontFamily: "ui-monospace, monospace",
          pointerEvents: "none",
        }}>{sen}閃</div>
      )}
    </>
  );
}

function QueueBox({ cardId, drawSlots, drawFilledCount, duration, startRel, endRel, isHead, yTop, resolved }: BoxLayout & { yTop: number }) {
  const isDraw = drawSlots != null;
  const def = !isDraw && cardId != null ? getCardDef(cardId) : null;

  const baseColor = isDraw ? "#2c5b8e"
    : def?.cardType === CardType.Attack ? "#e3553c"
    : def?.cardType === CardType.Power ? "#b465e0"
    : "#5fa0e0";
  const color = resolved ? dim(baseColor, 0.45) : baseColor;
  const left = NOW_OFFSET + startRel * PX_PER_SEC;
  const w = duration * PX_PER_SEC;
  const glow = !resolved && isHead && endRel < 0.4;
  const glowIntensity = glow ? 1 - endRel / 0.4 : 0;

  let label: string;
  if (isDraw) {
    const remaining = (drawSlots!.length - (drawFilledCount ?? 0));
    label = `ドロー ${remaining}枚`;
  } else {
    label = def?.name ?? "??";
  }
  const durSen = Math.round(secToSen(duration) * 10) / 10; // 1.0 / 0.5 fine

  return (
    <div
      style={{
        position: "absolute",
        left, width: w, height: BOX_HEIGHT,
        top: yTop,
        background: color,
        border: `2px solid ${glow ? "#fff" : color}`,
        boxSizing: "border-box",
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
      <div style={queueBoxName}>{label}</div>
      <div style={queueBoxMeta}>
        {resolved ? "発動済"
          : isHead ? `あと ${secToSen(Math.max(0, endRel)).toFixed(1)}閃`
          : `${durSen}閃`}
      </div>
    </div>
  );
}

function dim(hex: string, k: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = Math.round(parseInt(m[1], 16) * k);
  const g = Math.round(parseInt(m[2], 16) * k);
  const b = Math.round(parseInt(m[3], 16) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

// ── Block prediction ──
//
// For player p (whose block we're predicting):
//   - block decays at BLOCK_DECAY_RATE per second
//   - p's OWN queued cards with Block effect ADD block at their resolve time
//   - OPPONENT's queued ATTACK cards SUBTRACT damage at their resolve time
//     (clipped at 0; we ignore overflow into HP for this view)
// We sample at every event for an exact piecewise-linear trajectory.

interface BlockSample { t: number; block: number; }   // t is relative to now
interface BlockEvent {
  t: number;
  kind: "gain" | "hit";
  amount: number;
  pre: number;
  post: number;
  pierce: number;          // damage that bled through to HP (for outside-the-band mark)
}
interface BlockTraj { samples: BlockSample[]; events: BlockEvent[]; }

// Block trajectory: step-decay (1 unit per 閃 = SEC_PER_SEN seconds), plus
// own defense gains and opponent attack hits at the appropriate resolve
// times. Models OVERKILL via the `pierce` field on events (excess damage
// beyond block becomes a "pierce" amount the UI shows extending OUTSIDE
// the block area).
function blockTrajectoryAt(p: PlayerState, opp: PlayerState, now: number, horizonSec: number): BlockTraj {
  // Gain & hit events sorted by time (decay is simulated dynamically).
  type ExtEvent = { t: number; kind: "gain" | "hit"; amount: number };
  const externals: ExtEvent[] = [];

  const enumerate = (state: PlayerState, onResolve: (t: number, ent: QueueEntry) => void) => {
    if (state.queue.length === 0) return;
    let t = Math.max(0, state.queue[0].duration - (now - state.castStartedAt));
    onResolve(t, state.queue[0]);
    for (let i = 1; i < state.queue.length; i++) {
      t += state.queue[i].duration;
      onResolve(t, state.queue[i]);
    }
  };

  enumerate(p, (t, ent) => {
    if (ent.kind !== "card") return;
    const def = getCardDef(ent.cardId);
    if (!def) return;
    const blk = blockAmount(def.effect);
    if (blk > 0) externals.push({ t, kind: "gain", amount: blk });
  });
  enumerate(opp, (t, ent) => {
    if (ent.kind !== "card") return;
    const def = getCardDef(ent.cardId);
    if (!def) return;
    const dmg = baseAttackDamage(def.effect);
    if (dmg > 0) externals.push({ t, kind: "hit", amount: dmg });
  });
  externals.sort((a, b) => a.t - b.t);

  const samples: BlockSample[] = [];
  const eventDetails: BlockEvent[] = [];
  let block = p.block;
  // Decay timer in TRAJECTORY time (relative to now). +∞ if paused.
  let nextDecay = isFinite(p.nextBlockDecayAt) ? p.nextBlockDecayAt - now : Infinity;
  if (block <= 0) nextDecay = Infinity;

  samples.push({ t: 0, block });
  let extIdx = 0;
  let t = 0;
  const STEP_LIMIT = 200; // safety
  let safety = 0;
  while (t < horizonSec && safety++ < STEP_LIMIT) {
    const nextExt = extIdx < externals.length ? externals[extIdx].t : Infinity;
    // Earliest upcoming event: a decay tick OR an external (gain/hit) OR the horizon.
    const nextT = Math.min(nextDecay, nextExt, horizonSec);
    // Block is step-constant from t..nextT — emit both endpoints so the
    // polyline draws a flat segment, then a vertical step at nextT.
    if (nextT > t) samples.push({ t: nextT, block });
    if (nextT >= horizonSec) { t = horizonSec; break; }

    if (nextDecay <= nextExt) {
      // Decay tick fires first.
      if (block > 0) {
        block -= 1;
        if (block <= 0) nextDecay = Infinity;
        else nextDecay = nextT + SEC_PER_SEN;
      } else {
        nextDecay = Infinity;
      }
      samples.push({ t: nextT, block });
    } else {
      // External event.
      const e = externals[extIdx++];
      const pre = block;
      let pierce = 0;
      if (e.kind === "gain") {
        const wasZero = block <= 0;
        block += e.amount;
        // Re-arm decay if it was paused OR already expired.
        if (wasZero || !isFinite(nextDecay) || nextDecay <= nextT) {
          nextDecay = nextT + SEC_PER_SEN;
        }
      } else {
        const absorbed = Math.min(block, e.amount);
        pierce = e.amount - absorbed;
        block -= absorbed;
        if (block <= 0) nextDecay = Infinity;
      }
      samples.push({ t: nextT, block });
      eventDetails.push({ t: nextT, kind: e.kind, amount: e.amount, pre, post: block, pierce });
    }
    t = nextT;
  }
  if (t < horizonSec) samples.push({ t: horizonSec, block });
  return { samples, events: eventDetails };
}

function blockAmount(e: CardEffect): number {
  switch (e.kind) {
    case "Block": return e.amount;
    case "Combo": return e.effects.reduce((s, x) => s + blockAmount(x), 0);
    default: return 0;
  }
}

function baseAttackDamage(e: CardEffect): number {
  switch (e.kind) {
    case "Damage": return e.amount;
    case "MultiHit": return e.damage * e.hits;
    case "Combo": return e.effects.reduce((s, x) => s + baseAttackDamage(x), 0);
    default: return 0;
  }
}

// Render the filled block-area polygon for one side.
//
// Geometry: block stacks TOWARD the center axis (opp from top edge, self
// from bottom edge). height(b) is exponentially narrower at higher block
// values.
//
// PAST samples (t < 0) come from the player's RECORDED blockHistory — these
// are the actual historical values, NOT a projection from current block.
// FUTURE samples (t >= 0) come from the trajectory prediction. The past
// section never changes shape just because the prediction does.
function BlockArea({
  history, trajectory, side, nowSec, maxSec, hidden,
}: {
  history: { t: number; block: number }[];
  trajectory: BlockTraj;
  side: "opp" | "self";
  nowSec: number;
  maxSec: number;
  hidden?: boolean;
}) {
  const futureSamples = trajectory.samples;
  if (futureSamples.length < 1 && history.length === 0) return null;

  const color = side === "opp"
    ? (hidden ? "rgba(95, 160, 224, 0.12)" : "rgba(95, 160, 224, 0.45)")
    : (hidden ? "rgba(95, 200, 130, 0.12)" : "rgba(95, 200, 130, 0.45)");
  const stroke = side === "opp"
    ? (hidden ? "rgba(95, 160, 224, 0.25)" : "#5fa0e0")
    : (hidden ? "rgba(95, 200, 130, 0.25)" : "#5fc882");
  // Snap to integer pixels — without this, the polygon's X positions
  // drift sub-pixel each frame (PX_PER_SEC * 1/60 ≈ 0.58 px/frame), and
  // SVG anti-aliasing shimmers visibly along the edges. Block values are
  // already integers from the sim, so Y is naturally crisp too.
  const yForBlock = (b: number) => {
    const h = blockHeight(b);
    return Math.round(side === "opp" ? 0 + h : BLOCK_BAND - h);
  };
  const xForRel = (relSec: number) =>
    Math.round(NOW_OFFSET + Math.max(-HISTORY_SEC, relSec) * PX_PER_SEC);
  const outerY = side === "opp" ? 0 : BLOCK_BAND;
  // The past polygon shouldn't extend BEFORE the game started (t < -nowSec
  // in relative coords). Past-clamp = max(-HISTORY_SEC, -nowSec).
  const pastLimit = Math.max(-HISTORY_SEC, -nowSec);

  // Build the (relSec, block) samples by stitching history + future.
  // History samples are STEP-CONSTANT between entries (block was X from
  // entry.t until the next entry's t). Convert from absolute time to
  // relative-to-now and clip to [-HISTORY_SEC, 0].
  const rel: { t: number; block: number }[] = [];
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const r = h.t - nowSec;
    if (r > 0) break; // history entry already in the future (shouldn't happen)
    if (r < pastLimit) {
      // Sample is older than the visible window. If the NEXT entry is
      // within the window, this one's value is the anchor block — it was
      // valid from this entry's time until the next entry's time.
      const next = history[i + 1];
      if (!next || next.t - nowSec < pastLimit) continue;
      rel.push({ t: pastLimit, block: h.block });
      continue;
    }
    rel.push({ t: r, block: h.block });
  }
  if (rel.length === 0 || rel[0].t > pastLimit) {
    const anchorBlock = rel.length > 0 ? rel[0].block : (futureSamples[0]?.block ?? 0);
    rel.unshift({ t: pastLimit, block: anchorBlock });
  }
  // The "current" sample (at t = 0) is the latest history value (= current
  // block); the prediction starts there too.
  const currentBlock = futureSamples.length > 0 ? futureSamples[0].block : rel[rel.length - 1].block;
  // Add a t=0 sample if missing, so the past extends right up to NOW.
  if (rel[rel.length - 1].t < 0) {
    rel.push({ t: 0, block: currentBlock });
  }
  // Append future samples (excluding the leading t=0 to avoid a duplicate).
  for (let i = 0; i < futureSamples.length; i++) {
    const s = futureSamples[i];
    if (s.t <= 0) continue;
    if (s.t > maxSec) break;
    rel.push({ t: s.t, block: s.block });
  }

  // Now emit a STEP-WISE polygon. Each transition is a horizontal segment
  // (constant block until next sample) plus a vertical step at that sample.
  const points: string[] = [];
  const leftX = xForRel(rel[0].t);
  const rightX = xForRel(rel[rel.length - 1].t);
  points.push(`${leftX},${outerY}`);
  for (let i = 0; i < rel.length; i++) {
    const cur = rel[i];
    const x = xForRel(cur.t);
    // Step DOWN from previous block level (vertical move at this t),
    // implicit on first iteration via the (leftX, outerY) starting point.
    points.push(`${x},${yForBlock(cur.block)}`);
    // Horizontal hold until the NEXT sample (if any).
    if (i + 1 < rel.length) {
      const nx = xForRel(rel[i + 1].t);
      points.push(`${nx},${yForBlock(cur.block)}`);
    }
  }
  points.push(`${rightX},${outerY}`);

  return (
    <>
      <polygon
        points={points.join(" ")}
        fill={color} stroke="none"
        shapeRendering="crispEdges"
      />
      <polyline
        points={points.slice(1, -1).join(" ")}
        fill="none" stroke={stroke} strokeWidth={1.5} opacity={hidden ? 0.4 : 0.85}
        shapeRendering="crispEdges"
      />
    </>
  );
}

// Event marks. Hits = red bars stacked from current block TIP toward the
// outer edge; pierce (overkill) = extends BEYOND the outer edge, sticking
// out to indicate damage that bled into HP.
function BlockEventMarks({ events, side }: { events: BlockEvent[]; side: "opp" | "self" }) {
  const outerY = side === "opp" ? 0 : BLOCK_BAND;
  const yForBlock = (b: number) =>
    side === "opp" ? outerY + blockHeight(b) : outerY - blockHeight(b);
  // Pierce extends an extra fixed pixel per unit OUTSIDE the outer edge.
  const PIERCE_PX_PER_UNIT = 1.5;
  const PIERCE_MAX_EXTEND = 32;

  return (
    <>
      {events.map((e, i) => {
        const x = NOW_OFFSET + e.t * PX_PER_SEC;
        const yPre = yForBlock(e.pre);
        const yPost = yForBlock(e.post);
        const color = e.kind === "hit" ? "#ff6b5a" : "#7fe3a4";
        const label = e.kind === "hit" ? `−${Math.round(e.amount)}` : `+${Math.round(e.amount)}`;
        const pierce = e.pierce ?? 0;
        const pierceLen = Math.min(PIERCE_MAX_EXTEND, pierce * PIERCE_PX_PER_UNIT);
        return (
          <g key={i}>
            {/* Bar inside the block band (shows the slice of block consumed
                / added). */}
            <line x1={x} y1={yPre} x2={x} y2={yPost} stroke={color} strokeWidth={2} opacity={0.85} />
            {/* Pierce extends OUTSIDE the band (above top edge for opp,
                below bottom edge for self). */}
            {pierce > 0 && (
              <line
                x1={x} x2={x}
                y1={outerY}
                y2={side === "opp" ? outerY - pierceLen : outerY + pierceLen}
                stroke="#ff3b30" strokeWidth={3} opacity={0.95}
              />
            )}
            <text
              x={x + 3}
              y={side === "opp"
                  ? (pierce > 0 ? outerY - pierceLen - 2 : Math.min(yPre, yPost) - 2)
                  : (pierce > 0 ? outerY + pierceLen + 9 : Math.max(yPre, yPost) + 9)}
              fill={color}
              fontSize={9}
              fontFamily="ui-monospace, monospace"
              opacity={0.95}
            >
              {label}{pierce > 0 ? ` 貫${pierce}` : ""}
            </text>
          </g>
        );
      })}
    </>
  );
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
        transition: "height 80ms linear", pointerEvents: "none",
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
        transition: "height 80ms linear", pointerEvents: "none",
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
  // prereq is in 閃 in card def; queue remaining is in seconds.
  const queuedSec = queueRemainingTime(player, now);
  const prereqSen = def.prereqQueueTime ?? 0;
  const prereqOk = prereqSen * SEC_PER_SEN <= queuedSec;
  const clickable = !unplayable && prereqOk;
  // Is this slot the current manual reservation?
  const reserved = player.reservation.kind === "card" && player.reservation.slotIndex === idx;

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
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={!clickable}
        style={{
          ...cardStyle,
          background: typeColor(def.cardType, clickable),
          cursor: clickable ? "pointer" : "not-allowed",
          boxShadow: clickable ? "0 4px 12px rgba(0,0,0,0.4)" : "none",
          outline: reserved ? "2px solid #ffe066" : def.exhausts ? "1px solid #ffaa55" : "none",
          opacity: clickable ? 1 : 0.55,
        }}
      >
        {!clickable && (
          <div aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", pointerEvents: "none" }} />
        )}
        {reserved && (
          <div aria-hidden style={{
            position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)",
            background: "#ffe066", color: "#1a1a22",
            padding: "1px 6px", borderRadius: 4,
            fontSize: 9, fontWeight: 700, letterSpacing: 1, zIndex: 3,
          }}>予約中</div>
        )}
        <div style={{ ...cardCostStyle, color: clickable ? "#ffe580" : "#cfd6e0" }}>
          {unplayable ? "✗" : def.cost + "閃"}
          {prereqSen > 0 && (
            <span style={{ fontSize: 10, marginLeft: 4, color: prereqOk ? "#80ffa0" : "#ff9a40" }}>
              要{prereqSen}閃
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

function DrawButton({ player }: { player: PlayerState }) {
  const reserved = reservedSlotSet(player);
  let emptyCount = 0;
  for (let i = 0; i < player.hand.length; i++) {
    if (player.hand[i] === null && !reserved.has(i)) emptyCount++;
  }
  let drawing = false;
  for (const q of player.queue) if (q.kind === "draw") { drawing = true; break; }
  const enabled = emptyCount > 0 && !drawing;
  const costSen = emptyCount * DRAW_SEN_PER_CARD;
  const isReservation =
    player.reservation.kind === "draw"
    || (player.reservation.kind === "default" && emptyCount > 0);

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
        background: drawing
          ? "rgba(95,160,224,0.18)"
          : enabled ? "linear-gradient(180deg, #2c5b8e 0%, #1a3d6e 100%)" : "#1a1a22",
        color: enabled ? "#fff" : "#666",
        cursor: enabled ? "pointer" : "not-allowed",
        borderColor: isReservation ? "#ffe066" : drawing ? "rgba(95,160,224,0.5)" : enabled ? "#3a7fbf" : "#2a2a35",
        outline: isReservation ? "2px solid #ffe066" : "none",
        outlineOffset: -2,
      }}
      title={drawing ? "ドロー中" : enabled ? `${emptyCount}枚 / ${costSen}閃` : "空きなし"}
    >
      {isReservation && (
        <span style={{
          background: "#ffe066", color: "#1a1a22", padding: "1px 6px",
          borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 1, marginRight: 8,
        }}>予約中</span>
      )}
      <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>⇊ ドロー (D)</span>
      <span style={{ fontSize: 12, opacity: 0.85, marginLeft: 12, fontFamily: "ui-monospace, monospace" }}>
        {drawing ? "キューで実行中" : enabled ? `${emptyCount}枚 (合計 ${costSen}閃)` : "(空きなし)"}
      </span>
    </button>
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
  const d = active ? 1 : 0.55;
  switch (t) {
    case CardType.Attack: return `rgba(${(193 * d) | 0}, ${(45 * d) | 0}, ${(45 * d) | 0}, 1)`;
    case CardType.Skill:  return `rgba(${(45 * d) | 0}, ${(105 * d) | 0}, ${(193 * d) | 0}, 1)`;
    case CardType.Power:  return `rgba(${(140 * d) | 0}, ${(60 * d) | 0}, ${(193 * d) | 0}, 1)`;
    case CardType.Status: return "#444";
  }
}

// ── styles ──

const page: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
  padding: 14, gap: 10,
  background: "linear-gradient(180deg, #14141c 0%, #0a0a12 100%)",
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

const battleZone: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  background: "rgba(40, 30, 60, 0.25)",
  border: "1px solid rgba(110, 80, 170, 0.35)",
  borderRadius: 10,
  padding: 8,
};
const scrollWrap: React.CSSProperties = {
  position: "relative", width: "100%",
  overflowX: "auto", overflowY: "hidden",
  background: "rgba(0,0,0,0.30)",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.05)",
};
const timelineInner: React.CSSProperties = { position: "relative" };
const nowDivider: React.CSSProperties = {
  position: "absolute", width: 36, height: 16, lineHeight: "16px",
  fontSize: 9, color: "#1a1a22", letterSpacing: 2, fontWeight: 700,
  fontFamily: "ui-monospace, monospace", textAlign: "center",
  background: "#ffe066", borderRadius: 4,
  pointerEvents: "none", zIndex: 4,
  boxShadow: "0 0 6px rgba(255,224,102,0.55)",
};
const nowLine: React.CSSProperties = {
  position: "absolute", top: 0, width: 2,
  background: "linear-gradient(180deg, #fff 0%, #ffe066 50%, #fff 100%)",
  boxShadow: "0 0 8px rgba(255,224,102,0.6)",
  zIndex: 3,
};
const idleHint: React.CSSProperties = {
  position: "absolute", left: NOW_OFFSET + 8,
  fontSize: 11, opacity: 0.4, fontStyle: "italic",
};
const queueBoxName: React.CSSProperties = { fontWeight: 700, fontSize: 12, lineHeight: 1.1, textShadow: "0 1px 2px rgba(0,0,0,0.8)" };
const queueBoxMeta: React.CSSProperties = { fontSize: 10, opacity: 0.9, fontFamily: "ui-monospace, monospace", marginTop: 2 };

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
  width: CARD_W, height: CARD_H, padding: 10, borderRadius: 8, border: "1px solid #00000040",
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

const drawButtonStyle: React.CSSProperties = {
  marginLeft: "auto", marginRight: "auto",
  height: 44, borderRadius: 8, border: "1px solid #3a7fbf",
  display: "flex", alignItems: "center", justifyContent: "center",
  gap: 8, fontFamily: "ui-sans-serif, system-ui, sans-serif",
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
