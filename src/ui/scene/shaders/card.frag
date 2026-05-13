// Card surface shader. One shader handles every card type via u_type,
// plus a back-face branch when u_faceUp is 0.

precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float u_time;
uniform float u_type;       // 0..3
uniform float u_playable;   // 0/1
uniform float u_disabled;   // 0/1
uniform float u_hover;      // 0..1
uniform float u_faceUp;     // 1=front face, 0=back face

#include "lib/noise.glsl"

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

vec3 typeBase() {
  int t = int(u_type + 0.5);
  if (t == 0) return vec3(0.55, 0.10, 0.12);
  if (t == 1) return vec3(0.10, 0.30, 0.55);
  if (t == 2) return vec3(0.40, 0.15, 0.55);
  return vec3(0.20, 0.20, 0.22);
}
vec3 typeAccent() {
  int t = int(u_type + 0.5);
  if (t == 0) return vec3(1.0, 0.65, 0.20);
  if (t == 1) return vec3(0.50, 0.85, 1.0);
  if (t == 2) return vec3(1.0, 0.50, 1.0);
  return vec3(0.7, 0.7, 0.75);
}

float typePattern(vec2 uv, float seed) {
  int t = int(u_type + 0.5);
  if (t == 0) {
    vec2 w = uv * 3.0 + vec2(0.0, -u_time * 0.6);
    float n = fbm(w + fbm(w + u_time * 0.3));
    return smoothstep(0.4, 0.95, n);
  }
  if (t == 1) {
    vec2 v = voronoi(uv * 4.5);
    return smoothstep(0.05, 0.0, v.x) * 1.5 + (1.0 - smoothstep(0.0, 0.5, v.x)) * 0.3;
  }
  if (t == 2) {
    vec2 c = uv - 0.5;
    float r = length(c);
    float a = atan(c.y, c.x);
    float swirl = sin(a * 5.0 + r * 18.0 - u_time * 1.5);
    return smoothstep(0.0, 1.0, 0.5 + 0.5 * swirl) * smoothstep(0.55, 0.0, r);
  }
  return fbm(uv * 18.0) * 0.6;
}

vec3 backFace(vec2 uv) {
  vec2 c = uv - 0.5;
  float r = length(c);
  float ang = atan(c.y, c.x);
  float rings = 0.5 + 0.5 * sin(r * 50.0 - u_time * 0.4);
  float ringMask = smoothstep(0.45, 0.15, r) * smoothstep(0.05, 0.06, r);
  float petals = pow(0.5 + 0.5 * sin(ang * 3.0), 6.0) * smoothstep(0.18, 0.0, r);
  float sheen = pow(max(0.0, sin(ang + u_time * 0.15)), 8.0);
  vec3 col = vec3(0.04, 0.045, 0.07);
  col += vec3(0.18, 0.10, 0.30) * ringMask * rings * 0.4;
  col += vec3(0.95, 0.75, 0.30) * petals;
  col += vec3(0.4, 0.3, 0.6) * sheen * 0.05;
  return col;
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;

  vec2 d = min(uv, 1.0 - uv);
  float edge = min(d.x, d.y);

  vec3 base, accent;
  vec3 col;
  if (u_faceUp < 0.5) {
    col = backFace(uv);
    base = vec3(0.15, 0.10, 0.25);
    accent = vec3(0.6, 0.4, 0.9);
  } else {
    base = typeBase();
    accent = typeAccent();
    float pat = typePattern(uv, u_type);
    col = mix(base * 0.6, base + accent * 0.6, pat);
  }

  col *= 1.0 - 0.35 * dot(c * 1.6, c * 1.6);

  float rim = smoothstep(0.06, 0.0, edge);
  float pulse = 0.5 + 0.5 * sin(u_time * 3.0);
  float rimStrength = 0.4 + 0.8 * mix(0.0, pulse, u_playable) + 0.4 * u_hover;
  col += rim * accent * rimStrength;

  float inner = smoothstep(0.075, 0.06, edge) * smoothstep(0.04, 0.05, edge);
  col += inner * accent * 0.8;

  if (u_disabled > 0.5) {
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g) * 0.7, 0.7) * 0.55;
  }

  fragColor = vec4(col, 1.0);
}
