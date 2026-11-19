import type { BlockDef, VersionId, WorldDef, WorldObject, VersionDef } from '@content/types';

/** Pure cell-grid helpers: IDs, lookup and version-overlay resolution. */

export const cellId = (col: number, row: number): string => `cell.${col}.${row}`;

export function cellAt(world: WorldDef, x: number, z: number): { col: number; row: number } | null {
  const col = Math.floor(x / world.cellSize);
  const row = Math.floor(z / world.cellSize);
  if (col < 0 || row < 0 || col >= world.cols || row >= world.rows) return null;
  return { col, row };
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
