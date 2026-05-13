// Cost meter shader: radial energy orb that fills as cost accumulates,
// with a roiling fluid surface (domain-warped fbm) and a discharge flash
// when cost is spent.

precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float u_time;
uniform float u_charge;
uniform float u_displayMax;
uniform float u_rate;
uniform vec3  u_baseColor;
uniform float u_pulse;

#include "lib/noise.glsl"

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);

  vec2 warp = vec2(
    fbm(uv * 2.0 + vec2(u_time * 0.4, 0.0)),
    fbm(uv * 2.0 + vec2(0.0, u_time * 0.5))
  );
  float n = fbm(uv * 3.0 + warp * (1.5 + 1.5 * u_charge) + u_time * 0.2);

  float ring = smoothstep(0.86, 0.84, r) - smoothstep(0.74, 0.72, r);
  float fillAng = (ang + 3.14159) / 6.28318;
  float ringFill = step(fillAng, u_charge);

  float body = smoothstep(0.85, 0.0, r);
  float intensity = mix(0.15, 1.0, u_charge) + 0.4 * n * u_charge + u_pulse * 1.5;
  vec3 col = u_baseColor * body * intensity;
  col += vec3(0.4, 0.3, 0.1) * pow(body, 2.5) * (0.6 + 0.6 * sin(u_time * 4.0 + n * 6.0));

  col += vec3(1.0, 0.95, 0.7) * smoothstep(0.0, 0.4, u_charge) * smoothstep(0.5, 0.0, r) * 1.3;

  vec3 ringCol = mix(vec3(0.5, 0.2, 0.05), vec3(1.0, 0.9, 0.4), u_charge);
  col += ring * ringFill * ringCol * 2.5;
  col += ring * (1.0 - ringFill) * vec3(0.1, 0.08, 0.05);

  col += u_pulse * vec3(1.0, 0.9, 0.4) * body * 2.0;
  col += smoothstep(1.0, 0.85, r) * u_baseColor * 0.3 * u_charge;

  float alpha = body + ring;
  if (alpha < 0.001) discard;
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
