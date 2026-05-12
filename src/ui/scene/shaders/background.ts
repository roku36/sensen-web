// Background fragment shader.
//
// Adapted from "Rainbow Travel" by Noztol on FragCoord.xyz
//   https://fragcoord.xyz/s/rxhy4i5t
// (which itself is based on https://fragcoord.xyz/s/fx196wc1 with XorDev's
// color scheme.) Slightly slowed down and dimmed so it sits behind the
// gameplay HUD without overpowering it.

export const BACKGROUND_VERT = /* glsl */ `
  void main() {
    // Render as a fullscreen quad regardless of geometry transform — the
    // input plane is unit-sized in clip space.
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

export const BACKGROUND_FRAG = /* glsl */ `
  precision highp float;
  out vec4 fragColor;

  uniform float u_time;
  uniform vec2  u_resolution;
  uniform float u_intensity; // 0..1, dims the whole image so cards stay readable

  vec3 getPathPosition(float z) {
    return vec3(12.0 * cos(z * vec2(0.1, 0.12)), z);
  }

  void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    vec2 uv = (fragCoord - u_resolution.xy * 0.5) / u_resolution.y;

    // Slow it down — the original 4x scrolls too fast for a backdrop.
    float t = u_time * 1.6;
    float animTime = t + 5.0 + 5.0 * sin(t * 0.3);

    vec3 rayOrigin = getPathPosition(animTime);
    vec3 lookTarget = getPathPosition(animTime + 4.0);
    vec3 forward = normalize(lookTarget - rayOrigin);
    vec3 right = normalize(vec3(-forward.z, 0.0, forward.x));
    vec3 up = cross(forward, right);
    vec3 rayDir = normalize(uv.x * right + uv.y * up + forward);

    float stepDist = 1.0;
    float totalDist = 0.0;
    float orbDist = 1.0;
    vec3 accumulatedColor = vec3(0.0);
    vec3 rayPos = rayOrigin;

    for (float i = 1.0; i <= 24.0; i++) {
      if (totalDist >= 28.0) break;

      rayPos += rayDir * stepDist;
      vec3 pathCenter = getPathPosition(rayPos.z);
      float sineTime = sin(t);

      vec3 orbCenter = vec3(
        pathCenter.x + sineTime,
        pathCenter.y + sineTime * 2.0,
        6.0 + animTime + sineTime * 2.0
      );
      orbDist = length(rayPos - orbCenter) - 0.01;

      float baseRadius = cos(rayPos.z * 0.6) * 2.0 + 4.0;
      float tunnelStructure = min(
        length(rayPos.xy - pathCenter.x - 6.0),
        length((rayPos - pathCenter).xy)
      );

      float largeScoops = abs(dot(sin(0.4 * rayPos), vec3(0.25))) / 0.1;
      float detailTexture = abs(dot(sin(animTime + 16.0 * rayPos), vec3(0.22))) / 2.0;
      float carvedDist = baseRadius - tunnelStructure + largeScoops + detailTexture;

      vec3 fluidPos = rayPos;
      for (float j = 1.0; j <= 6.0; j++) {
        fluidPos += sin(fluidPos.yzx * j + t + 0.5 * i) / j;
      }
      float fluidTunnelDist = 0.4 * length(vec4(0.3 * cos(fluidPos) - 0.3, carvedDist));

      stepDist = min(orbDist, fluidTunnelDist);
      totalDist += stepDist;

      vec3 palette = 1.0 + cos(fluidPos.y + i * 0.4 + vec3(6.0, 1.0, 2.0));
      accumulatedColor += (2.5 * palette / stepDist + 10.0 * palette / max(orbDist, 0.6)) / i;
    }

    vec3 col = tanh(accumulatedColor * accumulatedColor / 1500.0);
    // Dim by u_intensity, plus a subtle vignette so the play area pops.
    float vig = 1.0 - 0.45 * dot(uv, uv);
    fragColor = vec4(col * u_intensity * vig, 1.0);
  }
`;
