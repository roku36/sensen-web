// React hook that hands a ShaderMaterial the current shader source for a given
// registry entry, and re-applies new source whenever the registry notifies it.
//
// React itself is never touched by HMR — this hook just patches the live
// material in place and bumps `needsUpdate` so Three.js re-links the program.

import { useEffect } from "react";
import { ShaderMaterial } from "three";
import { getShader, ShaderName, subscribeShader } from "./registry";

export function useShader(name: ShaderName) {
  return getShader(name);
}

export function useShaderHotReload(
  matRef: React.RefObject<ShaderMaterial | null>,
  name: ShaderName,
) {
  useEffect(() => {
    const apply = (vert: string, frag: string) => {
      const m = matRef.current;
      if (!m) return;
      m.vertexShader = vert;
      m.fragmentShader = frag;
      m.needsUpdate = true;
    };
    return subscribeShader(name, apply);
  }, [matRef, name]);
}
