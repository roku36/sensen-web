// A single card mesh, rendered with the per-type shader. Click to play.

import { Text } from "@react-three/drei";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { GLSL3, ShaderMaterial } from "three";
import { CardEffect, getCardDef } from "../../sim/cards";
import { CARD_FRAG, CARD_VERT } from "./shaders/card";

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
  const matRef = useRef<ShaderMaterial>(null);
  const [hover, setHover] = useState(false);

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_type: { value: def?.cardType ?? 3 },
      u_playable: { value: playable ? 1 : 0 },
      u_disabled: { value: !playable || def?.cost === 999 ? 1 : 0 },
      u_hover: { value: 0 },
    }),
    [],
  );

  useFrame((_, dt) => {
    if (!matRef.current) return;
    const u = matRef.current.uniforms;
    u.u_time.value += dt;
    u.u_type.value = def?.cardType ?? 3;
    u.u_playable.value = playable ? 1 : 0;
    u.u_disabled.value = !playable || def?.cost === 999 ? 1 : 0;
    // Smooth hover lerp.
    const target = hover ? 1 : 0;
    u.u_hover.value += (target - u.u_hover.value) * Math.min(1, dt * 8);
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (playable) onClick();
  };

  // Hover lift.
  const yLift = hover && playable ? 0.45 : 0;

  return (
    <group
      position={[position[0], position[1] + yLift, position[2]]}
      rotation={rotation}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = playable ? "pointer" : "default"; }}
      onPointerOut={(e) => { e.stopPropagation(); setHover(false); document.body.style.cursor = "default"; }}
    >
      {/* Card body — a plane laid flat on the table. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.4, 2.0]} />
        <shaderMaterial
          ref={matRef}
          glslVersion={GLSL3}
          vertexShader={CARD_VERT}
          fragmentShader={CARD_FRAG}
          uniforms={uniforms}
          toneMapped={false}
        />
      </mesh>

      {/* Foil edge — a thin underlayer that shows through transparency on the rim. */}
      <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.42, 2.02]} />
        <meshBasicMaterial color="#0c0d12" />
      </mesh>

      {faceUp && def && (
        <>
          <Text
            position={[0, 0.01, -0.78]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.17}
            color="white"
            outlineWidth={0.012}
            outlineColor="black"
            anchorX="center"
            anchorY="middle"
          >
            {def.name}
          </Text>
          <Text
            position={[-0.55, 0.01, -0.85]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.26}
            color="#ffe580"
            outlineWidth={0.018}
            outlineColor="black"
            anchorX="center"
            anchorY="middle"
          >
            {def.cost === 999 ? "X" : def.cost.toFixed(1)}
          </Text>
          <Text
            position={[0, 0.01, 0.55]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.13}
            color="#fff"
            outlineWidth={0.008}
            outlineColor="#000"
            anchorX="center"
            anchorY="middle"
            maxWidth={1.25}
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
