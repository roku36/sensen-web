// A single card mesh laid into the table. Click to play.

import { Text } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { Color } from "three";
import { CardEffect, CardType, getCardDef } from "../../sim/cards";

export function Card3d({
  cardId,
  position,
  rotation,
  playable,
  onClick,
  faceUp = true,
}: {
  cardId: number;
  position: [number, number, number];
  rotation: [number, number, number];
  playable: boolean;
  onClick: () => void;
  faceUp?: boolean;
}) {
  const def = getCardDef(cardId);

  const color = useMemo(() => {
    if (!def) return new Color("#444");
    switch (def.cardType) {
      case CardType.Attack: return new Color(playable ? "#ff5b5b" : "#5a2a2a");
      case CardType.Skill: return new Color(playable ? "#5b9eff" : "#2a3a5a");
      case CardType.Power: return new Color(playable ? "#c97bff" : "#4a2a5a");
      case CardType.Status: return new Color("#666");
    }
  }, [def, playable]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (playable) onClick();
  };

  return (
    <group position={position} rotation={rotation} onClick={handleClick}>
      <mesh castShadow>
        <boxGeometry args={[1.4, 0.04, 2.0]} />
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.5} />
      </mesh>
      {/* Card face */}
      {faceUp && def && (
        <>
          <Text
            position={[0, 0.025, -0.7]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.18}
            color="white"
            anchorX="center"
            anchorY="middle"
          >
            {def.name}
          </Text>
          <Text
            position={[-0.55, 0.025, -0.85]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.22}
            color="#ffe066"
            anchorX="center"
            anchorY="middle"
          >
            {def.cost === 999 ? "X" : def.cost.toFixed(1)}
          </Text>
          <Text
            position={[0, 0.025, 0.4]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.13}
            color="#ddd"
            anchorX="center"
            anchorY="middle"
            maxWidth={1.3}
          >
            {effectLabel(def.effect)}
          </Text>
        </>
      )}
    </group>
  );
}

function effectLabel(e: CardEffect): string {
  switch (e.kind) {
    case "Damage": return `Deal ${e.amount}`;
    case "MultiHit": return `${e.damage} × ${e.hits}`;
    case "Heal": return `Heal ${e.amount}`;
    case "Draw": return `Draw ${e.count}`;
    case "Block": return `Block ${e.amount}`;
    case "Thorns": return `Thorns ${e.amount}`;
    case "Strength": return `+${e.amount} Str`;
    case "Vulnerable": return `Vuln ${e.duration}s`;
    case "SelfVulnerable": return `Self-Vuln ${e.duration}s`;
    case "Weak": return `Weak ${e.duration}s`;
    case "Accelerate": return `Accel +${e.bonusRate}/s`;
    case "BodySlam": return `Block as Damage`;
    case "Bloodletting": return e.amount < 0 ? `Lose ${-e.amount} HP` : `Heal ${e.amount}`;
    case "DoubleBlock": return `2× Block`;
    case "DoubleStrength": return `2× Str`;
    case "Rage": return `Rage`;
    case "Metallicize": return `Metal +${e.blockPerSecond}/s`;
    case "Combust": return `Combust`;
    case "DemonForm": return `Demon`;
    case "Barricade": return `Barricade`;
    case "Juggernaut": return `Juggernaut`;
    case "DarkEmbrace": return `Dark Embrace`;
    case "Evolve": return `Evolve`;
    case "FeelNoPain": return `FNP`;
    case "FireBreathing": return `Fire Breath`;
    case "Rupture": return `Rupture`;
    case "Corruption": return `Corruption`;
    case "Brutality": return `Brutality`;
    case "Exhaust": return `Exhaust`;
    case "AddStatus": return `+Status`;
    case "Combo": return `Combo`;
  }
}
