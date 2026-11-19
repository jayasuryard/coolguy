/**
 * Central tuning values. Mutable on purpose so the debug panel can live-edit them.
 */
export const CONFIG = {
  seed: 1337,
  chunk: {
    /** World units per chunk edge. */
    size: 64,
    /** Grid cells per chunk edge (vertices = resolution + 1). */
    resolution: 64,
    /** Radius, in chunks, kept loaded around the player. */
    viewDistance: 5,
    /** Max chunks generated per frame (keeps frame time stable while streaming). */
    buildsPerFrame: 2,
  },
  terrain: {
    seaLevel: 0,
    baseHeight: 4,
    amplitude: 45,
    mountainHeight: 90,
    frequency: 0.0022,
    octaves: 5,
    persistence: 0.5,
    lacunarity: 2,
  },
  player: {
    walkSpeed: 8,
    sprintSpeed: 16,
    flySpeed: 60,
    jumpSpeed: 9,
    gravity: -25,
    radius: 0.4,
    halfHeight: 0.5,
  },
  physics: {
    fixedDt: 1 / 60,
  },
};

export type Config = typeof CONFIG;
