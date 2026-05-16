// Compact binary frames sent over the WebRTC DataChannel.
//
//   [0]  tag
//   tag=0 Input:    u32 frame, u16 flags          (7 B)
//   tag=1 Checksum: u32 frame, u64 hash           (13 B)
//   tag=2 Deck:     u16 count, u16 cardId * count (3 + 2N B)
//
// Deck is sent ONCE during handshake, before initGame, so each peer can
// build identical InitOptions (deckP0, deckP1) for the deterministic sim.

import { CardId } from "../sim/cards";

export type WireFrame =
  | { kind: "input"; frame: number; flags: number }
  | { kind: "checksum"; frame: number; hash: bigint }
  | { kind: "deck"; cards: CardId[] };

const TAG_INPUT = 0;
const TAG_CHECKSUM = 1;
const TAG_DECK = 2;

export function encode(frame: WireFrame): ArrayBuffer {
  if (frame.kind === "input") {
    const buf = new ArrayBuffer(1 + 4 + 2);
    const v = new DataView(buf);
    v.setUint8(0, TAG_INPUT);
    v.setUint32(1, frame.frame >>> 0, true);
    v.setUint16(5, frame.flags & 0xffff, true);
    return buf;
  }
  if (frame.kind === "checksum") {
    const buf = new ArrayBuffer(1 + 4 + 8);
    const v = new DataView(buf);
    v.setUint8(0, TAG_CHECKSUM);
    v.setUint32(1, frame.frame >>> 0, true);
    v.setBigUint64(5, frame.hash, true);
    return buf;
  }
  // deck
  const n = frame.cards.length;
  const buf = new ArrayBuffer(1 + 2 + n * 2);
  const v = new DataView(buf);
  v.setUint8(0, TAG_DECK);
  v.setUint16(1, n, true);
  for (let i = 0; i < n; i++) v.setUint16(3 + i * 2, frame.cards[i] & 0xffff, true);
  return buf;
}

export function decode(data: ArrayBuffer | string): WireFrame | null {
  if (typeof data === "string") return null;
  const v = new DataView(data);
  if (v.byteLength < 1) return null;
  const tag = v.getUint8(0);
  if (tag === TAG_INPUT && v.byteLength >= 7) {
    return { kind: "input", frame: v.getUint32(1, true), flags: v.getUint16(5, true) };
  }
  if (tag === TAG_CHECKSUM && v.byteLength >= 13) {
    return { kind: "checksum", frame: v.getUint32(1, true), hash: v.getBigUint64(5, true) };
  }
  if (tag === TAG_DECK && v.byteLength >= 3) {
    const n = v.getUint16(1, true);
    if (v.byteLength < 3 + n * 2) return null;
    const cards: CardId[] = [];
    for (let i = 0; i < n; i++) cards.push(v.getUint16(3 + i * 2, true) as CardId);
    return { kind: "deck", cards };
  }
  return null;
}
