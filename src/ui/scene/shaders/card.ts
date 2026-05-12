// Card surface shader.
//
// One shader handles every card type via u_type:
//   0 = Attack  → flickering ember pattern, red palette
//   1 = Skill   → crystalline voronoi, cyan palette
//   2 = Power   → swirling vortex, violet palette
//   3 = Status  → cracked static, grey palette
//
// Edge: animated rim highlight. When u_playable=1 it pulses brighter.
// When u_disabled=1 the whole surface desaturates and dims.

export const CARD_VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const CARD_FRAG = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform float u_time;
  uniform float u_type;       // 0..3
  uniform float u_playable;   // 0/1
  uniform float u_disabled;   // 0/1
  uniform float u_hover;      // 0..1

  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.0);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1, 0));
    float c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.0 + 17.0;
      a *= 0.5;
    }
    return v;
  }

  // Cell noise for crystalline skills.
  vec2 voronoi(vec2 p) {
    vec2 g = floor(p), f = fract(p);
    float md = 8.0;
    vec2 mp;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 lat = vec2(float(i), float(j));
      vec2 r = lat + 0.5 + 0.5 * sin(u_time * 0.3 + 6.28 * vec2(hash(g + lat), hash(g + lat + 17.0))) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mp = r; }
    }
    return vec2(md, length(mp));
  }

  // Per-type body color (centered around the typical hue).
  vec3 typeBase() {
    int t = int(u_type + 0.5);
    if (t == 0) return vec3(0.55, 0.10, 0.12);  // attack
    if (t == 1) return vec3(0.10, 0.30, 0.55);  // skill
    if (t == 2) return vec3(0.40, 0.15, 0.55);  // power
    return vec3(0.20, 0.20, 0.22);              // status
  }
  vec3 typeAccent() {
    int t = int(u_type + 0.5);
    if (t == 0) return vec3(1.0, 0.65, 0.20);
    if (t == 1) return vec3(0.50, 0.85, 1.0);
    if (t == 2) return vec3(1.0, 0.50, 1.0);
    return vec3(0.7, 0.7, 0.75);
  }

  // Per-type body texture (center 0.7×0.85 area; edges handled separately).
  float typePattern(vec2 uv, float seed) {
    int t = int(u_type + 0.5);
    if (t == 0) {
      // Embers: rising warped fbm.
      vec2 w = uv * 3.0 + vec2(0.0, -u_time * 0.6);
      float n = fbm(w + fbm(w + u_time * 0.3));
      return smoothstep(0.4, 0.95, n);
    }
    if (t == 1) {
      vec2 v = voronoi(uv * 4.5);
      return smoothstep(0.05, 0.0, v.x) * 1.5 + (1.0 - smoothstep(0.0, 0.5, v.x)) * 0.3;
    }
    if (t == 2) {
      // Spiral vortex — radial.
      vec2 c = uv - 0.5;
      float r = length(c);
      float a = atan(c.y, c.x);
      float swirl = sin(a * 5.0 + r * 18.0 - u_time * 1.5);
      return smoothstep(0.0, 1.0, 0.5 + 0.5 * swirl) * smoothstep(0.55, 0.0, r);
    }
    // Status: cracked static.
    return fbm(uv * 18.0) * 0.6;
  }

  void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;

    // Edge frame: distance from card border (rect SDF in [0,1]^2).
    vec2 d = min(uv, 1.0 - uv);
    float edge = min(d.x, d.y);

    // Body.
    vec3 base = typeBase();
    vec3 accent = typeAccent();
    float pat = typePattern(uv, u_type);
    vec3 col = mix(base * 0.6, base + accent * 0.6, pat);

    // Subtle dark vignette in the body so text is readable.
    col *= 1.0 - 0.35 * dot(c * 1.6, c * 1.6);

    // Animated rim glow.
    float rim = smoothstep(0.06, 0.0, edge);
    float pulse = 0.5 + 0.5 * sin(u_time * 3.0);
    float rimStrength = 0.4 + 0.8 * mix(0.0, pulse, u_playable) + 0.4 * u_hover;
    col += rim * accent * rimStrength;

    // Inner border line.
    float inner = smoothstep(0.075, 0.06, edge) * smoothstep(0.04, 0.05, edge);
    col += inner * accent * 0.8;

    // Disabled: desaturate + dim.
    if (u_disabled > 0.5) {
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(g) * 0.7, 0.7) * 0.55;
    }

    fragColor = vec4(col, 1.0);
  }
`;
