// vite-plugin-glsl exposes shader files as plain string default exports.
declare module "*.glsl" { const src: string; export default src; }
declare module "*.frag" { const src: string; export default src; }
declare module "*.vert" { const src: string; export default src; }
