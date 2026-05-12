// Player's hand fanned out at the bottom of the table.

import { CardType, getCardDef } from "../../sim/cards";
import { cardFlag, INPUT_DRAW } from "../../sim/input";
import { PlayerState } from "../../sim/state";
import { getSession } from "../hooks";
import { Card3d } from "./Card3d";

export function Hand({ player }: { player: PlayerState }) {
  const center = 0;
  const spread = Math.min(1.6, 8 / Math.max(player.hand.length, 1));
  const startX = center - ((player.hand.length - 1) * spread) / 2;

  return (
    <group position={[0, 0.05, 4]}>
      {player.hand.map((cardId, i) => {
        const def = getCardDef(cardId);
        const effectiveCost = def && player.corruption && def.cardType === CardType.Skill ? 0 : def?.cost ?? 999;
        const playable = !!def && player.cost >= effectiveCost && def.cost !== 999;
        return (
          <Card3d
            key={i}
            cardId={cardId}
            position={[startX + i * spread, 0, 0]}
            rotation={[0, 0, 0]}
            playable={playable}
            onClick={() => {
              const s = getSession();
              const flag = cardFlag(i);
              if (s && flag !== null) s.pushLocalInput(flag);
            }}
          />
        );
      })}
      {/* Draw button as a small pile to the right */}
      <group
        position={[startX + player.hand.length * spread + 1.2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          getSession()?.pushLocalInput(INPUT_DRAW);
        }}
      >
        <mesh>
          <boxGeometry args={[1.2, 0.1, 1.6]} />
          <meshStandardMaterial color={player.cost >= player.hand.length ? "#5a3a8a" : "#2a1a3a"} />
        </mesh>
      </group>
    </group>
  );
}
