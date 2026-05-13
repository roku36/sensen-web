// HMR-aware ShaderMaterial wrapper.
//
// Why: when a .glsl file is edited Vite re-imports the module and notifies
// any subscribers via import.meta.hot. We pipe those notifications into the
// ShaderMaterial by replacing its source strings and flagging it for
// re-link, so the GPU program is rebuilt without remounting React — uniforms
// like u_time keep ticking instead of resetting to 0.

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
    if (m.vertexShader !== vert || m.fragmentShader !== frag) {
      m.vertexShader = vert;
      m.fragmentShader = frag;
      m.needsUpdate = true;
    }
  }, [vert, frag, matRef]);
}
