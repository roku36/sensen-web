// Ephemeral FX events derived from frame-to-frame state deltas.
//
// Keeps the simulation pure: the rollback engine can replay/resimulate freely
// without producing side effects, while the front-end overlays animations by
// observing diffs in `useStore.getState().game`.

import { create } from "zustand";

export type FxEventInput =
  | { kind: "hit"; side: 0 | 1; amount: number; t0: number }
  | { kind: "play-card"; side: 0 | 1; cardId: number; fromIdx: number; t0: number };

export type FxEvent = FxEventInput & { id: number };

interface FxStore {
  events: FxEvent[];
  push: (e: FxEventInput) => void;
  prune: (now: number) => void;
}

let nextId = 1;
const LIFETIME_MS = 1500;

export const useFx = create<FxStore>((set) => ({
  events: [],
  push: (e) =>
    set((s) => ({ events: [...s.events, { ...e, id: nextId++ } as unknown as FxEvent] })),
  prune: (now) =>
    set((s) => ({ events: s.events.filter((e) => now - e.t0 < LIFETIME_MS) })),
}));
