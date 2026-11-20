import type {
  BlockDef,
  DistrictDef,
  VersionId,
  WorldDef,
  WorldObject,
  VersionDef,
} from '@content/types';

/** Pure cell-grid helpers: IDs, lookup and version-overlay resolution. */

export const cellId = (col: number, row: number): string => `cell.${col}.${row}`;

export function cellAt(world: WorldDef, x: number, z: number): { col: number; row: number } | null {
  const col = Math.floor(x / world.cellSize);
  const row = Math.floor(z / world.cellSize);
  return inGrid(world, col, row) ? { col, row } : null;
}

/** Whether a cell index lies inside the world's grid (which may start at negative indices). */
export function inGrid(world: WorldDef, col: number, row: number): boolean {
  const c0 = world.minCol ?? 0;
  const r0 = world.minRow ?? 0;
  return col >= c0 && row >= r0 && col < c0 + world.cols && row < r0 + world.rows;
}

/** The world's extent in metres. */
export function worldBounds(world: WorldDef): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  const s = world.cellSize;
  const c0 = world.minCol ?? 0;
  const r0 = world.minRow ?? 0;
  return { minX: c0 * s, minZ: r0 * s, maxX: (c0 + world.cols) * s, maxZ: (r0 + world.rows) * s };
}

/** Name of the district at a point: mainland regions first, then the island's rows. */
export function districtAt(world: WorldDef, x: number, z: number): DistrictDef | undefined {
  for (const d of world.districts) {
    if (d.region && pointInPolygon(x, z, d.region)) return d;
  }
  const island = x >= 0 && x < 8 * world.cellSize;
  return island ? districtForRow(world, Math.floor(z / world.cellSize)) : undefined;
}

export function pointInPolygon(x: number, z: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function floorYForRow(world: WorldDef, row: number): number {
  return world.districts.find((d) => d.rows.includes(row))?.floorY ?? 0;
}

export function districtForRow(world: WorldDef, row: number) {
  return world.districts.find((d) => d.rows.includes(row));
}

/** The floor slab every cell gets automatically, extending down so cliff faces are solid. */
export function floorBlock(world: WorldDef, col: number, row: number): BlockDef {
  const s = world.cellSize;
  const top = floorYForRow(world, row);
  const bottom = -2;
  return {
    id: `${cellId(col, row)}.floor`,
    kind: 'block',
    center: [col * s + s / 2, (top + bottom) / 2, row * s + s / 2],
    size: [s, top - bottom, s],
    color: districtForRow(world, row)?.color ?? '#888888',
  };
}

/** Objects present in a cell for a given version: base − hidden + added. */
export function resolveCell(
  world: WorldDef,
  versions: VersionDef[],
  col: number,
  row: number,
  version: VersionId,
): WorldObject[] {
  const id = cellId(col, row);
  const base = world.cells.find((c) => c.id === id)?.objects ?? [];
  const overlays =
    versions.find((v) => v.id === version)?.overlays.filter((o) => o.cell === id) ?? [];
  const hidden = new Set(overlays.flatMap((o) => o.hide ?? []));
  return [
    ...(world.autoFloors === false ? [] : [floorBlock(world, col, row)]),
    ...base.filter((o) => !hidden.has(o.id)),
    ...overlays.flatMap((o) => o.add ?? []),
  ];
}

export function findObject(
  world: WorldDef,
  versions: VersionDef[],
  id: string,
): WorldObject | undefined {
  for (const c of world.cells) {
    const o = c.objects.find((x) => x.id === id);
    if (o) return o;
  }
  for (const v of versions) {
    for (const ov of v.overlays) {
      const o = ov.add?.find((x) => x.id === id);
      if (o) return o;
    }
  }
  return undefined;
}
