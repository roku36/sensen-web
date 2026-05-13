import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";

export default defineConfig({
  plugins: [
    react(),
    // .glsl/.frag/.vert imports become strings; #include resolves between them;
    // HMR is wired so editing a shader file hot-swaps it without remounting React.
    glsl({ warnDuplicatedImports: true }),
  ],
  server: { port: 5173 },
  test: {
    globals: true,
    environment: "node",
  },
});
