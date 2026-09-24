import { defineConfig } from 'vite';

// Demo dev server: `npm run dev` -> http://localhost:5173
// The library itself is built with `npm run build` (tsc -> dist/).
export default defineConfig({
  root: 'demo',
  publicDir: '../public', // serves /models/genderage.onnx
  server: { port: 5173 },
  build: { outDir: '../dist-demo' },
});
