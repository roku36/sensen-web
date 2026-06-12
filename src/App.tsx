import { useEffect } from "react";
import { buildCurrentReplay, getSession } from "./ui/hooks";
import { DeckBuilder } from "./ui/screens/DeckBuilder";
import { Gameplay } from "./ui/screens/Gameplay";
import { LabDashboard } from "./ui/screens/LabDashboard";
import { PuzzleScreen } from "./ui/screens/PuzzleScreen";
import { Lobby } from "./ui/screens/Lobby";
import { ReplayViewer } from "./ui/screens/ReplayViewer";
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
    // Debug: force opponent HP to 0 so the result panel shows immediately.
    forceVictory: () => {
      const g = useStore.getState().game;
      if (g) g.players[1].hp = 0;
    },
    checksumAt: (frame: number) => {
      const s = getSession();
      if (!s || !("checksumAt" in s)) return null;
      const c = (s as any).checksumAt(frame);
      return c == null ? null : c.toString(16);
    },
    buildReplay: () => buildCurrentReplay(),
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
      {screen === "deck" && <DeckBuilder />}
      {screen === "lab" && <LabDashboard />}
      {screen === "puzzle" && <PuzzleScreen />}
      {screen === "lobby" && <Lobby />}
      {screen === "gameplay" && (viewMode === "simple" ? <SimpleGameplay /> : <Gameplay />)}
      {screen === "replay" && (() => {
        const replay = useStore.getState().loadedReplay;
        if (!replay) { useStore.getState().setScreen("title"); return null; }
        // Reuse SimpleGameplay HUD for rendering; ReplayViewer overlays controls.
        return (
          <>
            <SimpleGameplay />
            <ReplayViewer replay={replay} onExit={() => { useStore.getState().setLoadedReplay(null); useStore.getState().setScreen("title"); }} />
          </>
        );
      })()}
    </div>
  );
}
