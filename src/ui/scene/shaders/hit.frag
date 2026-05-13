// Expanding shockwave for damage events. A radial ring with chromatic
// fringes that grows and fades over the effect's lifetime.

precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float u_progress;
uniform float u_intensity;
uniform vec3  u_color;

void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float ang = atan(c.y, c.x);

  float rad = u_progress * 1.05;
  float thick = mix(0.18, 0.04, u_progress);

  float ring = exp(-pow((r - rad) / thick, 2.0) * 4.0);
  float ringR = exp(-pow((r - rad - 0.02) / thick, 2.0) * 4.0);
  float ringB = exp(-pow((r - rad + 0.02) / thick, 2.0) * 4.0);

  float spikes = 0.85 + 0.15 * sin(ang * 24.0 + u_progress * 12.0);
  ring *= spikes; ringR *= spikes; ringB *= spikes;

  float a = (1.0 - u_progress);
  a *= a;
  vec3 col = vec3(ringR, ring, ringB) * u_color * (1.5 + 2.0 * u_intensity);
  fragColor = vec4(col, max(max(ring, ringR), ringB) * a);
  if (fragColor.a < 0.01) discard;
}
