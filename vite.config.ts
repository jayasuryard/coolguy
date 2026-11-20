/// <reference types="vitest/config" />
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Dev only: `POST /__snap?name=quay` with a canvas data-URL body writes art/snaps/quay.jpg.
 * Lets in-game captures be saved from the browser while developing; absent from builds.
 */
const devSnaps = (): Plugin => ({
  name: 'dev-snaps',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__snap', (req, res) => {
      const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'snap').replace(
        /[^a-z0-9_-]/gi,
        '',
      );
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const data = Buffer.concat(chunks)
          .toString('utf8')
          .replace(/^data:image\/\w+;base64,/, '');
        mkdirSync(r('./art/snaps'), { recursive: true });
        writeFileSync(r(`./art/snaps/${name}.jpg`), Buffer.from(data, 'base64'));
        res.end('ok');
      });
    });
  },
});

export default defineConfig({
  plugins: [devSnaps()],
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
