// Zustand store for view-state. The simulation state (`game`) is kept here as a
// snapshot updated each frame; the rollback engine remains the source of truth.

import { create } from "zustand";
import { GameState } from "../sim/state";

export type Screen = "title" | "lobby" | "gameplay";

interface UiStore {
  screen: Screen;
  setScreen: (s: Screen) => void;

  game: GameState | null;
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

  game: null,
  setGame: (g) => set({ game: g }),

  log: [],
  pushLog: (line) => set((s) => ({ log: [...s.log.slice(-200), line] })),

  localPlayer: 0,
  setLocalPlayer: (i) => set({ localPlayer: i }),

  desyncFrame: null,
  setDesync: (frame) => set({ desyncFrame: frame }),
}));
