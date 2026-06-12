// Timeline (戦況タイムライン) — SimpleGameplay から分離した描画部。
//
// 中央のブロック帯 + 両者のキュー行 + 予約ゴースト + 予測ポリゴン +
// 烈閃の地形帯 + 確定マーカーまで、「時間軸上の戦況」をすべて担当する。
// 手札・情報カード・操作ボタンは SimpleGameplay 側。
//
// 設計メモ: 予測は predictSignature をキーに絶対時刻でキャッシュし、
// 描画フレームでは offset を足すだけ (毎フレームの全シム再実行はしない)。

import { useEffect, useMemo, useRef } from "react";
import { CardId, CardType, getCardDef } from "../../sim/cards";
import { isSurgeSen } from "../../sim/events";
import { predictForward } from "../../sim/predict";
import { futureEmptyAtDrawPosition } from "../../sim/reducer";
import { DRAW_SEN_PER_CARD, SEC_PER_SEN, secToSen, senToSec } from "../../sim/rules";
import { GameState, PlayerState, ResolvedEntry } from "../../sim/state";

const PX_PER_SEC = 35;
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
// Outer band between each queue row and the block band — gives poison area
// and pierce marks somewhere visible to render OUTSIDE the block band
// without being clipped by the SVG viewbox or overlapping queue chips.
const OUTER_BAND = 52;
const TIMELINE_HEIGHT = QUEUE_ROW * 2 + OUTER_BAND * 2 + BLOCK_BAND;

// Y coordinates within the inner timeline div.
const OPP_QUEUE_Y_TOP = (QUEUE_ROW - BOX_HEIGHT) / 2;
const BLOCK_TOP = QUEUE_ROW + OUTER_BAND;                    // upper edge of opp's block area
const BLOCK_CENTER = BLOCK_TOP + BLOCK_HALF;                  // horizontal axis (block = 0)
const BLOCK_BOTTOM = BLOCK_TOP + BLOCK_BAND;                  // lower edge of self's block area
const SELF_QUEUE_Y_TOP = BLOCK_BOTTOM + OUTER_BAND + (QUEUE_ROW - BOX_HEIGHT) / 2;
// SVG covers the block band PLUS both outer bands so poison/pierce can
// render in the outer space without being clipped.
const SVG_TOP = QUEUE_ROW;                                    // top of opp outer band
const SVG_HEIGHT = OUTER_BAND + BLOCK_BAND + OUTER_BAND;
// Within the SVG, these are the outer edges of the block band.
const BLOCK_OUTER_Y_OPP = OUTER_BAND;                         // opp block grows from here downward
const BLOCK_OUTER_Y_SELF = OUTER_BAND + BLOCK_BAND;           // self block grows from here upward

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
// ── Battle zone: timeline with center block band ──

// Signature of everything that can change the predicted future. The sim is
// deterministic and autonomous under zero inputs, so a computed trajectory
// stays valid (in ABSOLUTE time) until one of these actually changes — a
// click, a card resolving, a block/poison tick. That happens a few times
// per 閃, not 60×/sec, so keying the prediction on this string instead of
// `game.frame` removes a full 30s re-simulation from every render frame.
//
// Continuously-decaying values (vulnerableSecs, weakSecs, rage.remaining,
// demonForm.accumulated) are deliberately EXCLUDED: their decay is itself
// part of the predicted trajectory and never invalidates it. Including
// them would force a re-simulation every frame and defeat the cache.
function predictSignature(g: GameState): string {
  let sig = "";
  for (const p of g.players) {
    sig += Math.ceil(p.hp) + "," + p.block + "," + p.poison + "," + p.strength + ","
      + p.thorns + "," + p.renzan + "," + p.castStartedAt + ";";
    for (const q of p.queue) {
      sig += q.kind === "card" ? "c" + q.cardId + ":" + q.duration
        : q.kind === "draw" ? "d" + q.drawSlots.join(".") + ":" + q.drawFilledCount
        : "r";
      sig += "|";
    }
    sig += ";";
    for (const r of p.reservations) sig += r.kind === "card" ? r.slotIndex + "|" : "D|";
    sig += ";";
    for (const c of p.hand) sig += (c === null ? "_" : c) + ".";
    sig += ";" + (p.metallicize?.blockPerSec ?? "")
      + "," + (p.combust ? p.combust.selfPerSec + ":" + p.combust.enemyPerSec : "")
      + "," + (p.barricade ? 1 : 0)
      + "," + (p.demonForm?.strengthPerSec ?? "")
      + "," + (p.brutality ? 1 : 0)
      + "," + (p.juggernaut?.damageOnBlock ?? "")
      + "," + (p.rage ? p.rage.blockPerAttack : "")
      + "#";
  }
  return sig;
}

const ceilToSen = (sec: number) => Math.ceil(sec / SEC_PER_SEN) * SEC_PER_SEN;

