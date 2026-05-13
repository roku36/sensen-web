// A single card. Internally it's a plane standing upright with normal +Z, so
// the parent can rotate the whole group freely (lay flat, fan, hold-in-hand).
//
// faceUp=false renders the back-face shader branch and hides the text; this
// is what the opponent's hand looks like to us.

import { Text } from "@react-three/drei";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { GLSL3, ShaderMaterial } from "three";
import { CardEffect, getCardDef } from "../../sim/cards";
import CARD_VERT from "./shaders/uv-pass.vert";
import CARD_FRAG from "./shaders/card.frag";
import { useShaderHMR } from "./shaders/hmr";

export interface Card3dProps {
  cardId: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale?: number;
  playable: boolean;
  faceUp?: boolean;
  onClick?: () => void;
}

const CARD_W = 1.4;
const CARD_H = 2.0;

export function Card3d({
  cardId,
  position,
  rotation,
  scale = 1,
  playable,
  faceUp = true,
  onClick,
}: Card3dProps) {
  const def = getCardDef(cardId);
  const matRef = useRef<ShaderMaterial>(null);
  const backRef = useRef<ShaderMaterial>(null);
  const [hover, setHover] = useState(false);

  const interactive = !!onClick && faceUp;

  const makeUniforms = (face: number) => ({
    u_time: { value: 0 },
    u_type: { value: def?.cardType ?? 3 },
    u_playable: { value: playable && faceUp ? 1 : 0 },
    u_disabled: { value: !playable || def?.cost === 999 ? 1 : 0 },
    u_hover: { value: 0 },
    u_faceUp: { value: face },
  });

  const frontUniforms = useMemo(() => makeUniforms(1), []);
  const backUniforms = useMemo(() => makeUniforms(0), []);

  useShaderHMR(matRef, CARD_VERT, CARD_FRAG);
  useShaderHMR(backRef, CARD_VERT, CARD_FRAG);

  useFrame((_, dt) => {
    for (const m of [matRef.current, backRef.current]) {
      if (!m) continue;
      m.uniforms.u_time.value += dt;
      m.uniforms.u_type.value = def?.cardType ?? 3;
      m.uniforms.u_playable.value = playable && faceUp ? 1 : 0;
      m.uniforms.u_disabled.value = !playable || def?.cost === 999 ? 1 : 0;
      const target = hover && interactive ? 1 : 0;
      m.uniforms.u_hover.value += (target - m.uniforms.u_hover.value) * Math.min(1, dt * 8);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    if (playable) onClick?.();
  };

  // Hover lift: push slightly along the local "up" of the card group.
  const lift = hover && interactive ? 0.35 : 0;

  return (
    <group
      position={[position[0], position[1] + lift, position[2]]}
      rotation={rotation}
      scale={scale}
      onClick={handleClick}
      onPointerOver={(e) => { if (!interactive) return; e.stopPropagation(); setHover(true); document.body.style.cursor = playable ? "pointer" : "default"; }}
      onPointerOut={(e) => { if (!interactive) return; e.stopPropagation(); setHover(false); document.body.style.cursor = "default"; }}
    >
      {/* Front face: plane standing upright, normal +Z. */}
      <mesh>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <shaderMaterial
          ref={matRef}
          glslVersion={GLSL3}
          vertexShader={CARD_VERT}
          fragmentShader={CARD_FRAG}
          uniforms={frontUniforms}
          toneMapped={false}
        />
      </mesh>
      {/* Back face: same plane flipped 180° around Y, slightly behind. */}
      <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.005]}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <shaderMaterial
          ref={backRef}
          glslVersion={GLSL3}
          vertexShader={CARD_VERT}
          fragmentShader={CARD_FRAG}
          uniforms={backUniforms}
          toneMapped={false}
        />
      </mesh>

      {faceUp && def && (
        <>
          <Text
            position={[0, 0.78, 0.01]}
            fontSize={0.16}
            color="white"
            outlineWidth={0.012}
            outlineColor="black"
            anchorX="center"
            anchorY="middle"
            maxWidth={1.2}
          >
            {def.name}
          </Text>
          <Text
            position={[-0.55, 0.85, 0.01]}
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
            position={[0, -0.55, 0.01]}
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
