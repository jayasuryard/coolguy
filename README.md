# coolguy

Single-player, desktop-first browser adventure set in Bellweather. Kit Vale, a busking guitarist,
uses his pickup and Mara's broken goggles to protect residents from score-chasing raiders.

This repository follows the **coolguy Game Developer Document**: TypeScript + Vite, a pinned
three.js (`WebGLRenderer`, WebGL 2), Rapier physics, IndexedDB saves and a semantic HTML shell.

## Quick start

```bash
nvm use        # Node 22.18+ (runs the TypeScript tools natively)
npm install
npm run dev    # http://localhost:5173
```

On a **New Game**, Kit starts on his home pitch in Punch Quay. Controls follow the Design document:

| Action            | Keyboard / mouse        | Controller         |
| ----------------- | ----------------------- | ------------------ |
| Move / look       | WASD + mouse            | Left / right stick |
| Jog               | Shift or Space          | LS click or A      |
| Speak, board, use | E                       | X                  |
| Listen and copy   | Hold Q                  | Hold LT            |
| Play phrase       | Hold, release F on beat | Hold, release RT   |
| Select phrase     | Wheel or 1–3            | D-pad left/right   |
| Recenter camera   | R                       | RS click           |
| Goggles           | G                       | D-pad up           |
| Songbook / pause  | Tab / Esc               | View / Menu        |

Dev builds add a **Dev panel** (toggle with the backquote key, `` ` ``). It can force world
versions, grant facts, run the **Punch Clock prerequisites** shortcut, teleport to pads, show
colliders, turn on noclip and tune timing. `window.game` is also exposed in dev.

## Scripts

| Command            | What it does                                                |
| ------------------ | ----------------------------------------------------------- |
| `npm run dev`      | Vite dev server with HMR                                    |
| `npm run build`    | Typecheck + production build to `dist/`                     |
| `npm run preview`  | Serve the production build                                  |
| `npm run validate` | Content builder checks (IDs, cells, facts, receivers, pads) |
| `npm run check`    | Typecheck, lint, format check, validate, unit tests         |
| `npm test`         | Vitest (`npm run test:watch` for watch mode)                |

There is no hosted CI. Run `npm run check` locally before pushing.

## Repository layout

```
game/            the browser app (Vite root)
  index.html     semantic shell: menu, settings dialog, pause, HUD, captions
  src/
    main.ts      boot path: probe WebGL 2 / storage / audio → Start gesture → Game
    Game.ts      wires the five runtime modules; fixed 60 Hz loop
    config.ts    feel constants from the docs (speeds, window, bpm, streaming radii)
    content.ts   bundles content/ at build time
    input/       Input & transport — action map (keyboard, mouse, controller) + timestamped edges
    transport/   Input & transport — AudioContext clock, silent clock, lookahead scheduler, judge
    sim/         Simulation — fixed-step loop, Rapier world, Kit capsule, phrase release, events
    story/       Story & world — facts, missions, ranks, cell grid, version overlays, streaming
    presentation/ Presentation — greybox cell meshes, Kit, spring-arm camera, sky/sun, HUD
    platform/    Platform — capability probes, settings, IndexedDB save store, migrations
    boot/        settings dialog
    debug/       dev-only panel (never loaded in production)
content/         authored data: cells, versions, facts, ranks, phrases, missions (+ types.ts)
art/             art pipeline notes + reference crops (see art/README.md)
tools/           content validator (runs on Node, no build step) + its tests
fixtures/        save fixtures that every schema must keep loading
```

### Engine rules (from the Developer document)

- **Fixed 60 Hz simulation**, catch-up capped at **4 steps**; excess time is dropped. Visuals
  interpolate between the last two snapshots.
- **A hidden tab pauses the world and the transport.** Resuming discards elapsed time, needs a
  click (gesture) and counts in one bar.
- **The transport clock is the AudioContext** (silent mode falls back to monotonic time behind the
  same interface). Input timestamps are mapped onto it, so a release is judged on its own
  timestamp, independent of frame rate. Window: **±180 ms**, with latency calibration and assisted
  release.
- **World:** a 500 × 350 m envelope split into 64 m cells (an 8 × 6 grid). District floors are
  derived automatically; authored objects have stable IDs. **Versions** (Timetable, Backstage,
  Keepsake, Open Score) are overlays that hide or add objects per cell. A version swap reloads
  colliders and visuals on the same tick.
- **Story** is a set of idempotent facts. Missions check `requires` and then commit every effect
  together. Rank is derived from fact sets and never stored.
- **Saves:** IndexedDB with `schemaVersion`, `revision`, the current checkpoint plus the previous
  one, and a pointer, all committed in a single transaction. A stale second tab is detected, not
  overwritten. Export and import work through JSON.

## Adding content

1. Add objects to `content/world/world.json` under their `cell.<col>.<row>`. IDs must be globally
   unique, and the anchor must lie inside that cell.
2. Version-specific changes go in `content/world/versions.json` as `hide` / `add` overlays.
3. New quest facts go in `content/story/facts.json`. Missions in `content/missions/*.json` must
   reference only known facts, receivers, phrases and pads.
4. Run `npm run validate`.

## Status

Done:

- **Environment:** the module architecture, pause/resume and the boot shell.
- **Gameplay:** movement at the documented speeds, the spring-arm camera, the beat clock with
  phrase release, and the Punch Clock mission (unlock, Rank 1, version swap, autosave).
- **Art:** a modeled **Punch Quay kit** from the cloud Blender project, covering tram, platform
  canopy, arcade bays, clock tower, stairs, sea wall, lamps, stalls, Punch Clock, amp and guitar.
  Golden-hour lighting is in place, and the three districts are laid out with kit pieces over
  collider-only blocks. See [art/README.md](art/README.md).

Next:

- Kit's character model from Hunyuan 3D (reference crops are in `art/reference/kit/`).
- The tram on a spline with boarding, and the held-door "Closing Call" at the tram lamp.
- Paz and Ione's schedules, mantling, and recorded motifs in place of the metronome click.