export function BattleZone({ game, op, me, now }: { game: GameState; op: PlayerState; me: PlayerState; now: number }) {
  // Hide-opp-queue rule: second player (me.handle === 1) shouldn't see
  // first player's queue until they've themselves committed something.
  // Otherwise the 0.5閃 offset becomes pure reflex advantage.
  const hideOppQueue = me.handle === 1 && me.openedAt === null;

  const opQueue = computeQueueLayout(op, now);
  const meQueue = computeQueueLayout(me, now);
  const opHist = computeHistoryBoxes(op.resolvedCards, now);
  const meHist = computeHistoryBoxes(me.resolvedCards, now);
  // 予約はローカル情報 (design law: 相手には伝わらない). The opponent's
  // reservation list is NEVER rendered — no ghost chips for them, and the
  // prediction below runs with their reservations stripped so their plan
  // can't leak through the forecast (block trajectory / pierce marks /
  // poison) either. Only their QUEUE — the public commitment — is shown.
  const meGhosts = computeReservationGhosts(me, meQueue.totalSec);

  const opTotalSec = opQueue.totalSec;
  const meTotalSec = meQueue.totalSec + meGhosts.reduce((s, g) => s + g.duration, 0);
  // Quantized to whole 閃 so the timeline width (and the prediction
  // horizon) changes at most once per 閃 instead of every second —
  // a constantly-resizing scroll content is itself a source of visual
  // jitter.
  const maxSec = Math.max(
    MIN_TIMELINE_SEC,
    ceilToSen(opTotalSec + 2),
    ceilToSen(meTotalSec + 2),
  );
  const innerWidth = NOW_OFFSET + maxSec * PX_PER_SEC + EDGE_PAD;

  // Predicted block trajectories — computed by RUNNING THE REAL SIM forward
  // from a snapshot. No hand-rolled queue walking; every effect the
  // reducer knows about (defense gains, attack hits, combust ticks,
  // step-decay, auto-reservations, self-damage, etc.) is reflected.
  //
  // The snapshot is MASKED: the opponent's reservations are always
  // stripped (予約はローカル — their plan must not leak through the
  // forecast), and their queue too while it's hidden from this player.
  //
  // PERFORMANCE: keyed on predictSignature(masked), NOT game.frame. The
  // trajectory is in absolute time (pred.baseSec + sample.t); each render
  // just shifts it by `predOffset` below. Re-simulation only happens when
  // the sim state meaningfully changes (a few times per 閃), instead of a
  // full 30s × 60fps re-simulation every frame — which was eating most of
  // the frame budget and causing dropped frames.
  const oppHandle = op.handle;
  const maskPlayer = (pl: PlayerState): PlayerState =>
    pl.handle === oppHandle
      ? { ...pl, reservations: [], queue: hideOppQueue ? [] : pl.queue }
      : pl;
  const maskedGame: GameState = {
    ...game,
    players: [maskPlayer(game.players[0]), maskPlayer(game.players[1])] as [PlayerState, PlayerState],
  };
  const sig = predictSignature(maskedGame);
  const pred = useMemo(() => {
    return predictForward(maskedGame, maxSec);
    // `sig` is the memo key standing in for maskedGame's prediction-
    // relevant content; the underlying state is mutated in place by the
    // reducer so object identity can't be the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, maxSec, hideOppQueue, op.handle]);
  // How far the (absolute-time) prediction has drifted behind NOW. All
  // future-sample `t`s are shifted by this before drawing. Always <= 0.
  const predOffset = pred.baseSec - now;
  // Confirm (確定) markers: the predicted moment each of MY reservations
  // leaves the list and locks into the queue. Normal cards confirm exactly
  // where their ghost chip starts (marker would be redundant); a marker is
  // shown only when a reservation locks EARLIER than its chip — i.e. heavy
  // cards (lock at remaining == prereq, before their cast start) and the
  // members of an atomic batch (all lock together at the batch moment).
  const meResFires = me.handle === 0 ? pred.p0ResFires : pred.p1ResFires;
  const confirmTicks: number[] = [];
  for (const g of meGhosts) {
    const fireAbs = meResFires[(g.reservationOrder ?? 1) - 1];
    if (fireAbs === undefined) continue;
    const fireRel = fireAbs + predOffset;
    if (fireRel < -0.01) continue;
    if (g.startRel - fireRel <= 0.1) continue; // confirms at its own start — implicit
    if (!confirmTicks.some((t) => Math.abs(t - fireRel) < 0.05)) confirmTicks.push(fireRel);
  }
  // Pick out each side's trajectory by handle.
  const opBlockPred = op.handle === 0 ? pred.p0Block : pred.p1Block;
  const meBlockPred = me.handle === 0 ? pred.p0Block : pred.p1Block;
  const opPoisonPred = op.handle === 0 ? pred.p0Poison : pred.p1Poison;
  const mePoisonPred = me.handle === 0 ? pred.p0Poison : pred.p1Poison;
  const opPierces = op.handle === 0 ? pred.p0Pierces : pred.p1Pierces;
  const mePierces = me.handle === 0 ? pred.p0Pierces : pred.p1Pierces;

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
      {/* Row ownership tags — fixed at the left edge, above the scroll. */}
      <div style={{ ...rowTag, color: "#7db4e8", top: 8 + QUEUE_ROW / 2 - 9 }}>相手</div>
      <div style={{ ...rowTag, color: "#7fd8a0", top: 8 + SELF_QUEUE_Y_TOP + BOX_HEIGHT / 2 - 9 }}>自分</div>
      <div style={scrollWrap} className="no-scrollbar" ref={scrollRef}>
        <div style={{ ...timelineInner, width: innerWidth, height: TIMELINE_HEIGHT }}>
          {Array.from({ length: Math.ceil(HISTORY_SEC / SEC_PER_SEN) + 1 }).map((_, s) => (
            <TimeTick key={`p${s}`} sen={-s} totalHeight={TIMELINE_HEIGHT} />
          ))}
          {Array.from({ length: Math.ceil(maxSec / SEC_PER_SEN) + 1 }).map((_, s) => (
            <TimeTick key={`f${s}`} sen={s} totalHeight={TIMELINE_HEIGHT} />
          ))}
          {/* 烈閃 markers: surge 閃s are PUBLIC terrain, identical for both
              players, known from frame 0 — gold bands on the timeline.
              Attacks RESOLVING inside one hit +4. */}
          {(() => {
            const nowSen = Math.floor(now / SEC_PER_SEN);
            const fromSen = nowSen - Math.ceil(HISTORY_SEC / SEC_PER_SEN);
            const toSen = nowSen + Math.ceil(maxSec / SEC_PER_SEN) + 1;
            const bands = [];
            for (let abs = Math.max(0, fromSen); abs <= toSen; abs++) {
              if (!isSurgeSen(game.matchSeed, abs)) continue;
              const x = NOW_OFFSET + (abs * SEC_PER_SEN - now) * PX_PER_SEC;
              const past = abs < nowSen;
              bands.push(
                <div key={`rs${abs}`} style={{
                  position: "absolute", top: 0, height: TIMELINE_HEIGHT,
                  left: 0, transform: `translate3d(${x}px, 0, 0)`,
                  width: SEC_PER_SEN * PX_PER_SEC,
                  // 朱のごく薄い洗い + 両端の hairline。光らせない。
                  background: past ? "rgba(232,71,43,0.03)" : "rgba(232,71,43,0.07)",
                  borderLeft: `1px solid rgba(232,71,43,${past ? 0.18 : 0.6})`,
                  borderRight: `1px solid rgba(232,71,43,${past ? 0.08 : 0.25})`,
                  pointerEvents: "none",
                }}>
                  <div style={{
                    position: "absolute", top: 13, left: 5,
                    fontSize: 10, fontWeight: 800, letterSpacing: 2,
                    color: past ? "rgba(232,71,43,0.35)" : "#e8472b",
                    fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", serif',
                    whiteSpace: "nowrap",
                  }}>烈閃 +4</div>
                </div>,
              );
            }
            return bands;
          })()}
          {/* Block band background — 紙のごく薄い面。 */}
          <div style={{
            position: "absolute", left: 0, right: 0,
            top: BLOCK_TOP, height: BLOCK_BAND,
            background: "rgba(232,228,218,0.025)",
            pointerEvents: "none",
          }} />
          {/* Horizontal axis (block = 0) — 紙の hairline。 */}
          <div style={{
            position: "absolute", left: 0, right: 0,
            top: BLOCK_CENTER, height: 1,
            background: "rgba(232,228,218,0.28)",
            pointerEvents: "none",
          }} />
          {/* SVG covers the block band PLUS outer bands above/below so the
              poison area, pierce marks, and gain/loss labels can render
              outside the block band without being clipped. */}
          <svg
            width={innerWidth} height={SVG_HEIGHT}
            style={{ position: "absolute", left: 0, top: SVG_TOP, pointerEvents: "none", overflow: "visible" }}
          >
            <BlockArea history={op.blockHistory} future={opBlockPred} offset={predOffset} side="opp" nowSec={now} maxSec={maxSec} hidden={hideOppQueue} />
            <BlockArea history={me.blockHistory} future={meBlockPred} offset={predOffset} side="self" nowSec={now} maxSec={maxSec} />
            <PoisonArea currentPoison={op.poison} future={opPoisonPred} offset={predOffset} side="opp" maxSec={maxSec} hidden={hideOppQueue} />
            <PoisonArea currentPoison={me.poison} future={mePoisonPred} offset={predOffset} side="self" maxSec={maxSec} />
            {!hideOppQueue && <PierceMarks events={opPierces} offset={predOffset} side="opp" />}
            <PierceMarks events={mePierces} offset={predOffset} side="self" />
            <BlockChangeLabels history={op.blockHistory} future={opBlockPred} offset={predOffset} side="opp" nowSec={now} maxSec={maxSec} hidden={hideOppQueue} />
            <BlockChangeLabels history={me.blockHistory} future={meBlockPred} offset={predOffset} side="self" nowSec={now} maxSec={maxSec} />
            <PoisonChangeLabels currentPoison={op.poison} future={opPoisonPred} offset={predOffset} side="opp" maxSec={maxSec} hidden={hideOppQueue} />
            <PoisonChangeLabels currentPoison={me.poison} future={mePoisonPred} offset={predOffset} side="self" maxSec={maxSec} />
          </svg>
          <div style={{ ...nowDivider, left: NOW_OFFSET - 18, top: BLOCK_CENTER - 8 }}>今</div>
          <div style={{ ...nowLine, left: NOW_OFFSET, height: TIMELINE_HEIGHT }} />
          {/* Queue chips. Opp queue + history are hidden until the local
              second-player has committed something. */}
          {!hideOppQueue && opHist.map((b, i) => (
            <QueueBox key={`oh${i}`} {...b} yTop={OPP_QUEUE_Y_TOP} />
          ))}
          {!hideOppQueue && opQueue.boxes.map((b, i) => (
            <QueueBox key={`o${i}`} {...b} yTop={OPP_QUEUE_Y_TOP} />
          ))}
          {/* NOTE: no ghost chips for the opponent — reservations are
              local-only information (予約は相手に伝わらない). */}
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
          {meGhosts.map((b, i) => (
            <QueueBox key={`mg${i}`} {...b} yTop={SELF_QUEUE_Y_TOP} />
          ))}
          {/* 確定 markers: where reservations will LOCK (heavy cards lock
              before their chip start; atomic batches lock together). */}
          {confirmTicks.map((t, i) => {
            const x = NOW_OFFSET + t * PX_PER_SEC;
            return (
              <div key={`cf${i}`} style={{ position: "absolute", left: x, top: SELF_QUEUE_Y_TOP - 14, pointerEvents: "none", zIndex: 2 }}>
                <div style={{
                  fontSize: 9, fontWeight: 800, color: "#e8e4da",
                  background: "#e8472b",
                  padding: "0 5px", whiteSpace: "nowrap",
                  fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", serif',
                  transform: "translateX(-50%)",
                }}>確定</div>
                <div style={{
                  position: "absolute", left: 0, top: 14, width: 1, height: BOX_HEIGHT + 14,
                  background: "rgba(232,71,43,0.6)",
                }} />
              </div>
            );
          })}
          {opQueue.boxes.length === 0 && <span style={{ ...idleHint, top: QUEUE_ROW / 2 - 7 }}>相手キュー空</span>}
          {meQueue.boxes.length === 0 && meGhosts.length === 0 && <span style={{ ...idleHint, top: SELF_QUEUE_Y_TOP + BOX_HEIGHT / 2 - 7 }}>自分キュー空</span>}
        </div>
      </div>
    </div>
  );
}

// ── Queue / history box layout ──

interface BoxLayout {
  cardId: number | null;     // null for draw/rest entries
  drawSlots?: number[] | null;
  drawFilledCount?: number;
  isRest?: boolean;
  duration: number;
  startRel: number;
  endRel: number;
  isHead: boolean;
  resolved?: boolean;
  // Ghost = a reservation that hasn't fired yet. Rendered with reduced
  // opacity + dashed border so the player can see their planned sequence
  // sitting "behind" the actual queue.
  ghost?: boolean;
  // 1-based reservation number for ghost chips (matches the hand badge).
  reservationOrder?: number;
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
    return {
      cardId: q.kind === "card" ? q.cardId : null,
      drawSlots: q.kind === "draw" ? q.drawSlots : null,
      drawFilledCount: q.kind === "draw" ? q.drawFilledCount : undefined,
      isRest: q.kind === "rest",
      duration: q.duration,
      endRel,
      startRel: endRel - q.duration,
      isHead: i === 0,
    };
  });
  return { boxes, totalSec: endRel };
}

