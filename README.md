# sensen-web

[Sensen](https://github.com/roku36/sensen) (a Bevy/Rust real-time card game) ported to the web with **React Three Fiber** and a hand-rolled **rollback netcode + WebRTC P2P** stack.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. Click **Practice (offline)** for solo play, or **Find Match (online)** to pair via a [matchbox](https://github.com/johanhelsing/matchbox) signaling server.

```bash
# matchbox-server (defaults to ws://localhost:3536/sensen?next=2)
docker run -p 3536:3536 ghcr.io/johanhelsing/matchbox_server
# or: cargo install matchbox_server && matchbox_server
```

## Architecture

| Layer | Where | What |
|---|---|---|
| Pure deterministic reducer | `src/sim/` | Cards, deck (LCG-shuffle bit-identical to the Rust source), cost, HP, block, thorns, all status effects and powers. `step(state, p0in, p1in, dt)` is referentially transparent. |
| Rollback engine | `src/net/rollback.ts` | Snapshot-per-frame, input-prediction, resimulate-on-correction, frame-advantage stall, FNV-1a-64 state checksum. |
| P2P transport | `src/net/matchbox.ts`, `wire.ts`, `session.ts` | Speaks the [`matchbox_protocol`](https://crates.io/crates/matchbox_protocol) JSON wire format. WebRTC unreliable DataChannel. |
| Offline session | `src/net/offline.ts` | Single-peer fixed-step loop for practice mode. |
| 3D rendering | `src/ui/scene/` | React Three Fiber + drei. |
| Screens | `src/ui/screens/` | Title / Lobby / Gameplay. |
| Tests | `test/` | Vitest determinism + cross-peer consistency. Real-browser P2P harness in `test/integration/p2p-browser.mjs` (Playwright). |

## How P2P consistency is guaranteed

Both peers run the **same pure reducer** on the **same inputs in the same order**. The reducer's only RNG is a u64 LCG (`6364136223846793005 * state + 1`) seeded from the match seed and player handle — bit-identical to the Bevy source. State changes are funneled through a sorted message bus inside one frame, so message ordering is stable across machines.

Each peer:

1. Buffers local input with `INPUT_DELAY` frames of input delay (6 @ 60Hz).
2. Sends every frame's input to the peer (even empty frames, so the peer's prediction is never starved).
3. Predicts the remote's input as "no press" if no confirmation has arrived.
4. On every confirmed-input message, if the prediction was wrong, restores the snapshot at that frame and re-steps forward — bounded by `MAX_ROLLBACK = 120` frames (2 s).
5. Stalls itself if it gets more than 30 frames ahead of the remote's confirmed inputs (frame-advantage cap) — keeps rollback distance bounded under jitter.
6. Hashes its confirmed state every 30 frames and exchanges the hash with the peer; a mismatch surfaces as a `desync` event and the match halts rather than silently drifting.

## Tests

```bash
npm test                                   # vitest: 13 unit + cross-peer tests
node test/integration/matchbox-live.mjs    # live signaling roundtrip against running matchbox-server
node test/integration/p2p-browser.mjs      # 2 real Chromium tabs over real WebRTC, asserts checksum equality at sampled past frames
```
