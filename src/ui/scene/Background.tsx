// Fullscreen-quad background that runs the Rainbow Travel raymarch shader
// behind everything else in the scene.

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { GLSL3, ShaderMaterial, Vector2 } from "three";
import { BACKGROUND_FRAG, BACKGROUND_VERT } from "./shaders/background";

export function Background({ intensity = 0.85 }: { intensity?: number }) {
  const matRef = useRef<ShaderMaterial>(null);
  const { size } = useThree();

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_resolution: { value: new Vector2(size.width, size.height) },
      u_intensity: { value: intensity },
    }),
    [],
  );

  useFrame((_, dt) => {
    if (!matRef.current) return;
    matRef.current.uniforms.u_time.value += dt;
    matRef.current.uniforms.u_resolution.value.set(size.width, size.height);
    matRef.current.uniforms.u_intensity.value = intensity;
  });

  return (
    <mesh frustumCulled={false} renderOrder={-1000}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        glslVersion={GLSL3}
        vertexShader={BACKGROUND_VERT}
        fragmentShader={BACKGROUND_FRAG}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
