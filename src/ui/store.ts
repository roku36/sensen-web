// Zustand store for view-state. The simulation state (`game`) is kept here as a
// snapshot updated each frame; the rollback engine remains the source of truth.

import { create } from "zustand";
import { GameState } from "../sim/state";

export type Screen = "title" | "lobby" | "gameplay";
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
}));
