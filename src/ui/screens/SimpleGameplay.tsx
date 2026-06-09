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

import { useEffect, useMemo, useRef, useState } from "react";
import { CardEffect, CardId, CardType, getCardDef } from "../../sim/cards";
import {
  cardFlag, INPUT_DRAW, INPUT_RESERVE_DRAW, reserveCardFlag,
} from "../../sim/input";
import { predictForward } from "../../sim/predict";
import { canReserveCard, futureEmptyAtDrawPosition } from "../../sim/reducer";
import {
  DRAW_SEN_PER_CARD, DT, FRAMES_PER_SEN, MAX_HAND_SIZE, SEC_PER_SEN, secToSen, senToSec,
} from "../../sim/rules";
import { GameState, PlayerState, ResolvedEntry } from "../../sim/state";

import { advanceFrames, getActiveMode, getSession, useKeyboardInput } from "../hooks";
import { useStore } from "../store";
import { PilePeek } from "./PilePeek";
import { ResultPanel } from "./ResultPanel";

const AI_LABEL: Record<string, string> = {
  passive: "なし",
  lv1: "Lv1 ランダム", lv2: "Lv2 テンポ型", lv3: "Lv3 読み型", lv4: "Lv4 先読み型",
  // legacy keys from older saved settings
  random: "Lv1 ランダム", greedyDefense: "Lv2 テンポ型", greedyAttack: "Lv2 テンポ型", heuristic: "Lv3 読み型",
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
        <span style={{ opacity: 0.6, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
          第{Math.floor(game.frame / FRAMES_PER_SEN)}閃
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

function countCards(hand: (number | null)[]): number {
  let n = 0;
  for (const c of hand) if (c !== null) n++;
  return n;
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
      sig += q.kind === "card"
        ? "c" + q.cardId + ":" + q.duration
        : "d" + q.drawSlots.join(".") + ":" + q.drawFilledCount;
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

function BattleZone({ game, op, me, now }: { game: GameState; op: PlayerState; me: PlayerState; now: number }) {
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
                  fontSize: 9, fontWeight: 700, color: "#ffe066",
                  background: "rgba(40,34,8,0.9)", border: "1px solid rgba(255,224,102,0.5)",
                  padding: "0 4px", borderRadius: 3, whiteSpace: "nowrap",
                  transform: "translateX(-50%)",
                }}>確定</div>
                <div style={{
                  position: "absolute", left: 0, top: 14, width: 1, height: BOX_HEIGHT + 14,
                  background: "rgba(255,224,102,0.55)",
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
  cardId: number | null;     // null for draw entries
  drawSlots?: number[] | null;
  drawFilledCount?: number;
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

function QueueBox({ cardId, drawSlots, drawFilledCount, duration, startRel, endRel, isHead, yTop, resolved, ghost, reservationOrder }: BoxLayout & { yTop: number }) {
  const isDraw = drawSlots != null;
  const def = !isDraw && cardId != null ? getCardDef(cardId) : null;

  const baseColor = isDraw ? "#2c5b8e"
    : def?.cardType === CardType.Attack ? "#e3553c"
    : def?.cardType === CardType.Power ? "#b465e0"
    : "#5fa0e0";
  // Resolved chips and ghost reservations both render dimmed.
  const color = resolved ? dim(baseColor, 0.45) : ghost ? dim(baseColor, 0.6) : baseColor;
  const left = NOW_OFFSET + startRel * PX_PER_SEC;
  const w = duration * PX_PER_SEC;
  const glow = !resolved && !ghost && isHead && endRel < 0.4;
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
        // transform (not left/top) so the per-frame ~0.6px slide is GPU-
        // composited with sub-pixel interpolation instead of relayouting
        // and snapping to whole pixels — the chips glide instead of
        // juddering.
        left: 0, top: 0,
        transform: `translate3d(${left}px, ${yTop}px, 0)`,
        width: w, height: BOX_HEIGHT,
        background: color,
        // Ghost: dashed yellow-tinted border so it visually reads as
        // "reserved, not yet committed".
        border: ghost
          ? `2px dashed rgba(255, 224, 102, 0.85)`
          : `2px solid ${glow ? "#fff" : color}`,
        boxSizing: "border-box",
        boxShadow: glow
          ? `0 0 ${10 + 20 * glowIntensity}px rgba(255,255,200,${0.4 + 0.5 * glowIntensity})`
          : resolved || ghost ? "none" : "0 2px 6px rgba(0,0,0,0.4)",
        borderRadius: 6,
        padding: "3px 8px",
        color: ghost ? "rgba(255, 224, 102, 0.85)" : resolved ? "rgba(255,255,255,0.55)" : "white",
        overflow: "hidden",
        opacity: resolved ? 0.55 : ghost ? 0.45 : (isHead ? 1 : 0.85),
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
          background: "#ffe066", color: "#1a1a22",
          width: 14, height: 14, borderRadius: 999,
          fontSize: 9, fontWeight: 700, lineHeight: "14px",
          textAlign: "center",
        }}>{reservationOrder}</div>
      )}
      <div style={queueBoxName}>{label}</div>
      <div style={queueBoxMeta}>
        {resolved ? "発動済"
          : ghost ? `予約 · ${durSen}閃`
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
        fill="none" stroke={stroke} strokeWidth={1.5} opacity={hidden ? 0.4 : 0.85}
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
  const color = hidden
    ? "rgba(95, 200, 110, 0.18)"
    : "rgba(95, 200, 110, 0.55)";
  const stroke = hidden ? "rgba(95, 200, 110, 0.35)" : "#5fc870";
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
                    background: "#ffb347",
                  }} />
                </div>
                <div style={{
                  position: "absolute", right: 4, bottom: 6,
                  fontSize: 9, color: "#ffb347", fontWeight: 700,
                  textShadow: "0 1px 2px black",
                }}>熟成まで {remainSen.toFixed(1)}閃</div>
              </div>
            );
          })()
        )}
        <div style={{ ...cardCostStyle, color: clickable ? "#ffe580" : "#cfd6e0" }}>
          {unplayable ? "✗" : def.cost + "閃"}
          {(def.prereqQueueTime ?? 0) > 0 && (
            <span style={{ fontSize: 10, marginLeft: 4, color: prereqOk ? "#80ffa0" : "#ff9a40" }}>
              要{def.prereqQueueTime}閃
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
function AdvanceButton() {
  const beginner = useStore((s) => s.beginnerMode);
  const mode = getActiveMode();
  if (!beginner || mode !== "offline") return null;
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
  position: "relative",
  display: "flex", flexDirection: "column",
  background: "rgba(40, 30, 60, 0.25)",
  border: "1px solid rgba(110, 80, 170, 0.35)",
  borderRadius: 10,
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
