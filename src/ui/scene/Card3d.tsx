// A single card. Internally it's a plane standing upright with normal +Z, so
// the parent can rotate the whole group freely (lay flat, fan, hold-in-hand).
//
// faceUp=false renders the back-face shader branch and hides the text; this
// is what the opponent's hand looks like to us.

import { Html, Text } from "@react-three/drei";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { GLSL3, ShaderMaterial } from "three";
import { CardType, getCardDef } from "../../sim/cards";
import { useShader, useShaderHotReload } from "./shaders/hmr";

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

  const { vert, frag } = useShader("card");
  useShaderHotReload(matRef, "card");
  useShaderHotReload(backRef, "card");

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
          vertexShader={vert}
          fragmentShader={frag}
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
          vertexShader={vert}
          fragmentShader={frag}
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
            fontSize={0.12}
            color="#fff"
            outlineWidth={0.008}
            outlineColor="#000"
            anchorX="center"
            anchorY="middle"
            maxWidth={1.25}
          >
            {def.description}
          </Text>
          {hover && interactive && (
            <Html position={[0, 1.2, 0.05]} center distanceFactor={6} pointerEvents="none">
              <div style={tipBox}>
                <div style={tipTitle}>{def.name}</div>
                <div style={tipMeta}>
                  {def.cardType === CardType.Attack ? "攻撃" : def.cardType === CardType.Skill ? "技" : def.cardType === CardType.Power ? "パワー" : "状態"}
                  {" · "}コスト {def.cost === 999 ? "—" : def.cost}
                  {def.exhausts && " · 1回限り"}
                </div>
                <div style={tipBody}>{def.description}</div>
              </div>
            </Html>
          )}
        </>
      )}
    </group>
  );
}

const tipBox: React.CSSProperties = { background: "rgba(20,20,28,0.97)", border: "1px solid #555", borderRadius: 6, padding: "8px 10px", minWidth: 180, color: "#fff", fontFamily: "ui-sans-serif, system-ui, sans-serif" };
const tipTitle: React.CSSProperties = { fontWeight: 700, fontSize: 13, marginBottom: 2 };
const tipMeta: React.CSSProperties = { fontSize: 10, opacity: 0.65 };
const tipBody: React.CSSProperties = { fontSize: 11, marginTop: 4, lineHeight: 1.35 };

