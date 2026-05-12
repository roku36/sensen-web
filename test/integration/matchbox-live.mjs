// Live signaling test against the running matchbox_server.
// Confirms:
//   1. Both peers receive IdAssigned.
//   2. The first-joined peer (A) is notified of B via NewPeer.
//   3. A can route a Signal{Offer} to B, and B receives it.
// (matchbox is asymmetric: only the existing peer is notified of the joiner;
//  the joiner discovers the other side via incoming Signal — this matches my
//  MatchboxClient implementation in src/net/matchbox.ts.)

const URL = "ws://localhost:3536/sensen?next=2";

function open(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const events = [];
    let id = null;
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      events.push(m);
      console.log(`[${label}] <- ${ev.data}`);
      if (m.IdAssigned && !id) {
        id = m.IdAssigned;
        resolve({ ws, id, events });
      }
    };
    ws.onerror = () => reject(new Error(`${label} ws error`));
    setTimeout(() => { if (!id) reject(new Error(`${label} no IdAssigned in 5s`)); }, 5000);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("→ peer A connecting");
  const a = await open("A");
  await wait(150);
  console.log("→ peer B connecting");
  const b = await open("B");

  // A should now receive a NewPeer event for B.
  await wait(500);
  const aNewPeer = a.events.find((m) => m.NewPeer);
  if (!aNewPeer || aNewPeer.NewPeer !== b.id) {
    throw new Error(`A did not receive NewPeer for B. events=${JSON.stringify(a.events)}`);
  }
  console.log("✓ A was notified of B via NewPeer");

  // A sends a fake Offer to B; verify B receives it as Signal{sender:A, data:{Offer:...}}.
  const fakeSdp = "v=0\r\no=- test 0 IN IP4 127.0.0.1\r\n";
  a.ws.send(JSON.stringify({ Signal: { receiver: b.id, data: { Offer: fakeSdp } } }));
  await wait(500);

  const sig = b.events.find((m) => m.Signal);
  if (!sig) throw new Error(`B never received the relayed Signal. events=${JSON.stringify(b.events)}`);
  if (sig.Signal.sender !== a.id) throw new Error(`B's Signal.sender ${sig.Signal.sender} != A.id ${a.id}`);
  if (!sig.Signal.data.Offer) throw new Error(`B's Signal lacks Offer payload`);
  console.log("✓ matchbox routed A's Offer to B (sender + payload verified)");

  console.log("\n✓✓✓ matchbox signaling layer works end-to-end against the live server.");
  a.ws.close();
  b.ws.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
