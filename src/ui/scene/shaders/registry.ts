// Module-scoped shader registry that decouples shader hot-reload from React.
//
// Why this exists: importing a .glsl file directly into a React component
// makes that component an HMR boundary for the shader. When Vite hot-updates
// the .glsl module, the dependent .tsx is invalidated; React Fast Refresh then
// either preserves state or remounts depending on the module's exports and
// any errors in flight. The remount path destroys the ShaderMaterial,
// resetting uniforms (u_time) to 0 and dropping any FX state. The non-remount
// path sometimes leaves the live program out of sync. Both feel like "the
// shader stopped".
//
// Solution: import every shader once here, hold them in a mutable record,
// and let .glsl edits update those records via import.meta.hot.accept ON
// THIS module. Components subscribe to changes and patch their own
// ShaderMaterial when notified — the React tree never re-runs.

import BACKGROUND_VERT from "./background.vert";
import BACKGROUND_FRAG from "./background.frag";
import UV_PASS_VERT from "./uv-pass.vert";
import COST_FRAG from "./cost.frag";
import CARD_FRAG from "./card.frag";
import HPBAR_FRAG from "./hpbar.frag";
import HIT_FRAG from "./hit.frag";
import AURA_VERT from "./aura.vert";
import AURA_FRAG from "./aura.frag";

export type ShaderName = "background" | "cost" | "card" | "hpbar" | "hit" | "aura";

interface Record {
  vert: string;
  frag: string;
  subs: Set<(vert: string, frag: string) => void>;
}

const records: Record[] = [];
const byName: Map<ShaderName, Record> = new Map();

const make = (name: ShaderName, vert: string, frag: string) => {
  const rec: Record = { vert, frag, subs: new Set() };
  records.push(rec);
  byName.set(name, rec);
};

make("background", BACKGROUND_VERT, BACKGROUND_FRAG);
make("cost", UV_PASS_VERT, COST_FRAG);
make("card", UV_PASS_VERT, CARD_FRAG);
make("hpbar", UV_PASS_VERT, HPBAR_FRAG);
make("hit", UV_PASS_VERT, HIT_FRAG);
make("aura", AURA_VERT, AURA_FRAG);

export function getShader(name: ShaderName): { vert: string; frag: string } {
  const r = byName.get(name)!;
  return { vert: r.vert, frag: r.frag };
}

export function subscribeShader(
  name: ShaderName,
  fn: (vert: string, frag: string) => void,
): () => void {
  const r = byName.get(name)!;
  r.subs.add(fn);
  return () => { r.subs.delete(fn); };
}

const notify = (name: ShaderName) => {
  const r = byName.get(name)!;
  for (const fn of r.subs) fn(r.vert, r.frag);
};

// HMR: when any shader file changes, update the corresponding record(s) and
// notify subscribers. This module accepts the updates itself, so Vite never
// has to traverse up to a React component — Fast Refresh stays out of it.
if (import.meta.hot) {
  const update = <K extends ShaderName>(name: K, kind: "vert" | "frag", value: string) => {
    const r = byName.get(name)!;
    r[kind] = value;
    notify(name);
  };

  import.meta.hot.accept("./background.vert", (m) => m && update("background", "vert", m.default));
  import.meta.hot.accept("./background.frag", (m) => m && update("background", "frag", m.default));
  import.meta.hot.accept("./uv-pass.vert", (m) => {
    if (!m) return;
    // uv-pass is shared across many shaders.
    for (const name of ["cost", "card", "hpbar", "hit"] as const) update(name, "vert", m.default);
  });
  import.meta.hot.accept("./cost.frag", (m) => m && update("cost", "frag", m.default));
  import.meta.hot.accept("./card.frag", (m) => m && update("card", "frag", m.default));
  import.meta.hot.accept("./hpbar.frag", (m) => m && update("hpbar", "frag", m.default));
  import.meta.hot.accept("./hit.frag", (m) => m && update("hit", "frag", m.default));
  import.meta.hot.accept("./aura.vert", (m) => m && update("aura", "vert", m.default));
  import.meta.hot.accept("./aura.frag", (m) => m && update("aura", "frag", m.default));
  // The lib helper is #include'd at build time; if it changes the dependents
  // need to re-import. Vite already chains those, so accept any of them.
  import.meta.hot.accept("./lib/noise.glsl", () => { /* dependents re-emit above */ });
}