// Build ghost chips for the player's manual reservation list, appended
// linearly after the queue. Heavy (prereq) cards are still appended
// linearly here — actual fire timing is governed by the sim's "queue
// remaining == prereq" rule, but a simple time-ordered ghost is what
// the player intuitively reads as "next, then next".
function computeReservationGhosts(player: PlayerState, queueTotalSec: number): BoxLayout[] {
  if (player.reservations.length === 0) return [];
  const out: BoxLayout[] = [];
  let cum = queueTotalSec;
  for (let i = 0; i < player.reservations.length; i++) {
    const r = player.reservations[i];
    if (r.kind === "card") {
      const cardId = player.hand[r.slotIndex];
      if (cardId === null || cardId === undefined) continue;
      const def = getCardDef(cardId);
      if (!def) continue;
      const duration = senToSec(def.cost);
      out.push({
        cardId,
        duration,
        startRel: cum,
        endRel: cum + duration,
        isHead: false,
        ghost: true,
        reservationOrder: i + 1,
      });
      cum += duration;
    } else {
      // Draw entry: count slots that WILL be empty when this draw fires —
      // every preceding card reservation frees its slot, and any earlier
      // draw consumes those. Matches what applyDrawAction will see at
      // fire time, so the ghost chip is the right size.
      const n = futureEmptyAtDrawPosition(player, i);
      if (n === 0) continue; // this draw will be a no-op (drop from preview)
      const duration = senToSec(n * DRAW_SEN_PER_CARD);
      out.push({
        cardId: null,
        drawSlots: new Array(n).fill(0),
        drawFilledCount: 0,
        duration,
        startRel: cum,
        endRel: cum + duration,
        isHead: false,
        ghost: true,
        reservationOrder: i + 1,
      });
      cum += duration;
    }
  }
  return out;
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

function QueueBox({ cardId, drawSlots, drawFilledCount, isRest, duration, startRel, endRel, isHead, yTop, resolved, ghost, reservationOrder }: BoxLayout & { yTop: number }) {
  const isDraw = drawSlots != null;
  const def = !isDraw && cardId != null ? getCardDef(cardId) : null;

  // 機能色 flat (設計言語: 弁柄/藍鉄/紫紺、ドロー=藍鉄の暗、休息=墨)。
  const baseColor = isRest ? "#26262b"
    : isDraw ? "#2c4258"
    : def?.cardType === CardType.Attack ? "#8e3a30"
    : def?.cardType === CardType.Power ? "#544668"
    : "#33526e";
  // Resolved chips and ghost reservations both render dimmed.
  const bg = resolved ? dim(baseColor, 0.5) : ghost ? "rgba(232,71,43,0.08)" : baseColor;
  const left = NOW_OFFSET + startRel * PX_PER_SEC;
  const w = duration * PX_PER_SEC;
  const glow = !resolved && !ghost && isHead && endRel < 0.4 && !isRest;
  const glowIntensity = glow ? 1 - endRel / 0.4 : 0;

  let label: string;
  if (isRest) {
    label = "休息";
  } else if (isDraw) {
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
        // transform (not left/top) so the per-frame ~0.6px slide is GPU-
        // composited with sub-pixel interpolation instead of relayouting
        // and snapping to whole pixels — the chips glide instead of
        // juddering.
        left: 0, top: 0,
        transform: `translate3d(${left}px, ${yTop}px, 0)`,
        width: w, height: BOX_HEIGHT,
        background: bg,
        // 予約ゴースト = 朱の破線 (まだ取り消せる意思)。実チップは紙の
        // hairline。キャスト中ヘッドの左端には朱の刃 (NOWに接する縁)。
        border: ghost
          ? "1px dashed rgba(232,71,43,0.8)"
          : glow ? "1px solid #fff" : "1px solid rgba(232,228,218,0.18)",
        borderLeft: !resolved && !ghost && isHead
          ? "3px solid #e8472b"
          : undefined,
        boxSizing: "border-box",
        // 解決の白閃 (出来事) のみ光ってよい。
        boxShadow: glow
          ? `0 0 ${8 + 14 * glowIntensity}px rgba(255,255,255,${0.3 + 0.4 * glowIntensity})`
          : "none",
        borderRadius: 0,
        padding: "3px 8px",
        color: ghost ? "rgba(232,121,99,0.95)" : resolved ? "rgba(232,228,218,0.45)" : "#e8e4da",
        overflow: "hidden",
        opacity: resolved ? 0.55 : ghost ? 0.8 : (isHead ? 1 : 0.85),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-end",
        textAlign: "right",
      }}
    >
      {ghost && reservationOrder != null && (
        <div style={{
          position: "absolute", top: 2, left: 4,
          background: "#e8472b", color: "#e8e4da",
          minWidth: 14, height: 14,
          fontSize: 9, fontWeight: 800, lineHeight: "14px",
          textAlign: "center", padding: "0 2px",
        }}>{reservationOrder}</div>
      )}
      <div style={queueBoxName}>{label}</div>
      <div style={queueBoxMeta}>
        {resolved ? "発動済"
          : ghost ? `予約 · ${durSen}閃`
          : isRest ? "HP+1"
          : isHead ? `あと ${secToSen(Math.max(0, endRel)).toFixed(1)}閃`
          : `${durSen}閃`}
      </div>
    </div>
  );
}

