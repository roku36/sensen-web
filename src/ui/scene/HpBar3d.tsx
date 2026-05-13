// 3D HP bar plane backed by the hpbar shader. Listens to FX events to flash
// briefly when this side takes damage.

import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { GLSL3, ShaderMaterial } from "three";
import { useFx } from "../effects/store";
import HPBAR_VERT from "./shaders/uv-pass.vert";
import HPBAR_FRAG from "./shaders/hpbar.frag";
import { useShaderHMR } from "./shaders/hmr";

const FLASH_DECAY = 4.0; // per second

export function HpBar3d({
  hp,
  hpMax,
  side,
  isSelf,
  width = 5,
  height = 0.5,
  position,
}: {
  hp: number;
  hpMax: number;
  side: 0 | 1;
  isSelf: boolean;
  width?: number;
  height?: number;
  position: [number, number, number];
}) {
  const matRef = useRef<ShaderMaterial>(null);
  const flash = useRef(0);
  const lastEventId = useRef(0);

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_hp: { value: hp / hpMax },
      u_flash: { value: 0 },
      u_isSelf: { value: isSelf ? 1 : 0 },
    }),
    [],
  );

  useShaderHMR(matRef, HPBAR_VERT, HPBAR_FRAG);

  useFrame((_, dt) => {
    if (!matRef.current) return;
    // Bump flash on new hit events targeting this side.
    const events = useFx.getState().events;
    for (const e of events) {
      if (e.kind === "hit" && e.side === side && e.id > lastEventId.current) {
        lastEventId.current = e.id;
        flash.current = Math.min(1, flash.current + Math.min(1, e.amount / 80));
      }
    }
    flash.current = Math.max(0, flash.current - dt * FLASH_DECAY);

    const u = matRef.current.uniforms;
    u.u_time.value += dt;
    u.u_hp.value = Math.max(0, Math.min(1, hp / hpMax));
    u.u_flash.value = flash.current;
    u.u_isSelf.value = isSelf ? 1 : 0;
  });

  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[width, height]} />
        <shaderMaterial
          ref={matRef}
          glslVersion={GLSL3}
          vertexShader={HPBAR_VERT}
          fragmentShader={HPBAR_FRAG}
          uniforms={uniforms}
          toneMapped={false}
        />
      </mesh>
      <Text position={[0, 0, 0.01]} fontSize={0.22} color="white" outlineWidth={0.014} outlineColor="black" anchorX="center" anchorY="middle">
        {Math.round(hp)} / {hpMax}
      </Text>
    </group>
  );
}
