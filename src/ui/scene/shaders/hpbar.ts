// HP bar shader: hp-color gradient (green → yellow → red as HP drops),
// scrolling fluid texture inside the fill, dark empty section, animated
// damage flash and low-HP heartbeat pulse.

export const HPBAR_VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const HPBAR_FRAG = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform float u_time;
  uniform float u_hp;        // 0..1
  uniform float u_flash;     // 0..1, decays after damage
  uniform float u_isSelf;    // 1 self, 0 opponent

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1, 0));
    float c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 uv = vUv;

    // Bar fill mask.
    float fill = step(uv.x, u_hp);

    // HP-driven color: green → yellow → red.
    vec3 hi = vec3(0.20, 0.95, 0.35);
    vec3 mid = vec3(0.95, 0.85, 0.30);
    vec3 lo = vec3(0.95, 0.25, 0.20);
    vec3 hpCol = u_hp > 0.5
      ? mix(mid, hi, smoothstep(0.5, 1.0, u_hp))
      : mix(lo, mid, smoothstep(0.0, 0.5, u_hp));
    if (u_isSelf < 0.5) {
      // Opponent always reads as red regardless of HP, so the player can
      // distinguish their bar at a glance — but desaturate at low HP.
      hpCol = mix(vec3(0.6, 0.2, 0.2), vec3(0.95, 0.35, 0.30), u_hp);
    }

    // Inner flowing fluid (subtle scroll).
    float flow = noise(vec2(uv.x * 6.0 - u_time * 0.6, uv.y * 4.0)) * 0.5
               + noise(vec2(uv.x * 14.0 + u_time * 0.3, uv.y * 8.0)) * 0.25;
    vec3 fillCol = hpCol * (0.7 + 0.5 * flow);

    // Heartbeat pulse when HP is critical.
    float critPulse = smoothstep(0.35, 0.0, u_hp) * (0.5 + 0.5 * sin(u_time * 9.0));
    fillCol += hpCol * critPulse * 0.6;

    // Empty section.
    vec3 emptyCol = vec3(0.05, 0.05, 0.08);
    // Border line at the fill boundary.
    float boundary = smoothstep(0.005, 0.0, abs(uv.x - u_hp));
    vec3 boundaryCol = mix(hpCol, vec3(1.0), 0.6) * boundary;

    vec3 col = mix(emptyCol, fillCol, fill) + boundaryCol;

    // Damage flash washes the whole bar white briefly.
    col = mix(col, vec3(1.0, 0.95, 0.9), u_flash * 0.7);

    // Frame.
    vec2 d = min(uv, 1.0 - uv);
    float frame = smoothstep(0.02, 0.0, min(d.x, d.y));
    col = mix(col, vec3(0.0), frame * 0.7);

    fragColor = vec4(col, 1.0);
  }
`;