export function dim(hex: string, k: number): string {
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

// Block samples come from sim/predict — same type as PredictResult.p0/p1.
interface BlockSample { t: number; block: number; }

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
  history, future, offset, side, nowSec, maxSec, hidden,
}: {
  history: { t: number; block: number }[];
  future: BlockSample[];
  /** pred.baseSec - now: shifts the cached absolute-time prediction to NOW-relative. */
  offset: number;
  side: "opp" | "self";
  nowSec: number;
  maxSec: number;
  hidden?: boolean;
}) {
  const futureSamples = future;
  if (futureSamples.length < 1 && history.length === 0) return null;

  // flat 塗り + 1px 縁 (設計言語: 相手=藍鉄系 / 自分=青磁系)。
  const color = side === "opp"
    ? (hidden ? "rgba(100, 140, 180, 0.08)" : "rgba(100, 140, 180, 0.30)")
    : (hidden ? "rgba(120, 170, 140, 0.08)" : "rgba(120, 170, 140, 0.30)");
  const stroke = side === "opp"
    ? (hidden ? "rgba(100, 140, 180, 0.25)" : "#7da3c4")
    : (hidden ? "rgba(120, 170, 140, 0.25)" : "#8fbf9f");
  // Snap to integer pixels — without this, the polygon's X positions
  // drift sub-pixel each frame (PX_PER_SEC * 1/60 ≈ 0.58 px/frame), and
  // SVG anti-aliasing shimmers visibly along the edges. Block values are
  // already integers from the sim, so Y is naturally crisp too.
  const yForBlock = (b: number) => {
    const h = blockHeight(b);
    return Math.round(side === "opp" ? BLOCK_OUTER_Y_OPP + h : BLOCK_OUTER_Y_SELF - h);
  };
  const xForRel = (relSec: number) =>
    Math.round(NOW_OFFSET + Math.max(-HISTORY_SEC, relSec) * PX_PER_SEC);
  const outerY = side === "opp" ? BLOCK_OUTER_Y_OPP : BLOCK_OUTER_Y_SELF;
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
  // The "current" sample (at t = 0) is the latest HISTORY value — that's
  // the player's real block right now. (The prediction's own t=0 sample
  // may be a few frames stale since it's cached; history is always live.)
  const currentBlock = history.length > 0
    ? history[history.length - 1].block
    : (futureSamples[0]?.block ?? 0);
  // Add a t=0 sample if missing, so the past extends right up to NOW.
  if (rel[rel.length - 1].t < 0) {
    rel.push({ t: 0, block: currentBlock });
  }
  // Append future samples, shifted from prediction-relative to NOW-relative
  // time. Samples that have already slid into the past (t <= 0) are dropped
  // — the live blockHistory covers that region.
  for (let i = 0; i < futureSamples.length; i++) {
    const s = futureSamples[i];
    const t = s.t + offset;
    if (t <= 0) continue;
    if (t > maxSec) break;
    rel.push({ t, block: s.block });
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
        fill="none" stroke={stroke} strokeWidth={1} opacity={hidden ? 0.4 : 0.9}
        shapeRendering="crispEdges"
      />
    </>
  );
}

