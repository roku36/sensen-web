// Soft glowing dot for each aura particle.

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
