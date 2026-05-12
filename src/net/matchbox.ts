// JS client for the matchbox-server signaling protocol.
//
// Wire format (serde JSON of matchbox_protocol::{PeerRequest,PeerEvent}):
//   Server → us:  {"IdAssigned":"<uuid>"} | {"NewPeer":"<uuid>"} | {"PeerLeft":"<uuid>"} |
//                 {"Signal":{"sender":"<uuid>","data":<inner>}}
//   Us → server:  {"Signal":{"receiver":"<uuid>","data":<inner>}} | "KeepAlive"
//
// The inner `data` for Sensen's PeerSignal is one of:
//   {"IceCandidate":"<json>"} | {"Offer":"<sdp>"} | {"Answer":"<sdp>"}

export type PeerId = string;

type ServerMsg =
  | { IdAssigned: string }
  | { NewPeer: string }
  | { PeerLeft: string }
  | { Signal: { sender: string; data: PeerSignal } };

type PeerSignal =
  | { IceCandidate: string }
  | { Offer: string }
  | { Answer: string };

export interface PeerConnection {
  peerId: PeerId;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  ready: Promise<void>;
}

export interface MatchboxOptions {
  url: string;            // e.g. ws://localhost:3536/sensen?next=2
  iceServers?: RTCIceServer[];
}

type Listener = (e: MatchboxEvent) => void;
export type MatchboxEvent =
  | { kind: "id"; localId: PeerId }
  | { kind: "peer-joined"; peer: PeerId }
  | { kind: "peer-left"; peer: PeerId }
  | { kind: "channel-open"; peer: PeerId }
  | { kind: "message"; peer: PeerId; data: ArrayBuffer | string }
  | { kind: "closed" };

export class MatchboxClient {
  private ws?: WebSocket;
  private listeners: Listener[] = [];
  localId: PeerId = "";
  readonly peers = new Map<PeerId, PeerConnection>();
  private readonly opts: MatchboxOptions;

  constructor(opts: MatchboxOptions) { this.opts = opts; }

  on(fn: Listener) { this.listeners.push(fn); }
  private emit(e: MatchboxEvent) { for (const fn of this.listeners) fn(e); }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (ev) => reject(new Error("ws error: " + JSON.stringify(ev)));
      ws.onclose = () => this.emit({ kind: "closed" });
      ws.onmessage = (ev) => this.handleSignal(ev.data);

      // Server expects "KeepAlive" pings every ~10s.
      const keep = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify("KeepAlive"));
        else clearInterval(keep);
      }, 10_000);
    });
  }

  send(peerId: PeerId, data: ArrayBuffer | string) {
    const conn = this.peers.get(peerId);
    if (!conn || conn.channel.readyState !== "open") return;
    conn.channel.send(data as any);
  }

  broadcast(data: ArrayBuffer | string) {
    for (const id of this.peers.keys()) this.send(id, data);
  }

  // ── Signaling handlers ──────────────────────────────────────────────────

  private async handleSignal(raw: string) {
    let msg: ServerMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    if ("IdAssigned" in msg) {
      this.localId = msg.IdAssigned;
      this.emit({ kind: "id", localId: this.localId });
      return;
    }
    if ("NewPeer" in msg) {
      const peer = msg.NewPeer;
      // Lower-id peer initiates the offer (deterministic ordering).
      const initiator = this.localId < peer;
      this.createPeer(peer, initiator);
      this.emit({ kind: "peer-joined", peer });
      return;
    }
    if ("PeerLeft" in msg) {
      const peer = msg.PeerLeft;
      this.peers.get(peer)?.pc.close();
      this.peers.delete(peer);
      this.emit({ kind: "peer-left", peer });
      return;
    }
    if ("Signal" in msg) {
      await this.onPeerSignal(msg.Signal.sender, msg.Signal.data);
    }
  }

  private async onPeerSignal(sender: PeerId, signal: PeerSignal) {
    let conn = this.peers.get(sender);
    if (!conn) conn = this.createPeer(sender, false);

    if ("Offer" in signal) {
      await conn.pc.setRemoteDescription({ type: "offer", sdp: signal.Offer });
      const answer = await conn.pc.createAnswer();
      await conn.pc.setLocalDescription(answer);
      this.signalTo(sender, { Answer: answer.sdp ?? "" });
    } else if ("Answer" in signal) {
      await conn.pc.setRemoteDescription({ type: "answer", sdp: signal.Answer });
    } else if ("IceCandidate" in signal) {
      try {
        const cand = JSON.parse(signal.IceCandidate);
        await conn.pc.addIceCandidate(cand);
      } catch { /* end-of-candidates etc */ }
    }
  }

  private createPeer(peerId: PeerId, initiator: boolean): PeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: this.opts.iceServers ?? [],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signalTo(peerId, { IceCandidate: JSON.stringify(e.candidate.toJSON()) });
      }
    };

    let channel: RTCDataChannel;
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => { resolveReady = r; });

    const wireUp = (ch: RTCDataChannel) => {
      ch.binaryType = "arraybuffer";
      ch.onopen = () => {
        this.emit({ kind: "channel-open", peer: peerId });
        resolveReady();
      };
      ch.onmessage = (ev) => this.emit({ kind: "message", peer: peerId, data: ev.data });
    };

    if (initiator) {
      channel = pc.createDataChannel("sensen", { ordered: false, maxRetransmits: 0 });
      wireUp(channel);
      pc.onnegotiationneeded = async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.signalTo(peerId, { Offer: offer.sdp ?? "" });
      };
    } else {
      pc.ondatachannel = (ev) => { channel = ev.channel; wireUp(channel); conn.channel = channel; };
      // Placeholder until ondatachannel fires.
      channel = {} as RTCDataChannel;
    }

    const conn: PeerConnection = { peerId, pc, channel, ready };
    this.peers.set(peerId, conn);
    return conn;
  }

  private signalTo(receiver: PeerId, data: PeerSignal) {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ Signal: { receiver, data } }));
  }

  close() {
    for (const conn of this.peers.values()) conn.pc.close();
    this.peers.clear();
    this.ws?.close();
  }
}