// Poison area: GREEN band growing OUTWARD from the block band's outer
// edge (opp grows up, self grows down). Same pixel scale as a pierce mark
// so it reads as "incoming HP damage". Capped slightly under OUTER_BAND
// so labels still have room.
const PIERCE_PX_PER_UNIT = 1.5;
const PIERCE_MAX_EXTEND = Math.min(40, OUTER_BAND - 12);

function PoisonArea({
  currentPoison, future, offset, side, maxSec, hidden,
}: {
  currentPoison: number;
  future: { t: number; poison: number }[];
  /** pred.baseSec - now: shifts the cached absolute-time prediction to NOW-relative. */
  offset: number;
  side: "opp" | "self";
  maxSec: number;
  hidden?: boolean;
}) {
  if (currentPoison <= 0 && future.every((s) => s.poison <= 0)) return null;
  const color = hidden ? "rgba(110, 150, 90, 0.12)" : "rgba(110, 150, 90, 0.35)"; // 苔
  const stroke = hidden ? "rgba(110, 150, 90, 0.3)" : "#8aa56a";
  const outerY = side === "opp" ? BLOCK_OUTER_Y_OPP : BLOCK_OUTER_Y_SELF;
  // Past portion: flat at currentPoison from history-left to NOW.
  const xForT = (t: number) =>
    Math.round(NOW_OFFSET + t * PX_PER_SEC);
  const yForPoison = (p: number) => {
    const h = Math.min(PIERCE_MAX_EXTEND, p * PIERCE_PX_PER_UNIT);
    return Math.round(side === "opp" ? outerY - h : outerY + h);
  };
  const leftPastX = NOW_OFFSET + (-HISTORY_SEC) * PX_PER_SEC;
  const points: string[] = [];
  points.push(`${Math.round(leftPastX)},${outerY}`);
  points.push(`${Math.round(leftPastX)},${yForPoison(currentPoison)}`);
  points.push(`${NOW_OFFSET},${yForPoison(currentPoison)}`);
  // Future samples: step polygon at each transition (shifted to NOW-relative).
  let last = currentPoison;
  for (let i = 0; i < future.length; i++) {
    const s = future[i];
    const t = s.t + offset;
    if (t > maxSec) break;
    if (t <= 0) continue;
    if (s.poison !== last) {
      points.push(`${xForT(t)},${yForPoison(last)}`);
      points.push(`${xForT(t)},${yForPoison(s.poison)}`);
      last = s.poison;
    }
  }
  const rightX = xForT(maxSec);
  points.push(`${rightX},${yForPoison(last)}`);
  points.push(`${rightX},${outerY}`);
  return (
    <>
      <polygon points={points.join(" ")} fill={color} stroke="none" shapeRendering="crispEdges" />
      <polyline points={points.slice(1, -1).join(" ")} fill="none" stroke={stroke} strokeWidth={1.5} shapeRendering="crispEdges" opacity={hidden ? 0.5 : 0.9} />
    </>
  );
}

