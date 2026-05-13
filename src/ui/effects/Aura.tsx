// GPU-driven particle aura (Points + custom shader). One Aura covers one
// player's "chest" position; auras are spawned per active power.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  GLSL3,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { useShader, useShaderHotReload } from "../scene/shaders/hmr";

export function Aura({
  origin,
  count = 80,
  radius = 0.7,
  height = 1.6,
  size = 24,
  colorHi,
  colorLo,
  seed = 0,
}: {
  origin: [number, number, number];
  count?: number;
  radius?: number;
  height?: number;
  size?: number;
  colorHi: string;
  colorLo: string;
  seed?: number;
}) {
  const matRef = useRef<ShaderMaterial>(null);

  const geometry = useMemo(() => {
    // Particle positions are computed in the vertex shader; the buffer just
    // needs to hold `count` distinct vertex IDs. We allocate a dummy attribute.
    const g = new BufferGeometry();
    const arr = new Float32Array(count * 3);
    g.setAttribute("position", new Float32BufferAttribute(arr, 3));
    return g;
  }, [count]);

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_seed: { value: seed },
      u_radius: { value: radius },
      u_height: { value: height },
      u_size: { value: size },
      u_origin: { value: new Vector3(...origin) },
      u_colorHi: { value: new Color(colorHi) },
      u_colorLo: { value: new Color(colorLo) },
    }),
    [],
  );

  const { vert, frag } = useShader("aura");
  useShaderHotReload(matRef, "aura");

  useFrame((_, dt) => {
    if (!matRef.current) return;
    matRef.current.uniforms.u_time.value += dt;
    matRef.current.uniforms.u_origin.value.set(origin[0], origin[1], origin[2]);
    matRef.current.uniforms.u_colorHi.value.set(colorHi);
    matRef.current.uniforms.u_colorLo.value.set(colorLo);
  });

  return (
    <points geometry={geometry} renderOrder={5}>
      <shaderMaterial
        ref={matRef}
        glslVersion={GLSL3}
        vertexShader={vert}
        fragmentShader={frag}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
