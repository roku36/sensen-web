// Tunable game rules.
//
// Cast-time model (v2): there is no energy resource. Each card's `cost`
// value (in CardDef) is now its CAST TIME in seconds. When you click a card,
// it leaves your hand and goes into a cast slot; after `cost` seconds the
// effect resolves, the card goes to the discard pile, and one new card is
// drawn to refill the hand. Only one cast at a time per player. Both
// players' cast progress is publicly visible — read the opponent's cast bar
// to plan your next move.

// ── Vitals ──
export const INITIAL_HP = 80;
// Hand is fixed at 6 slots. We start dealt to 5 so there's an immediately
// available Draw target (slot 6) the player can practice with.
export const MAX_HAND_SIZE = 6;
export const INITIAL_HAND = 5;

// ── 閃 (sen) unit / 時間の単位 ──
//
// **シムに小数は存在しない。** 時刻も長さもすべて FRAME (整数) で表す。
// 1閃 = FRAMES_PER_SEN フレーム、カード定義の cost・prereq・持続はすべて
// 整数の閃。秒はUIが人間に見せるためだけの単位であり、描画境界
// (framesToSec) でのみ使う — シムの内部・状態・チェックサムには
// 一切入れない。
//
// 経緯: 以前は「シムは秒 (frame×1/60)、ただし厳密な比較だけフレーム」
// という二重表現だった。単位が混ざると必ず片方が漏れる — 実際、常在型
// パワーの「毎秒レート×dt」が整数のHP/ブロックを小数にし、金属化は
// 端数が毎フレーム丸め捨てられて完全に無効化していた。単位を一つに
// 畳めば、この種のバグは書けなくなる。
export const SEC_PER_SEN = 3;

// ── Block ──
// Block decays in DISCRETE 1-unit steps, one tick per 閃 (= SEC_PER_SEN sec).
// When block changes (gain or hit), the decay timer is reset to "1 閃 from
// now" so a fresh stack always has a full 閃 before the first decrement.
export const BLOCK_DECAY_SEN_PER_STEP = 1;

// ── Poison ──
// Poison ticks once per 閃: deals (current poison) HP damage IGNORING block,
// then decrements poison by 1. Total damage from N poison = N*(N+1)/2.
// Heal cards subtract their amount from poison too.
export const POISON_DECAY_SEN_PER_STEP = 1;

// ── 休息 (auto-rest) ──
// キューと予約が空のとき、シムが自動で積む既定行動。1閃かけて HP を
// REST_HEAL 回復し、連閃をリセットする。「キューは決して空白にならない」
// 不変条件の担い手 (docs/game-design.md)。
export const REST_HEAL = 1;

// ── 連閃 (combo chain) ──
// Each consecutively-resolved CARD beyond the first adds +1 attack damage,
// capped here. A resolving Draw entry resets the chain — refilling costs
// momentum, not just cast time.
export const RENZAN_MAX_BONUS = 5;

// ── Draw action ──
// Pressing the Draw button appends a draw entry to the queue with duration =
// (count) × DRAW_SEN_PER_CARD 閃. Slot k fills castStartedAt + (k+1) 閃 in.
export const DRAW_SEN_PER_CARD = 1;

// Bounded history of recently-resolved cards.
export const RESOLVED_HISTORY_MAX = 8;

// How far back to keep per-player block samples for the UI's past
// visualization. Anything older gets pruned. Matches the timeline's
// visible HISTORY budget so the past area always has data to draw.
export const BLOCK_HISTORY_SEN = 6;

// 完全対称 (perfect symmetry): both players share the SAME 閃 grid with no
// offset. There is no first/second player — identical decks + identical
// inputs produce a mirror match that ends in a draw. Simultaneous lethal
// resolutions are a draw (result decided after the frame's bus drains).
// This alignment is what makes same-boundary interactions (パリィ等) a
// well-defined design space.

// ── 烈閃 (surge 閃) ──
// Attack cards RESOLVING during a surge 閃 deal this much bonus damage
// (applied once per card, not per multi-hit). Schedule is derived from the
// matchSeed — see sim/events.ts.
export const RETSU_SEN_BONUS = 4;

// ── サドンデス (焦土) ──
// From SUDDEN_DEATH_START_SEN onward, BOTH players take escalating damage
// every 閃 (ignores block, like poison). Symmetric environmental pressure:
// guarantees every match ends, punishes turtling, and adds late-game
// urgency without touching either player's plan.
//   damage per 閃 = 1 + floor(elapsed_sen_since_start / SUDDEN_DEATH_RAMP_SEN)
export const SUDDEN_DEATH_START_SEN = 30;
export const SUDDEN_DEATH_RAMP_SEN = 10;

// ── Card return policy ──
// Slay-style: played cards go to the discard pile after their cast resolves.
export const PLAYED_TO_DISCARD = true;

// ── Sim cadence ──
// SIM_HZ is the frame rate; the frame is the sim's ONLY clock. Every time
// value in GameState is a frame count or a frame duration — integers.
export const SIM_HZ = 60;
export const FRAMES_PER_SEN = SEC_PER_SEN * SIM_HZ;
export const senToFrames = (sen: number) => sen * FRAMES_PER_SEN;

// 「決して起きない」時刻の番兵。Infinity は小数 (非整数) なので使わない
// — 整数のまま比較・チェックサム・シリアライズできる値にする。
export const NEVER_FRAME = 0x7fffffff;

// 描画境界でだけ使う変換。シムの中では絶対に呼ばない。
export const framesToSec = (frames: number) => frames / SIM_HZ;

// ── Rollback ──
export const INPUT_DELAY = 6;
export const MAX_ROLLBACK = 120;
