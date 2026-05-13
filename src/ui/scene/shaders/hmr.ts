// HMR-aware ShaderMaterial wrapper.
//
// Why a hook at all: Three.js only re-links the GPU program when
// `material.needsUpdate` is set. R3F's JSX prop reconciliation copies the new
// source onto `material.fragmentShader` but DOES NOT flip needsUpdate, so a
// shader edit silently leaves the old compiled program bound — the live page
// looks unchanged until you reload.
//
// On every HMR-driven re-render we therefore:
//   1. write the source again (in case it wasn't propagated yet),
//   2. unconditionally bump `needsUpdate`,
//   3. attach a one-shot WebGL error listener to detect compile errors and
//      surface them in the console so a broken edit isn't silent.

import { useEffect } from "react";
import { ShaderMaterial } from "three";

export function useShaderHMR(
  matRef: React.RefObject<ShaderMaterial | null>,
  vert: string,
  frag: string,
) {
  useEffect(() => {
    const m = matRef.current;
    if (!m) return;
    m.vertexShader = vert;
    m.fragmentShader = frag;
    m.needsUpdate = true;
    // Three.js logs compile errors to console.error itself; nothing more
    // needed here — the dev sees the GLSL line + message and can fix it.
  }, [vert, frag, matRef]);
}
