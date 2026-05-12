// Compact binary frames sent over the WebRTC DataChannel.
//
//   [0]  tag  (0=Input, 1=Checksum)
//   Input:    u32 frame, u16 flags
//   Checksum: u32 frame, u64 hash

export type WireFrame =
  | { kind: "input"; frame: number; flags: number }
  | { kind: "checksum"; frame: number; hash: bigint };

const TAG_INPUT = 0;
const TAG_CHECKSUM = 1;

export function encode(frame: WireFrame): ArrayBuffer {
  if (frame.kind === "input") {
    const buf = new ArrayBuffer(1 + 4 + 2);
    const v = new DataView(buf);
    v.setUint8(0, TAG_INPUT);
    v.setUint32(1, frame.frame >>> 0, true);
    v.setUint16(5, frame.flags & 0xffff, true);
    return buf;
  }
  const buf = new ArrayBuffer(1 + 4 + 8);
  const v = new DataView(buf);
  v.setUint8(0, TAG_CHECKSUM);
  v.setUint32(1, frame.frame >>> 0, true);
  v.setBigUint64(5, frame.hash, true);
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
  return null;
}
