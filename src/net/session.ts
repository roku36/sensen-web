// Glues the matchbox P2P client to the rollback engine.
//
// When local input is generated, we both apply it locally (delayed by INPUT_DELAY
// frames) AND broadcast it to the peer. The peer does the same. The engine
// reconciles disagreements via rollback.
//
// Every CHECKSUM_INTERVAL frames we exchange a checksum of the confirmed state.
// If the values differ, we emit a "desync" event — that's how we ensure damage,
// HP, deck state, etc. genuinely match between peers.

import { checksum } from "../sim/checksum";
import { CardId } from "../sim/cards";
import { matchSeedFromPeers } from "../sim/rng";
import { DEFAULT_COST_RATE, INITIAL_HP } from "../sim/rules";
import { GameState } from "../sim/state";
import { MatchboxClient, PeerId } from "./matchbox";
import { RollbackEngine, RollbackEvent } from "./rollback";
import { decode, encode } from "./wire";

const CHECKSUM_INTERVAL = 30; // ~0.5s @ 60Hz

export interface SessionOptions {
  signalUrl: string;
  iceServers?: RTCIceServer[];
  deck: CardId[];
  costRate?: number;
  hpMax?: number;
  onState?: (s: GameState) => void;
  onLog?: (line: string) => void;
  onDesync?: (frame: number, local: bigint, remote: bigint) => void;
}

