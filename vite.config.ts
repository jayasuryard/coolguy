/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./game'),
  publicDir: r('./game/public'),
  resolve: {
    alias: {
      '@': r('./game/src'),
      '@content': r('./content'),
    },
  },
  server: { port: 5173, strictPort: true },
  // game/viewer.html is a dev-only model viewer and is not part of the production build.
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // three + rapier (WASM inlined) are large by nature; split per district later.
    chunkSizeWarningLimit: 6000,
  },
  test: {
    root: r('.'),
    environment: 'node',
    include: ['game/src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
