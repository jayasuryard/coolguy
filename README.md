# Coolguy — Open World (web)

Browser-based open-world game. TypeScript + Vite + three.js + Rapier physics.

## Quick start

```bash
nvm use        # Node 22+ (see .nvmrc)
npm install
npm run dev    # http://localhost:5173
```

Click the canvas to capture the mouse. **WASD** move · **Shift** sprint · **Space** jump ·
**F** fly mode (Space / C = up / down) · **`** toggle debug panel · **Esc** release mouse.

## Scripts

| Command            | What it does                                     |
| ------------------ | ------------------------------------------------ |
| `npm run dev`      | Vite dev server with HMR                         |
| `npm run build`    | Typecheck + production build to `dist/`          |
| `npm run preview`  | Serve the production build locally               |
| `npm run check`    | Typecheck, lint, format check, unit tests        |
| `npm test`         | Vitest once; `npm run test:watch` for watch mode |
| `npm run lint:fix` | ESLint autofix                                   |
| `npm run format`   | Prettier write                                   |

## Stack

| Concern      | Choice                                              | Why                                                |
| ------------ | --------------------------------------------------- | -------------------------------------------------- |
| Rendering    | three.js (WebGL2)                                   | Mature, huge ecosystem; WebGPU renderer available  |
| Physics      | `@dimforge/rapier3d-compat`                         | Fast WASM physics + kinematic character controller |
| Procedural   | `simplex-noise` + seeded PRNG                       | Deterministic, infinite terrain from a seed        |
| Debug / tune | `lil-gui`, three.js `Stats`, Rapier debug render    | Live-edit config, FPS meter, collider wireframes   |
| Tooling      | Vite, TypeScript (strict), ESLint, Prettier, Vitest | Fast HMR, type safety, consistent style, tests     |

## Layout

```
src/
  main.ts                 entry: boots Game, hides loader
  config.ts               every tunable number (live-editable from the debug panel)
  core/
    Game.ts               renderer, physics world, fixed-timestep loop, debug panel wiring
    Input.ts              keyboard / pointer-lock mouse / wheel
  world/
    noise.ts              seeded PRNG, fBm, smoothstep
    terrain.ts            TerrainGenerator: heightAt(x,z), colorAt(h, slope) — pure & deterministic
    chunkMath.ts          chunk coordinate helpers (pure, unit-tested)
    ChunkManager.ts       streams chunk meshes + trimesh colliders around the player
    Environment.ts        sky dome, fog, sun with player-following shadows, water
  player/
    Player.ts             Rapier kinematic capsule, walk/sprint/jump/fly, render interpolation
    ThirdPersonCamera.ts  orbit camera with terrain clamping
  debug/DebugTools.ts     lil-gui, Stats, physics wireframes
public/assets/            static assets (models .glb, textures .ktx2, audio) served as-is
```

### Engine conventions

- **Fixed timestep.** Gameplay/physics run at `CONFIG.physics.fixedDt` (60 Hz) in
  `fixedUpdate`; rendering interpolates between the last two states. Put deterministic logic in
  fixed updates, visual-only logic in per-frame updates.
- **World is a function.** `TerrainGenerator.heightAt(x, z)` is the source of truth for the
  ground. Spawners, AI, foliage placement and the camera should all query it rather than meshes.
- **Chunks** are `CONFIG.chunk.size` world units square, keyed `"cx,cz"`, built nearest-first
  with a per-frame budget and unloaded with hysteresis.

## Suggested next steps

1. Move chunk generation to a Web Worker (transfer the typed arrays back) to remove streaming hitches.
2. Terrain LOD (fewer vertices for distant chunks) to push view distance further.
3. Instanced foliage/rocks per chunk, placed deterministically from the seed.
4. Asset pipeline: glTF + Draco/Meshopt + KTX2 textures via `GLTFLoader`.
5. Save system (`localStorage` / IndexedDB) and later a multiplayer server (e.g. Colyseus / WebSocket).
6. Day/night cycle, swimming, and an ECS (e.g. `bitecs` / `miniplex`) once entity count grows.