// Pierce marks: red bars + label "貫N" where an attack's HP-side damage
// landed. Derived from the sim prediction (we ran the reducer forward,
// recorded each frame's HP delta against block delta).
function PierceMarks({
  events, offset, side,
}: {
  events: { t: number; hpLost: number }[];
  /** pred.baseSec - now: shifts the cached absolute-time prediction to NOW-relative. */
  offset: number;
  side: "opp" | "self";
}) {
  if (events.length === 0) return null;
  const outerY = side === "opp" ? BLOCK_OUTER_Y_OPP : BLOCK_OUTER_Y_SELF;
  return (
    <>
      {events.map((e, i) => {
        const t = e.t + offset;
        if (t < 0) return null; // already happened — history shows the result
        const x = Math.round(NOW_OFFSET + t * PX_PER_SEC);
        const len = Math.min(PIERCE_MAX_EXTEND, e.hpLost * PIERCE_PX_PER_UNIT);
        const y2 = side === "opp" ? outerY - len : outerY + len;
        const labelY = side === "opp" ? y2 - 2 : y2 + 9;
        return (
          <g key={i}>
            <line
              x1={x} y1={outerY} x2={x} y2={y2}
              stroke="#ff5252" strokeWidth={3} opacity={0.95}
              shapeRendering="crispEdges"
            />
            <text
              x={x + 3} y={labelY}
              fill="#ff5252" fontSize={9}
              fontFamily="ui-monospace, monospace" opacity={0.95}
            >貫{Math.round(e.hpLost)}</text>
          </g>
        );
      })}
    </>
  );
}

