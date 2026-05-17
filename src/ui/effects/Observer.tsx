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
  hand: [(number | null)[], (number | null)[]];
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

        // Play-card: a fixed-slot hand transitions slot X from cardId → null
        // when the player queues a card. Detect that exact transition.
        const before = p.hand[i];
        const after = snap.hand[i];
        for (let j = 0; j < before.length; j++) {
          if (before[j] !== null && after[j] === null && before[j] !== after[j]) {
            push({
              kind: "play-card",
              side: i,
              cardId: before[j] as number,
              fromIdx: j,
              t0: now,
            });
            break;
          }
        }
      }

      useFx.getState().prune(now);
    }
    prev.current = snap;
  });

  return null;
}
