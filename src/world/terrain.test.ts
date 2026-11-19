import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { chunkKey, chunksInRadius, worldToChunk } from './chunkMath';
import { mulberry32 } from './noise';
import { TerrainGenerator } from './terrain';

describe('mulberry32', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('TerrainGenerator', () => {
  it('returns identical heights for the same seed', () => {
    const t1 = new TerrainGenerator(CONFIG.terrain, 7);
    const t2 = new TerrainGenerator(CONFIG.terrain, 7);
    for (const [x, z] of [
      [0, 0],
      [123.4, -987.6],
      [1e5, 1e5],
    ] as const) {
      expect(t1.heightAt(x, z)).toBe(t2.heightAt(x, z));
    }
  });

  it('differs between seeds', () => {
    const t1 = new TerrainGenerator(CONFIG.terrain, 1);
    const t2 = new TerrainGenerator(CONFIG.terrain, 2);
    expect(t1.heightAt(500, 500)).not.toBe(t2.heightAt(500, 500));
  });

  it('stays within a sane height range', () => {
    const t = new TerrainGenerator(CONFIG.terrain, CONFIG.seed);
    for (let i = 0; i < 2000; i++) {
      const h = t.heightAt(i * 37.1, i * -19.3);
      expect(Number.isFinite(h)).toBe(true);
      expect(Math.abs(h)).toBeLessThan(400);
    }
  });
});

describe('chunk math', () => {
  it('maps world coordinates to chunks (including negatives)', () => {
    expect(worldToChunk(0, 64)).toBe(0);
    expect(worldToChunk(63.9, 64)).toBe(0);
    expect(worldToChunk(64, 64)).toBe(1);
    expect(worldToChunk(-0.1, 64)).toBe(-1);
    expect(chunkKey(-3, 4)).toBe('-3,4');
  });

  it('lists chunks nearest first with no duplicates', () => {
    const list = chunksInRadius(10, -5, 4);
    expect(list[0]).toEqual([10, -5]);
    expect(new Set(list.map(([x, z]) => chunkKey(x, z))).size).toBe(list.length);
    for (const [x, z] of list) expect(Math.hypot(x - 10, z + 5)).toBeLessThanOrEqual(4.5);
  });
});
