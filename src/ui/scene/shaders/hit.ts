// Expanding shockwave for damage events. A radial ring with chromatic
// fringes that grows and fades over the effect's lifetime.

export const HIT_VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const HIT_FRAG = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform float u_progress;   // 0..1 over lifetime
  uniform float u_intensity;  // 0..1, scales brightness/thickness
  uniform vec3  u_color;

  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;       // 0..1 across the plane
    float ang = atan(c.y, c.x);

    // Ring radius expands with progress.
    float rad = u_progress * 1.05;
    float thick = mix(0.18, 0.04, u_progress);

    // Soft annulus.
    float ring = exp(-pow((r - rad) / thick, 2.0) * 4.0);

    // Chromatic fringe: shift the ring slightly per channel.
    float ringR = exp(-pow((r - rad - 0.02) / thick, 2.0) * 4.0);
    float ringB = exp(-pow((r - rad + 0.02) / thick, 2.0) * 4.0);

    // Spiked rim — randomize a bit by angle so it doesn't look flat.
    float spikes = 0.85 + 0.15 * sin(ang * 24.0 + u_progress * 12.0);
    ring *= spikes; ringR *= spikes; ringB *= spikes;

    float a = (1.0 - u_progress);
    a *= a; // ease out
    vec3 col = vec3(ringR, ring, ringB) * u_color * (1.5 + 2.0 * u_intensity);
    fragColor = vec4(col, max(max(ring, ringR), ringB) * a);
    if (fragColor.a < 0.01) discard;
  }
`;
