// 3D fan layout — cards radiate from a "wrist" pivot below the player edge of
// the table, like cards held in a hand.
//
// Geometry:
//   each card sits on an arc of radius R around the pivot in the player's
//   facing plane (XY). Card i is at angle θ_i around that arc, oriented so
//   its bottom edge points at the pivot — so the splay angles open outward.
//   The whole fan is then leaned back slightly so the faces point at the
//   camera (or away from it for the opponent's hand).
//
//   self: pivot in front of camera-side edge, faces toward +Z (toward camera).
//   opponent: pivot at far edge, faces toward -Z (away from us → backs visible).

import { CardType, getCardDef } from "../../sim/cards";
import { cardFlag } from "../../sim/input";
import { PlayerState } from "../../sim/state";
import { getSession } from "../hooks";
import { Card3d } from "./Card3d";

interface HandProps {
  player: PlayerState;
  side: "self" | "opponent";
  interactive?: boolean;
}

const DEG = Math.PI / 180;

// Tuned for camera at [0, 8, 9] looking at origin.
const FAN_RADIUS = 5.0;       // arc radius from wrist pivot to card center
const FAN_SPREAD_DEG = 8;    // angular gap between adjacent cards
const FAN_LEAN_DEG = 12;      // backward tilt of the whole hand toward the camera
const CARD_SCALE = 0.72;

export function Hand({ player, side, interactive = side === "self" }: HandProps) {
  const cards = player.hand;
  const n = cards.length;
  const center = (n - 1) / 2;
  const sign = side === "self" ? 1 : -1; // self toward +Z; opponent toward -Z

  // "Wrist" pivot — below the player edge of the table.
  const pivotY = -2.5;
  const pivotZ = 5.2 * sign;

  // Backward lean of the hand as a whole (so faces point at the camera).
  const lean = FAN_LEAN_DEG * DEG * -sign; // self leans back (negative X-rot for +Z facing)

  return (
    <group position={[0, pivotY, pivotZ]} rotation={[lean, side === "opponent" ? Math.PI : 0, 0]}>
      {cards.map((cardId, i) => {
        const angleDeg = (i - center) * FAN_SPREAD_DEG;
        const a = angleDeg * DEG;

        // Position on an arc in the local XY plane (centered above pivot).
        // Bottom of the card is at distance ≈ FAN_RADIUS - cardHeight/2 from pivot.
        const x = Math.sin(a) * FAN_RADIUS;
        const y = Math.cos(a) * FAN_RADIUS;
        const z = -i * 0.005; // tiny z stagger so cards layer correctly

        // Orient so the card's "up" points away from the pivot — i.e. roll
        // around its own normal by `a`.
        const rotZ = -a;

        const def = getCardDef(cardId);
        // In the cast-time model, a card is "playable" (clickable to start a
        // cast) whenever its cost is finite AND the player is not already
        // casting something else.
        // Clickable whenever hand has slots — queue can grow beyond 1.
        const playable = !!def && def.cost < 900;

        return (
          <Card3d
            key={i}
            cardId={cardId}
            position={[x, y, z]}
            rotation={[0, 0, rotZ]}
            scale={CARD_SCALE}
            faceUp={side === "self"}
            playable={playable}
            onClick={
              interactive
                ? () => {
                    const s = getSession();
                    const flag = cardFlag(i);
                    if (s && flag !== null) s.pushLocalInput(flag);
                  }
                : undefined
            }
          />
        );
      })}

      {/* No draw button in the cast-time model — cards auto-refill after each resolve. */}
    </group>
  );
}
