// Floating orb in front of the player that visualizes accumulated cost.
// Charge maps cost → 0..1 across a "display max" (auto-scaled to 6 cost = full).

import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, GLSL3, ShaderMaterial } from "three";
import COST_VERT from "./shaders/uv-pass.vert";
import COST_FRAG from "./shaders/cost.frag";
import { useShaderHMR } from "./shaders/hmr";

const DISPLAY_MAX = 6.0; // cost value at which the orb appears "full"

export function CostMeter({
  cost,
  rate,
  position,
}: {
  cost: number;
  rate: number;
  position: [number, number, number];
}) {
  const matRef = useRef<ShaderMaterial>(null);
  const lastCost = useRef(cost);

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_charge: { value: 0 },
      u_displayMax: { value: DISPLAY_MAX },
      u_rate: { value: rate },
      u_baseColor: { value: new Color(1.0, 0.7, 0.2) },
      u_pulse: { value: 0 },
    }),
    [],
  );

  useShaderHMR(matRef, COST_VERT, COST_FRAG);

  useFrame((_, dt) => {
    if (!matRef.current) return;
    const u = matRef.current.uniforms;
    u.u_time.value += dt;
    u.u_charge.value = Math.min(1, cost / DISPLAY_MAX);
    u.u_rate.value = rate;
    // Detect "cost was spent" (cost dropped) and flash.
    const spent = lastCost.current - cost;
    if (spent > 0.05) u.u_pulse.value = Math.min(1, u.u_pulse.value + spent / 3);
    u.u_pulse.value *= Math.exp(-dt * 4.0); // decay
    lastCost.current = cost;
  });

  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[2.4, 2.4]} />
        <shaderMaterial
          ref={matRef}
          glslVersion={GLSL3}
          vertexShader={COST_VERT}
          fragmentShader={COST_FRAG}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Text position={[0, -0.05, 0.01]} fontSize={0.32} color="white" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="black">
        {cost.toFixed(1)}
      </Text>
      <Text position={[0, -0.4, 0.01]} fontSize={0.13} color="#ffd066" anchorX="center" outlineWidth={0.006} outlineColor="black">
        +{rate.toFixed(1)}/s
      </Text>
    </group>
  );
}