export class Session {
  private mb: MatchboxClient;
  private engine?: RollbackEngine;
  private remote?: PeerId;
  private rafId = 0;
  private last = 0;
  private accumulator = 0;
  private opts: SessionOptions;
  private stopped = false;
  private pendingFlags = 0;
  // Deck handshake: each peer sends their own deck once, waits for peer's.
  private peerDeck: CardId[] | null = null;
  private peerDeckResolve: ((d: CardId[]) => void) | null = null;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.mb = new MatchboxClient({ url: opts.signalUrl, iceServers: opts.iceServers });
  }

  async start() {
    this.mb.on((e) => {
      if (e.kind === "channel-open") {
        this.opts.onLog?.(`channel open with ${e.peer.slice(0, 8)}`);
        this.beginMatch(e.peer);
      } else if (e.kind === "message") {
        this.handleMessage(e.peer, e.data);
      } else if (e.kind === "peer-left") {
        this.opts.onLog?.(`peer left: ${e.peer.slice(0, 8)}`);
        this.stop();
      } else if (e.kind === "peer-joined") {
        this.opts.onLog?.(`peer joined: ${e.peer.slice(0, 8)} — negotiating WebRTC…`);
      } else if (e.kind === "id") {
        this.opts.onLog?.(`assigned id ${e.localId.slice(0, 8)}`);
      } else if (e.kind === "closed") {
        this.opts.onLog?.(`signaling closed`);
      }
    });
    await this.mb.connect();
  }

  // Local input from UI (key press or click). Just OR-accumulates flags for
  // the upcoming frame; the loop drains and broadcasts them every frame.
  pushLocalInput(flags: number) { this.pendingFlags |= flags; }

  private async beginMatch(remote: PeerId) {
    if (this.engine) return;
    this.remote = remote;

    // Send our deck and wait for the peer's. Both sides are symmetric.
    this.opts.onLog?.(`exchanging decks…`);
    this.mb.send(remote, encode({ kind: "deck", cards: this.opts.deck }));
    const peerDeck = await this.waitForPeerDeck();
    if (this.stopped) return;
    this.opts.onLog?.(`peer deck received (${peerDeck.length}枚)`);

    const ids = [this.mb.localId, remote].sort();
    const matchSeed = matchSeedFromPeers(ids);
    const localPlayer: 0 | 1 = ids[0] === this.mb.localId ? 0 : 1;
    // Both peers compute identical {deckP0, deckP1} since they agreed on
    // who is p0 (sorted-id-first) and the deck contents are now mirrored.
    const deckP0 = localPlayer === 0 ? this.opts.deck : peerDeck;
    const deckP1 = localPlayer === 0 ? peerDeck : this.opts.deck;
    this.opts.onLog?.(`match seed=${matchSeed.toString(16)} you=p${localPlayer}`);

    this.engine = new RollbackEngine({
      matchSeed,
      hpMax: this.opts.hpMax ?? INITIAL_HP,
      costRate: this.opts.costRate ?? DEFAULT_COST_RATE,
      deckP0, deckP1,
      localPlayer,
    });
    this.engine.on((ev) => this.onEngineEvent(ev));
    this.last = performance.now();
    this.loop();
  }

  private waitForPeerDeck(): Promise<CardId[]> {
    if (this.peerDeck) return Promise.resolve(this.peerDeck);
    return new Promise((resolve) => { this.peerDeckResolve = resolve; });
  }

  private onEngineEvent(ev: RollbackEvent) {
    if (ev.kind === "advanced") {
      this.opts.onState?.(ev.state);
      const f = ev.frame;
      if (this.remote && f > 0 && f % CHECKSUM_INTERVAL === 0) {
        this.mb.send(this.remote, encode({ kind: "checksum", frame: f, hash: checksum(ev.state) }));
      }
    } else if (ev.kind === "desync") {
      this.opts.onLog?.(`!! desync at frame ${ev.frame}: local=${ev.localChecksum.toString(16)} remote=${ev.remoteChecksum.toString(16)}`);
      this.opts.onDesync?.(ev.frame, ev.localChecksum, ev.remoteChecksum);
      this.stop();
    } else if (ev.kind === "rolled-back") {
      this.opts.onLog?.(`rollback ${ev.from} → ${ev.to}`);
    }
  }

  private handleMessage(_peer: PeerId, raw: ArrayBuffer | string) {
    const frame = decode(raw);
    if (!frame) return;
    // Deck frame must be processed BEFORE the engine exists.
    if (frame.kind === "deck") {
      this.peerDeck = frame.cards;
      const r = this.peerDeckResolve;
      this.peerDeckResolve = null;
      r?.(frame.cards);
      return;
    }
    if (!this.engine) return;
    if (frame.kind === "input") {
      this.engine.receiveRemoteInput(frame.frame, frame.flags);
    } else if (frame.kind === "checksum") {
      this.engine.receiveChecksum(frame.frame, frame.hash);
    }
  }

  private loop = () => {
    if (this.stopped || !this.engine) return;
    const now = performance.now();
    let elapsed = (now - this.last) / 1000;
    if (elapsed > 0.25) elapsed = 0.25; // tab unfocus clamp
    this.last = now;
    this.accumulator += elapsed;
    const dt = 1 / 60;
    // Frame-advantage stall: if we're too far ahead of the remote peer's
    // confirmed inputs, skip advances so they can catch up. Bounds rollback
    // distance to within MAX_ROLLBACK and prevents desync from skew alone.
    const STALL_THRESHOLD = 30; // ~500ms
    while (this.accumulator >= dt) {
      const ahead = this.engine.framesAhead();
      if (ahead > STALL_THRESHOLD) {
        // Drain time without advancing — peer needs to catch up first.
        this.accumulator -= dt;
        continue;
      }
      // Broadcast THIS frame's local input (even if empty) so the remote peer
      // gets a per-frame confirmation and never has to predict beyond
      // INPUT_DELAY frames. This keeps lastConfirmedFrame current.
      const flags = this.pendingFlags;
      this.pendingFlags = 0;
      const { frame } = this.engine.pushLocalInput(flags);
      if (this.remote) this.mb.send(this.remote, encode({ kind: "input", frame, flags }));
      this.engine.advance();
      this.accumulator -= dt;
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  // Returns once the underlying WebSocket has really finished closing, so a
  // rematch can safely open a fresh connection without racing the server's
  // peer-cleanup.
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
    await this.mb.close();
  }

  state(): GameState | undefined { return this.engine?.current(); }
  localPlayer(): 0 | 1 | undefined { return this.engine?.localPlayer(); }
  checksumAt(frame: number): bigint | null { return this.engine?.checksumAt(frame) ?? null; }
}
