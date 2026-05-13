void main() {
  // Render as a fullscreen quad regardless of geometry transform — the
  // input plane is unit-sized in clip space.
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
