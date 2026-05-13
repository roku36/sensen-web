// Fullscreen-quad background that runs the Rainbow Travel raymarch shader
// behind everything else in the scene.

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { GLSL3, PerspectiveCamera, ShaderMaterial, Vector2, Vector3 } from "three";
import BACKGROUND_VERT from "./shaders/background.vert";
import BACKGROUND_FRAG from "./shaders/background.frag";
import { useShaderHMR } from "./shaders/hmr";

const _forward = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _worldUp = new Vector3(0, 1, 0);

export function Background({ intensity = 0.85 }: { intensity?: number }) {
  const matRef = useRef<ShaderMaterial>(null);
  const { size } = useThree();

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_resolution: { value: new Vector2(size.width, size.height) },
      u_intensity: { value: intensity },
      u_fovY: { value: 1.0 },
      u_camForward: { value: new Vector3(0, 0, -1) },
      u_camRight: { value: new Vector3(1, 0, 0) },
      u_camUp: { value: new Vector3(0, 1, 0) },
    }),
    [],
  );

  useShaderHMR(matRef, BACKGROUND_VERT, BACKGROUND_FRAG);

  useFrame(({ camera }, dt) => {
    if (!matRef.current) return;
    const u = matRef.current.uniforms;
    u.u_time.value += dt;
    u.u_resolution.value.set(size.width, size.height);
    u.u_intensity.value = intensity;
    // Vertical FOV (perspective only).
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      u.u_fovY.value = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
    }
    // World-space basis: forward, right, up as the camera currently sees.
    camera.getWorldDirection(_forward);
    _right.crossVectors(_forward, _worldUp).normalize();
    _up.crossVectors(_right, _forward).normalize();
    u.u_camForward.value.copy(_forward);
    u.u_camRight.value.copy(_right);
    u.u_camUp.value.copy(_up);
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
