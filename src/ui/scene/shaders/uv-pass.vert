// Pass-through vertex shader that forwards uv to the fragment stage.
// Shared by the cost meter, card surface, HP bar, and hit shockwave shaders.

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
