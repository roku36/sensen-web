// GPU particle aura. Vertex shader animates each particle's position over
// time using its index as a stable seed; fragment draws a soft glowing dot.
//
// Used to indicate persistent powers (Combust, Brutality, DemonForm, …).

export const AURA_VERT = /* glsl */ `
  uniform float u_time;
  uniform float u_seed;        // per-aura offset so multiple auras differ
  uniform float u_radius;      // horizontal spread
  uniform float u_height;      // how high particles drift
  uniform float u_size;        // base point size
  uniform vec3  u_origin;      // world-space anchor
  out float vLife;             // 0..1 life fraction
  out float vSeed;

  // Cheap hash.
  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float idx = float(gl_VertexID);
    float seed = idx + u_seed * 1234.5;

    // Each particle has a per-seed lifespan; staggered phase.
    float life = 1.2 + hash(seed * 0.91) * 0.9;
    float phase = mod(u_time + hash(seed) * life, life) / life; // 0..1
    vLife = phase;
    vSeed = seed;

    float a0 = hash(seed * 1.7) * 6.28318;
    float r0 = (0.4 + 0.6 * hash(seed * 3.1)) * u_radius;
    // Spiral upward.
    float spin = a0 + phase * 3.0;
    vec3 offset = vec3(
      cos(spin) * r0 * (1.0 - phase * 0.4),
      phase * u_height,
      sin(spin) * r0 * (1.0 - phase * 0.4)
    );
    // Sway.
    offset.x += sin(u_time * 1.5 + seed) * 0.2 * phase;
    offset.z += cos(u_time * 1.7 + seed) * 0.2 * phase;

    vec3 worldPos = u_origin + offset;
    vec4 mv = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mv;

    // Size shrinks with distance and over life.
    float dist = -mv.z;
    gl_PointSize = u_size * (1.0 - phase * 0.6) * (300.0 / max(dist, 1.0));
  }
`;

export const AURA_FRAG = /* glsl */ `
  precision highp float;
  in float vLife;
  in float vSeed;
  out vec4 fragColor;

  uniform vec3 u_colorHi;
  uniform vec3 u_colorLo;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float falloff = exp(-r * r * 8.0);
    vec3 col = mix(u_colorHi, u_colorLo, vLife) * (1.0 - vLife);
    fragColor = vec4(col * falloff * 1.6, falloff * (1.0 - vLife));
  }
`;
