import type { NoiseFunction2D } from 'simplex-noise';
import type { Config } from '../config';
import { fbm2D, seededNoise2D, smoothstep } from './noise';

export type TerrainParams = Config['terrain'];

export interface RGB {
  r: number;
  g: number;
  b: number;
}

const SAND: RGB = { r: 0.76, g: 0.7, b: 0.5 };
const GRASS: RGB = { r: 0.27, g: 0.48, b: 0.2 };
const FOREST: RGB = { r: 0.17, g: 0.34, b: 0.15 };
const ROCK: RGB = { r: 0.42, g: 0.4, b: 0.38 };
const SNOW: RGB = { r: 0.95, g: 0.96, b: 0.98 };

/**
 * Pure, deterministic height + colour function for the whole infinite world.
 * Anything (chunk meshes, colliders, AI, spawners) can query it at any coordinate.
 */
export class TerrainGenerator {
  private readonly detail: NoiseFunction2D;
  private readonly continent: NoiseFunction2D;
  private readonly ridges: NoiseFunction2D;

  constructor(
    private readonly p: TerrainParams,
    seed: number,
  ) {
    this.detail = seededNoise2D(seed);
    this.continent = seededNoise2D(seed + 1);
    this.ridges = seededNoise2D(seed + 2);
  }

  heightAt(x: number, z: number): number {
    const { frequency: f, octaves, persistence, lacunarity } = this.p;
    const fb = { octaves, persistence, lacunarity };

    const continent = fbm2D(this.continent, x * f * 0.3, z * f * 0.3, {
      ...fb,
      octaves: 3,
    });
    const detail = fbm2D(this.detail, x * f, z * f, fb);
    const ridge = 1 - Math.abs(fbm2D(this.ridges, x * f * 0.6, z * f * 0.6, { ...fb, octaves: 4 }));
    const mountainMask = smoothstep(0.05, 0.55, continent);

    return (
      this.p.baseHeight +
      continent * this.p.amplitude +
      detail * this.p.amplitude * 0.35 +
      ridge * ridge * ridge * mountainMask * this.p.mountainHeight
    );
  }

  /** Colour from height and slope (normalY = 1 is flat, 0 is a vertical wall). */
  colorAt(height: number, normalY: number, out: RGB): RGB {
    const sea = this.p.seaLevel;
    let c: RGB;
    if (height < sea + 1.5) c = SAND;
    else if (height < sea + 18) c = GRASS;
    else if (height < sea + 45) c = FOREST;
    else if (height < sea + 70) c = ROCK;
    else c = SNOW;

    // steep slopes become rock regardless of altitude
    const steep = smoothstep(0.82, 0.68, normalY);
    out.r = c.r + (ROCK.r - c.r) * steep;
    out.g = c.g + (ROCK.g - c.g) * steep;
    out.b = c.b + (ROCK.b - c.b) * steep;
    return out;
  }
}
