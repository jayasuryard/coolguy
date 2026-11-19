/** Pure chunk-grid helpers (no three.js / rapier imports, so they are trivially unit-testable). */

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

export const worldToChunk = (v: number, size: number): number => Math.floor(v / size);

/** Chunk coordinates inside a circular radius, nearest first. */
export function chunksInRadius(cx: number, cz: number, radius: number): Array<[number, number]> {
  const out: Array<[number, number, number]> = [];
  const r2 = radius * radius + radius; // slightly rounder than a pure circle
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2) out.push([cx + dx, cz + dz, d2]);
    }
  }
  out.sort((a, b) => a[2] - b[2]);
  return out.map(([x, z]) => [x, z]);
}
