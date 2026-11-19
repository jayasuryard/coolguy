import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';

/** Small, fast, deterministic PRNG. Same seed => same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededNoise2D(seed: number): NoiseFunction2D {
  return createNoise2D(mulberry32(seed));
}

export interface FbmOptions {
  octaves: number;
  persistence: number;
  lacunarity: number;
}

/** Fractal Brownian motion, normalised to roughly [-1, 1]. */
export function fbm2D(noise: NoiseFunction2D, x: number, y: number, o: FbmOptions): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < o.octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= o.persistence;
    freq *= o.lacunarity;
  }
  return sum / norm;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
