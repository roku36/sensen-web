// Zustand store for view-state. The simulation state (`game`) is kept here as a
// snapshot updated each frame; the rollback engine remains the source of truth.

import { create } from "zustand";
import { Replay } from "../replay/format";
import { GameState } from "../sim/state";

export type Screen = "title" | "lobby" | "gameplay" | "deck" | "replay" | "lab";
export type ViewMode = "rich3d" | "simple";

const persistedViewMode = (): ViewMode => {
  if (typeof window === "undefined") return "rich3d";
  if (window.location.search.includes("simple")) return "simple";
  if (window.location.search.includes("rich")) return "rich3d";
  return (localStorage.getItem("sensen.viewMode") as ViewMode) || "rich3d";
};

interface UiStore {
  screen: Screen;
  setScreen: (s: Screen) => void;

  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;

  game: GameState | null;
  // Live frame counter — primitive, so subscribers re-render on every sim step
  // even though `game` is mutated in-place by the deterministic reducer.
  gameFrame: number;
  setGame: (s: GameState) => void;

  log: string[];
  pushLog: (line: string) => void;

  localPlayer: 0 | 1;
  setLocalPlayer: (i: 0 | 1) => void;

  desyncFrame: number | null;
  setDesync: (frame: number) => void;

  // Remembered for "rematch" buttons after a result banner.
  lastSignalUrl: string;
  setLastSignalUrl: (u: string) => void;

  loadedReplay: Replay | null;
  setLoadedReplay: (r: Replay | null) => void;

  // CPU opponent for offline practice. Persisted to localStorage so the
  // choice survives reload, and surfaced in the opponent panel so the
  // player knows what level of opposition they're facing.
  aiOpponentName: string; // matches a key in policies (passive/random/...)
  aiSpectate: boolean;    // when true, AI plays for the local side too
  beginnerMode: boolean;  // CPU-only: sim is frozen until 「次の閃」is pressed
  setAiOpponentName: (n: string) => void;
  setAiSpectate: (b: boolean) => void;
  setBeginnerMode: (b: boolean) => void;
}

export const useStore = create<UiStore>((set) => ({
  screen: "title",
  setScreen: (s) => set({ screen: s }),

  viewMode: persistedViewMode(),
  setViewMode: (v) => {
    if (typeof window !== "undefined") localStorage.setItem("sensen.viewMode", v);
    set({ viewMode: v });
  },

  game: null,
  gameFrame: 0,
  // The reducer mutates `game` in place to avoid GC churn on hot path; pass
  // it as the same reference but bump `gameFrame` so subscribers fire.
  setGame: (g) => set({ game: g, gameFrame: g.frame }),

  log: [],
  pushLog: (line) => set((s) => ({ log: [...s.log.slice(-200), line] })),

  localPlayer: 0,
  setLocalPlayer: (i) => set({ localPlayer: i }),

  desyncFrame: null,
  setDesync: (frame) => set({ desyncFrame: frame }),

  lastSignalUrl:
    (typeof window !== "undefined" && localStorage.getItem("sensen.signalUrl")) ||
    "ws://localhost:3536/sensen?next=2",
  setLastSignalUrl: (u) => {
    if (typeof window !== "undefined") localStorage.setItem("sensen.signalUrl", u);
    set({ lastSignalUrl: u });
  },

  loadedReplay: null,
  setLoadedReplay: (r) => set({ loadedReplay: r }),

  aiOpponentName:
    (typeof window !== "undefined" && localStorage.getItem("sensen.aiOpponent")) || "heuristic",
  aiSpectate:
    typeof window !== "undefined" && localStorage.getItem("sensen.aiSpectate") === "1",
  beginnerMode:
    typeof window !== "undefined" && localStorage.getItem("sensen.beginnerMode") === "1",
  setAiOpponentName: (n) => {
    if (typeof window !== "undefined") localStorage.setItem("sensen.aiOpponent", n);
    set({ aiOpponentName: n });
  },
  setAiSpectate: (b) => {
    if (typeof window !== "undefined") localStorage.setItem("sensen.aiSpectate", b ? "1" : "0");
    set({ aiSpectate: b });
  },
  setBeginnerMode: (b) => {
    if (typeof window !== "undefined") localStorage.setItem("sensen.beginnerMode", b ? "1" : "0");
    set({ beginnerMode: b });
  },
}));
