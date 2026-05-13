// HP bar shader: hp-color gradient (green → yellow → red), scrolling fluid,
// damage flash, low-HP heartbeat.

precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float u_time;
uniform float u_hp;
uniform float u_flash;
uniform float u_isSelf;

#include "lib/noise.glsl"

void main() {
  vec2 uv = vUv;
  float fill = step(uv.x, u_hp);

  vec3 hi = vec3(0.20, 0.95, 0.35);
  vec3 mid = vec3(0.95, 0.85, 0.30);
  vec3 lo = vec3(0.95, 0.25, 0.20);
  vec3 hpCol = u_hp > 0.5
    ? mix(mid, hi, smoothstep(0.5, 1.0, u_hp))
    : mix(lo, mid, smoothstep(0.0, 0.5, u_hp));
  if (u_isSelf < 0.5) {
    hpCol = mix(vec3(0.6, 0.2, 0.2), vec3(0.95, 0.35, 0.30), u_hp);
  }

  float flow = vnoise(vec2(uv.x * 6.0 - u_time * 0.6, uv.y * 4.0)) * 0.5
             + vnoise(vec2(uv.x * 14.0 + u_time * 0.3, uv.y * 8.0)) * 0.25;
  vec3 fillCol = hpCol * (0.7 + 0.5 * flow);

  float critPulse = smoothstep(0.35, 0.0, u_hp) * (0.5 + 0.5 * sin(u_time * 9.0));
  fillCol += hpCol * critPulse * 0.6;

  vec3 emptyCol = vec3(0.05, 0.05, 0.08);
  float boundary = smoothstep(0.005, 0.0, abs(uv.x - u_hp));
  vec3 boundaryCol = mix(hpCol, vec3(1.0), 0.6) * boundary;

  vec3 col = mix(emptyCol, fillCol, fill) + boundaryCol;
  col = mix(col, vec3(1.0, 0.95, 0.9), u_flash * 0.7);

  vec2 d = min(uv, 1.0 - uv);
  float frame = smoothstep(0.02, 0.0, min(d.x, d.y));
  col = mix(col, vec3(0.0), frame * 0.7);

  fragColor = vec4(col, 1.0);
}