// Numeric labels at every block transition (gain AND loss). Walks
// (sample[i-1], sample[i]) pairs in history + prediction; whenever block
// jumps, drop a "newBlockValue" label at that point on the trajectory
// curve. Gains use green, losses (attack absorbed) use light blue so the
// player can read "5→14" (gained from Defend) vs "20→8" (took 12 damage).
function BlockChangeLabels({
  history, future, offset, side, nowSec, maxSec, hidden,
}: {
  history: { t: number; block: number }[];
  future: BlockSample[];
  /** pred.baseSec - now: shifts the cached absolute-time prediction to NOW-relative. */
  offset: number;
  side: "opp" | "self";
  nowSec: number;
  maxSec: number;
  hidden?: boolean;
}) {
  if (hidden) return null;
  type Change = { t: number; newBlock: number; gain: boolean };
  const changes: Change[] = [];
  // Past: walk blockHistory (absolute t).
  for (let i = 1; i < history.length; i++) {
    const cur = history[i], prev = history[i - 1];
    if (cur.block === prev.block) continue;
    const r = cur.t - nowSec;
    if (r < -HISTORY_SEC) continue;
    changes.push({ t: r, newBlock: cur.block, gain: cur.block > prev.block });
  }
  // Future: walk prediction samples (shifted to NOW-relative).
  for (let i = 1; i < future.length; i++) {
    const cur = future[i], prev = future[i - 1];
    if (cur.block === prev.block) continue;
    const t = cur.t + offset;
    if (t <= 0) continue; // already happened — the history pass labels it
    if (t > maxSec) break;
    changes.push({ t, newBlock: cur.block, gain: cur.block > prev.block });
  }
  if (changes.length === 0) return null;
  const outerY = side === "opp" ? BLOCK_OUTER_Y_OPP : BLOCK_OUTER_Y_SELF;
  const yFor = (b: number) => {
    const h = Math.min(BLOCK_HALF, blockHeight(b));
    return Math.round(side === "opp" ? outerY + h : outerY - h);
  };
  return (
    <>
      {changes.map((g, i) => {
        const x = Math.round(NOW_OFFSET + g.t * PX_PER_SEC);
        const y = yFor(g.newBlock);
        // Label sits just BEYOND the tip (inward, toward the centre axis).
        const labelY = side === "opp" ? y + 10 : y - 3;
        return (
          <g key={i}>
            <text
              x={x + 3} y={labelY}
              fill={g.gain ? "#7fe3a4" : "#9ec8ff"} fontSize={11} fontWeight={700}
              fontFamily="ui-monospace, monospace"
            >{g.newBlock}</text>
          </g>
        );
      })}
    </>
  );
}

