// Cost meter shader.
//
// A radial energy orb that fills as cost accumulates, with a roiling fluid
// surface (domain-warped fbm) and a discharge flash when cost is spent.

export const COST_VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const COST_FRAG = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform float u_time;
  uniform float u_charge;       // 0..1, current cost / display max
  uniform float u_displayMax;   // raw current cost shown in label
  uniform float u_rate;         // per-second accrual
  uniform vec3  u_baseColor;    // tint (e.g. amber)
  uniform float u_pulse;        // 0..1 spike for "spent cost" flash

  // Hash + value noise.
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float r = length(uv);
    float ang = atan(uv.y, uv.x);

    // Domain-warped flow that swirls as cost climbs.
    vec2 warp = vec2(
      fbm(uv * 2.0 + vec2(u_time * 0.4, 0.0)),
      fbm(uv * 2.0 + vec2(0.0, u_time * 0.5))
    );
    float n = fbm(uv * 3.0 + warp * (1.5 + 1.5 * u_charge) + u_time * 0.2);

    // Outer ring (always visible) — thin progress arc on top of the orb.
    float ring = smoothstep(0.86, 0.84, r) - smoothstep(0.74, 0.72, r);
    float fillAng = (ang + 3.14159) / 6.28318;
    float ringFill = step(fillAng, u_charge);

    // Body of the orb fades from dark to base color → white-hot.
    float body = smoothstep(0.85, 0.0, r);
    float intensity = mix(0.15, 1.0, u_charge) + 0.4 * n * u_charge + u_pulse * 1.5;
    vec3 col = u_baseColor * body * intensity;
    col += vec3(0.4, 0.3, 0.1) * pow(body, 2.5) * (0.6 + 0.6 * sin(u_time * 4.0 + n * 6.0));

    // Bright core when full.
    col += vec3(1.0, 0.95, 0.7) * smoothstep(0.0, 0.4, u_charge) * smoothstep(0.5, 0.0, r) * 1.3;

    // Ring color: progress green → amber → white as charge climbs.
    vec3 ringCol = mix(vec3(0.5, 0.2, 0.05), vec3(1.0, 0.9, 0.4), u_charge);
    col += ring * ringFill * ringCol * 2.5;
    col += ring * (1.0 - ringFill) * vec3(0.1, 0.08, 0.05);

    // Discharge flash.
    col += u_pulse * vec3(1.0, 0.9, 0.4) * body * 2.0;

    // Soft outer glow.
    col += smoothstep(1.0, 0.85, r) * u_baseColor * 0.3 * u_charge;

    float alpha = body + ring;
    if (alpha < 0.001) discard;
    fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;
