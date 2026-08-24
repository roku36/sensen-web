// Compact deterministic checksum over GameState. Used to detect desync between peers.
// FNV-1a 64 over a fixed-order serialization of all rollback-relevant fields.

import type { GameState, PlayerState } from "./state";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

let H: bigint = FNV_OFFSET;

const reset = () => { H = FNV_OFFSET; };
const byte = (b: number) => { H = ((H ^ BigInt(b & 0xff)) * FNV_PRIME) & MASK; };

const u32 = (n: number) => {
  const v = n >>> 0;
  byte(v & 0xff); byte((v >>> 8) & 0xff); byte((v >>> 16) & 0xff); byte((v >>> 24) & 0xff);
};

const u64 = (b: bigint) => {
  let v = b & MASK;
  for (let i = 0; i < 8; i++) { byte(Number(v & 0xffn)); v >>= 8n; }
};

// 状態はすべて整数なので、量子化 (旧: 1/1024 固定小数) は不要になった。
// 整数をそのまま符号込みで詰める — 「丸め誤差はデサンク扱いしない」という
// 妥協が消え、1 の違いも確実に検出できる。
const i32 = (n: number) => { u32((n | 0) >>> 0); };

const opt = <T>(v: T | null, write: (v: T) => void) => { byte(v ? 1 : 0); if (v) write(v); };

function hashPlayer(p: PlayerState) {
  u32(p.handle);
  i32(p.hp); i32(p.hpMax);
  i32(p.block);
  i32(p.nextBlockDecayFrame);
  u32(p.blockHistory.length);
  for (const h of p.blockHistory) { i32(h.frame); i32(h.block); }
  i32(p.poison);
  i32(p.nextPoisonDecayFrame);
  i32(p.thorns);
  i32(p.renzan);
  u32(p.queue.length);
  for (const q of p.queue) {
    if (q.kind === "card") {
      byte(0); u32(q.cardId); i32(q.durationFrames); byte(q.blockApplied ? 1 : 0);
    } else if (q.kind === "draw") {
      byte(1); i32(q.durationFrames); u32(q.drawFilledCount);
      u32(q.drawSlots.length);
      for (const s of q.drawSlots) u32(s);
    } else {
      byte(2); i32(q.durationFrames); // rest
    }
  }
  i32(p.castStartedAtFrame);
  u32(p.resolvedCards.length);
  for (const r of p.resolvedCards) { u32(r.cardId); i32(r.durationFrames); i32(r.resolvedAtFrame); }
  // Manual reservations: ordered list of typed entries (card | draw).
  u32(p.reservations.length);
  for (const r of p.reservations) {
    if (r.kind === "card") { byte(0); u32(r.slotIndex); }
    else { byte(1); }
  }
  // openedAtFrame — null is a sentinel ("hasn't acted yet").
  byte(p.openedAtFrame === null ? 0 : 1);
  if (p.openedAtFrame !== null) i32(p.openedAtFrame);
  i32(p.strength); i32(p.vulnerableFrames); i32(p.weakFrames);
  opt(p.rage, (r) => { i32(r.blockPerAttack); i32(r.remainingFrames); });
  opt(p.metallicize, (m) => { i32(m.blockPerSen); });
  opt(p.demonForm, (d) => { i32(d.strengthPerSen); });
  byte(p.barricade ? 1 : 0);
  opt(p.juggernaut, (j) => { i32(j.damageOnBlock); });
  opt(p.combust, (c) => { i32(c.selfPerSen); i32(c.enemyPerSen); });
  opt(p.darkEmbrace, (d) => { u32(d.drawOnExhaust); });
  opt(p.evolve, (e) => { u32(e.drawOnStatus); });
  opt(p.feelNoPain, (f2) => { i32(f2.blockOnExhaust); });
  opt(p.fireBreathing, (f2) => { i32(f2.damageOnStatusDraw); });
  opt(p.rupture, (r) => { i32(r.strengthOnSelfDmg); });
  byte(p.corruption ? 1 : 0);
  opt(p.brutality, (b) => { i32(b.selfPerSen); u32(b.draw); });
  u32(p.deck.length); for (const c of p.deck) u32(c);
  // Hand is fixed length 6 with null = empty. Encode null as a sentinel.
  u32(p.hand.length);
  for (const c of p.hand) u32(c === null ? 0xffffffff : c);
  // 熟成 age tracking (integer frames + tracked card per slot).
  for (const a of p.handAge) u32(a);
  for (const c of p.handAgeCard) u32(c === null ? 0xffffffff : c);
  u32(p.discard.length); for (const c of p.discard) u32(c);
  u64(p.rng.state);
}

export function checksum(s: GameState): bigint {
  reset();
  u32(s.frame);
  byte(s.result);
  u64(s.matchSeed);
  hashPlayer(s.players[0]);
  hashPlayer(s.players[1]);
  return H;
}

export const checksumHex = (s: GameState): string =>
  checksum(s).toString(16).padStart(16, "0");
