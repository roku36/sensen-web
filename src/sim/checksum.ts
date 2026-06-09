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

// Fixed-point quantization for floats so tiny rounding doesn't trigger desync flags.
// Granularity 1/1024 is finer than any meaningful HP/cost difference.
const f = (x: number) => {
  const q = Math.round(x * 1024);
  // Two's complement encoding via bit cast.
  const v = q < 0 ? (q + 0x100000000) : q;
  u32(v >>> 0);
};

const opt = <T>(v: T | null, write: (v: T) => void) => { byte(v ? 1 : 0); if (v) write(v); };

function hashPlayer(p: PlayerState) {
  u32(p.handle);
  f(p.hp); f(p.hpMax);
  // block is now an integer; encode directly. nextBlockDecayAt is fixed-pt.
  u32(p.block | 0);
  f(isFinite(p.nextBlockDecayAt) ? p.nextBlockDecayAt : 1e9);
  u32(p.blockHistory.length);
  for (const h of p.blockHistory) { f(h.t); u32(h.block | 0); }
  u32(p.poison | 0);
  f(isFinite(p.nextPoisonDecayAt) ? p.nextPoisonDecayAt : 1e9);
  f(p.thorns);
  u32(p.renzan | 0);
  u32(p.queue.length);
  for (const q of p.queue) {
    if (q.kind === "card") {
      byte(0); u32(q.cardId); f(q.duration); byte(q.blockApplied ? 1 : 0);
    } else {
      byte(1); f(q.duration); u32(q.drawFilledCount);
      u32(q.drawSlots.length);
      for (const s of q.drawSlots) u32(s);
    }
  }
  f(p.castStartedAt);
  u32(p.resolvedCards.length);
  for (const r of p.resolvedCards) { u32(r.cardId); f(r.duration); f(r.resolvedAt); }
  // Manual reservations: ordered list of typed entries (card | draw).
  u32(p.reservations.length);
  for (const r of p.reservations) {
    if (r.kind === "card") { byte(0); u32(r.slotIndex); }
    else { byte(1); }
  }
  // openedAt — null is a sentinel ("hasn't acted yet").
  byte(p.openedAt === null ? 0 : 1);
  if (p.openedAt !== null) f(p.openedAt);
  f(p.strength); f(p.vulnerableSecs); f(p.weakSecs);
  opt(p.rage, (r) => { f(r.blockPerAttack); f(r.remaining); });
  opt(p.metallicize, (m) => { f(m.blockPerSec); });
  opt(p.demonForm, (d) => { f(d.strengthPerSec); f(d.accumulated); });
  byte(p.barricade ? 1 : 0);
  opt(p.juggernaut, (j) => { f(j.damageOnBlock); });
  opt(p.combust, (c) => { f(c.selfPerSec); f(c.enemyPerSec); });
  opt(p.darkEmbrace, (d) => { u32(d.drawOnExhaust); });
  opt(p.evolve, (e) => { u32(e.drawOnStatus); });
  opt(p.feelNoPain, (f2) => { f(f2.blockOnExhaust); });
  opt(p.fireBreathing, (f2) => { f(f2.damageOnStatusDraw); });
  opt(p.rupture, (r) => { f(r.strengthOnSelfDmg); });
  byte(p.corruption ? 1 : 0);
  opt(p.brutality, (b) => { f(b.selfPerSec); u32(b.draw); f(b.interval); f(b.timer); });
  u32(p.deck.length); for (const c of p.deck) u32(c);
  // Hand is fixed length 6 with null = empty. Encode null as a sentinel.
  u32(p.hand.length);
  for (const c of p.hand) u32(c === null ? 0xffffffff : c);
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
