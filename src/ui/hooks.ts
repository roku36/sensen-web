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

export function startOffline(deck: CardId[]) {
  const s = new OfflineSession({
    deck,
    onState: (g) => useStore.getState().setGame(g),
  });
  setSession(s);
  useStore.getState().setLocalPlayer(0);
  s.start();
  useStore.getState().setScreen("gameplay");
}

export async function startOnline(signalUrl: string, deck: CardId[]) {
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
  useStore.getState().setScreen("lobby");
  await s.start();
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