// Numeric labels at every poison transition (gain or decay). Predicted
// only — no poisonHistory in sim state — but past poison is shown by the
// PoisonArea as a flat band at currentPoison, so any label outside the
// prediction would be misleading.
function PoisonChangeLabels({
  currentPoison, future, offset, side, maxSec, hidden,
}: {
  currentPoison: number;
  future: { t: number; poison: number }[];
  /** pred.baseSec - now: shifts the cached absolute-time prediction to NOW-relative. */
  offset: number;
  side: "opp" | "self";
  maxSec: number;
  hidden?: boolean;
}) {
  if (hidden) return null;
  type Change = { t: number; newPoison: number; gain: boolean };
  const changes: Change[] = [];
  let last = currentPoison;
  for (let i = 0; i < future.length; i++) {
    const cur = future[i];
    const t = cur.t + offset;
    if (t > maxSec) break;
    if (t <= 0) continue;
    if (cur.poison !== last) {
      changes.push({ t, newPoison: cur.poison, gain: cur.poison > last });
      last = cur.poison;
    }
  }
  if (changes.length === 0) return null;
  const outerY = side === "opp" ? BLOCK_OUTER_Y_OPP : BLOCK_OUTER_Y_SELF;
  const yForPoison = (p: number) => {
    const h = Math.min(PIERCE_MAX_EXTEND, p * PIERCE_PX_PER_UNIT);
    return Math.round(side === "opp" ? outerY - h : outerY + h);
  };
  return (
    <>
      {changes.map((g, i) => {
        const x = Math.round(NOW_OFFSET + g.t * PX_PER_SEC);
        const y = yForPoison(g.newPoison);
        // Place label BEYOND the tip (outward — opposite side of the block
        // labels which sit inward).
        const labelY = side === "opp" ? y - 3 : y + 10;
        return (
          <g key={i}>
            <text
              x={x + 3} y={labelY}
              fill={g.gain ? "#5fc870" : "#6fa080"} fontSize={11} fontWeight={700}
              fontFamily="ui-monospace, monospace"
            >毒{g.newPoison}</text>
          </g>
        );
      })}
    </>
  );
}

const battleZone: React.CSSProperties = {
  position: "relative",
  display: "flex", flexDirection: "column",
  background: "#141417",
  border: "1px solid rgba(232,228,218,0.12)",
  borderRadius: 2,
  padding: 8,
};
// Row ownership tag (相手/自分) pinned to the timeline's left edge.
const rowTag: React.CSSProperties = {
  position: "absolute", left: 14, zIndex: 6,
  fontSize: 10, fontWeight: 700, letterSpacing: 2,
  padding: "2px 6px", borderRadius: 4,
  background: "rgba(10, 10, 16, 0.75)",
  pointerEvents: "none",
};
const scrollWrap: React.CSSProperties = {
  position: "relative", width: "100%",
  overflowX: "auto", overflowY: "hidden",
  background: "rgba(0,0,0,0.30)",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.05)",
};
const timelineInner: React.CSSProperties = { position: "relative" };
// 「今」— 朱の刃。斜め切りで刃先を示す。
const nowDivider: React.CSSProperties = {
  position: "absolute", width: 36, height: 17, lineHeight: "17px",
  fontSize: 11, color: "#e8e4da", letterSpacing: 0, fontWeight: 800,
  fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", serif', textAlign: "center",
  background: "#e8472b",
  clipPath: "polygon(0 0, 100% 0, 100% 100%, 14% 100%)",
  pointerEvents: "none", zIndex: 4,
};
const nowLine: React.CSSProperties = {
  position: "absolute", top: 0, width: 2,
  background: "#e8472b",
  zIndex: 3,
};
const idleHint: React.CSSProperties = {
  position: "absolute", left: NOW_OFFSET + 8,
  fontSize: 11, opacity: 0.4, fontStyle: "italic",
};
const queueBoxName: React.CSSProperties = { fontWeight: 700, fontSize: 12, lineHeight: 1.1, textShadow: "0 1px 2px rgba(0,0,0,0.8)" };
const queueBoxMeta: React.CSSProperties = { fontSize: 10, opacity: 0.9, fontFamily: "ui-monospace, monospace", marginTop: 2 };

