// Particle aura vertex shader: derives each particle's world position from
// its index, animating a spiral lift entirely on the GPU.

uniform float u_time;
uniform float u_seed;
uniform float u_radius;
uniform float u_height;
uniform float u_size;
uniform vec3  u_origin;

out float vLife;
out float vSeed;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float idx = float(gl_VertexID);
  float seed = idx + u_seed * 1234.5;

  float life = 1.2 + hash(seed * 0.91) * 0.9;
  float phase = mod(u_time + hash(seed) * life, life) / life;
  vLife = phase;
  vSeed = seed;

  float a0 = hash(seed * 1.7) * 6.28318;
  float r0 = (0.4 + 0.6 * hash(seed * 3.1)) * u_radius;
  float spin = a0 + phase * 3.0;
  vec3 offset = vec3(
    cos(spin) * r0 * (1.0 - phase * 0.4),
    phase * u_height,
    sin(spin) * r0 * (1.0 - phase * 0.4)
  );
  offset.x += sin(u_time * 1.5 + seed) * 0.2 * phase;
  offset.z += cos(u_time * 1.7 + seed) * 0.2 * phase;

  vec3 worldPos = u_origin + offset;
  vec4 mv = modelViewMatrix * vec4(worldPos, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = -mv.z;
  gl_PointSize = u_size * (1.0 - phase * 0.6) * (300.0 / max(dist, 1.0));
}
