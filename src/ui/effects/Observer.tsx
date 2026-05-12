// Watches the live game state and emits FX events when meaningful changes
// happen between frames. Mounted invisibly inside the R3F scene.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useStore } from "../store";
import { useFx } from "./store";

interface Snap {
  frame: number;
  hp: [number, number];
  block: [number, number];
  hand: [number[], number[]];
}

export function FxObserver() {
  const prev = useRef<Snap | null>(null);

  useFrame(() => {
    const game = useStore.getState().game;
    if (!game) return;
    const snap: Snap = {
      frame: game.frame,
      hp: [game.players[0].hp, game.players[1].hp],
      block: [game.players[0].block, game.players[1].block],
      hand: [game.players[0].hand.slice(), game.players[1].hand.slice()],
    };

    const p = prev.current;
    if (p && p.frame !== snap.frame) {
      const now = performance.now();
      const push = useFx.getState().push;

      for (const i of [0, 1] as const) {
        // Hit: HP dropped meaningfully OR block dropped (took an attack).
        const lostHp = p.hp[i] - snap.hp[i];
        const lostBlock = p.block[i] - snap.block[i];
        // Filter out the constant block decay (~0.33/frame).
        const blockHit = lostBlock - 0.6;
        if (lostHp > 0.5 || blockHit > 1.0) {
          const amount = Math.max(lostHp, blockHit, 0);
          push({ kind: "hit", side: i, amount, t0: now });
        }

        // Play-card: hand shrunk by exactly 1 (or unchanged length but
        // contents shifted — happens when a played card returns to deck).
        const before = p.hand[i];
        const after = snap.hand[i];
        if (before.length === after.length + 1 || before.length === after.length) {
          // Find the removed/changed card by walking until the first divergence.
          let removed: { idx: number; cardId: number } | null = null;
          for (let j = 0; j < before.length; j++) {
            if (after[j] !== before[j]) {
              removed = { idx: j, cardId: before[j] };
              break;
            }
          }
          // Even-length means a card was played (and possibly returned to deck);
          // the diff above catches the removal, but if hand is unchanged we don't
          // flag anything. If length dropped and we found no diff, the last card
          // was the one removed.
          if (!removed && before.length === after.length + 1) {
            removed = { idx: before.length - 1, cardId: before[before.length - 1] };
          }
          if (removed && before.length !== after.length) {
            push({
              kind: "play-card",
              side: i,
              cardId: removed.cardId,
              fromIdx: removed.idx,
              t0: now,
            });
          }
        }
      }

      useFx.getState().prune(now);
    }
    prev.current = snap;
  });

  return null;
}
