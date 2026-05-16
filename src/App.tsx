import { useEffect } from "react";
import { getSession } from "./ui/hooks";
import { Gameplay } from "./ui/screens/Gameplay";
import { Lobby } from "./ui/screens/Lobby";
import { SimpleGameplay } from "./ui/screens/SimpleGameplay";
import { Title } from "./ui/screens/Title";
import { useStore } from "./ui/store";

// Test hook: lets Playwright (or any external harness) inspect the live game
// state. Each peer exposes its own checksum + key fields; we compare across tabs
// to verify P2P consistency.
declare global { interface Window { __sensen?: any } }
if (typeof window !== "undefined") {
  window.__sensen = {
    getState: () => useStore.getState().game,
    getLocalPlayer: () => useStore.getState().localPlayer,
    getScreen: () => useStore.getState().screen,
    getLog: () => useStore.getState().log,
    getDesync: () => useStore.getState().desyncFrame,
    pushInput: (flags: number) => getSession()?.pushLocalInput(flags),
    checksumAt: (frame: number) => {
      const s = getSession();
      if (!s || !("checksumAt" in s)) return null;
      const c = (s as any).checksumAt(frame);
      return c == null ? null : c.toString(16);
    },
  };
}

export default function App() {
  const screen = useStore((s) => s.screen);
  const viewMode = useStore((s) => s.viewMode);
  // Subscribe to gameFrame so any HUD that reads from `game` re-renders on
  // every sim step (60Hz). No more 33ms polling interval.
  useStore((s) => s.gameFrame);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {screen === "title" && <Title />}
      {screen === "lobby" && <Lobby />}
      {screen === "gameplay" && (viewMode === "simple" ? <SimpleGameplay /> : <Gameplay />)}
    </div>
  );
}
