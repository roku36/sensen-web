import { useEffect, useRef } from "react";
import { OfflineSession } from "../net/offline";
import { Session } from "../net/session";
import { CardId } from "../sim/cards";
import { useStore } from "./store";

export type AnySession = OfflineSession | Session;
let activeSession: AnySession | null = null;
export const getSession = () => activeSession;
export const setSession = (s: AnySession | null) => { activeSession = s; };

export function useKeyboardInput() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const s = getSession();
      if (!s) return;
      let flags = 0;
      if (e.key === "d" || e.key === "D") flags = 1;
      else if (e.key >= "1" && e.key <= "9") flags = 1 << (Number(e.key));
      else if (e.key === "0") flags = 1 << 10;
      if (flags !== 0) s.pushLocalInput(flags);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// Track which mode the active session is in so rematch buttons match context.
let activeMode: "offline" | "online" | null = null;
export const getActiveMode = () => activeMode;

// Tear down any session that was still attached. Awaits real socket close so
// a follow-up startOnline doesn't race the matchbox server's peer cleanup
// (which would either ghost-pair us with our own dying connection or strand
// the two peers in different rooms).
async function stopActiveSession(): Promise<void> {
  const s = activeSession;
  if (s) {
    try {
      const r = (s as any).stop?.();
      if (r && typeof r.then === "function") await r;
    } catch { /* ignore */ }
  }
  setSession(null);
  activeMode = null;
  // Clear ephemeral per-match state so the next match starts clean.
  useStore.setState({ game: null, gameFrame: 0, log: [], desyncFrame: null });
}

export async function startOffline(deck: CardId[]) {
  await stopActiveSession();
  const s = new OfflineSession({
    deck,
    onState: (g) => useStore.getState().setGame(g),
  });
  setSession(s);
  activeMode = "offline";
  useStore.getState().setLocalPlayer(0);
  s.start();
  useStore.getState().setScreen("gameplay");
}

export async function startOnline(signalUrl: string, deck: CardId[]) {
  await stopActiveSession();
  // Tiny grace period: the WebSocket close above is "done" from the client's
  // POV but the matchbox server may still be processing our PeerLeft. 250ms
  // empirically clears the ghost.
  await new Promise((r) => setTimeout(r, 250));
  useStore.getState().setLastSignalUrl(signalUrl);
  const log = (line: string) => useStore.getState().pushLog(line);
  const s = new Session({
    signalUrl,
    deck,
    onState: (g) => {
      useStore.getState().setGame(g);
      const lp = s.localPlayer();
      if (lp !== undefined) useStore.getState().setLocalPlayer(lp);
    },
    onLog: log,
    onDesync: (f) => useStore.getState().setDesync(f),
  });
  setSession(s);
  activeMode = "online";
  useStore.getState().setScreen("lobby");
  await s.start();
}

// Rematch helpers — used by the post-match panel. Each picks up the
// player's currently saved deck (DeckBuilder writes to the same key).
import { loadDeck } from "../sim/deck-storage";
export { loadDeck };

export function rematchOffline() { void startOffline(loadDeck()); }
export function rematchOnline() {
  const url = useStore.getState().lastSignalUrl;
  void startOnline(url, loadDeck());
}
export async function backToTitle() {
  await stopActiveSession();
  useStore.getState().setScreen("title");
}

export function useFrameTick(rerender: () => void) {
  const ref = useRef<number>(0);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      rerender();
      ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(ref.current); };
  }, [rerender]);
}
