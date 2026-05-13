// Renders all active hit-FX events as expanding shockwaves on the
// affected player's chest height. Each event is one billboarded plane.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, GLSL3, Group, ShaderMaterial } from "three";
import { useShader, useShaderHotReload } from "../scene/shaders/hmr";
import { useFx } from "./store";

const LIFETIME = 0.6; // seconds

const POSITION_BY_SIDE: Record<0 | 1, [number, number, number]> = {
  // Will be overridden by sceneSides prop, but we provide defaults that match Scene.tsx.
  0: [0, 1.6, 2.5],
  1: [0, 2.6, -5.5],
};

export function HitWaves({
  positions = POSITION_BY_SIDE,
  selfSide = 0,
}: {
  positions?: Record<0 | 1, [number, number, number]>;
  selfSide?: 0 | 1;
}) {
  const events = useFx((s) => s.events);
  const hits = events.filter((e) => e.kind === "hit") as Array<
    Extract<ReturnType<typeof useFx.getState>["events"][number], { kind: "hit" }>
  >;

  return (
    <>
      {hits.map((h) => (
        <SingleWave
          key={h.id}
          position={positions[h.side]}
          amount={h.amount}
          t0={h.t0}
          isSelf={h.side === selfSide}
        />
      ))}
    </>
  );
}

function SingleWave({
  position,
  amount,
  t0,
  isSelf,
}: {
  position: [number, number, number];
  amount: number;
  t0: number;
  isSelf: boolean;
}) {
  const ref = useRef<Group>(null);
  const matRef = useRef<ShaderMaterial>(null);

  const intensity = Math.min(1, amount / 120);
  const size = 1.6 + Math.min(2.5, amount / 50);

  const uniforms = useMemo(
    () => ({
      u_progress: { value: 0 },
      u_intensity: { value: intensity },
      u_color: { value: new Color(isSelf ? "#ff5757" : "#ffd166") },
    }),
    [],
  );

  const { vert, frag } = useShader("hit");
  useShaderHotReload(matRef, "hit");

  useFrame(({ camera }) => {
    if (!matRef.current || !ref.current) return;
    const elapsed = (performance.now() - t0) / 1000;
    matRef.current.uniforms.u_progress.value = Math.min(1, elapsed / LIFETIME);
    // Billboard: face camera.
    ref.current.lookAt(camera.position);
  });

  return (
    <group ref={ref} position={position}>
      <mesh scale={size}>
        <planeGeometry args={[1.5, 1.5]} />
        <shaderMaterial
          ref={matRef}
          glslVersion={GLSL3}
          vertexShader={vert}
          fragmentShader={frag}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
