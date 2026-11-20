import type { ContentBundle, VersionId, WorldObject } from '@content/types';
import { cellAt, cellId, inGrid, resolveCell } from './cells';

/** Anything that mirrors loaded cells: physics colliders, render meshes, later audio/nav. */
export interface CellSink {
  loadCell(id: string, objects: WorldObject[]): void;
  unloadCell(id: string): void;
}

/**
 * Decides which ~64 m cells are resident. Loads the occupied cell and its neighbours
 * nearest-first; keeps trailing cells until they are beyond the unload radius.
 * A version swap reloads every resident cell on the same tick, so collision, routes and
 * visuals always change together.
 */
export class CellStreamer {
  private readonly loaded = new Set<string>();
  private readonly coords = new Map<string, { col: number; row: number }>();

  constructor(
    private readonly content: ContentBundle,
    private readonly sinks: CellSink[],
    private readonly loadRadius: number,
    private readonly unloadRadius: number,
  ) {}

  get residentCount(): number {
    return this.loaded.size;
  }

  update(x: number, z: number, version: VersionId, budget = 2): void {
    const here = cellAt(this.content.world, x, z);
    if (!here) return;

    const wanted: Array<{ col: number; row: number; d: number }> = [];
    for (let dr = -this.loadRadius; dr <= this.loadRadius; dr++) {
      for (let dc = -this.loadRadius; dc <= this.loadRadius; dc++) {
        const col = here.col + dc;
        const row = here.row + dr;
        if (!inGrid(this.content.world, col, row)) continue;
        wanted.push({ col, row, d: Math.max(Math.abs(dc), Math.abs(dr)) });
      }
    }
    wanted.sort((a, b) => a.d - b.d);

    let built = 0;
    for (const w of wanted) {
      const id = cellId(w.col, w.row);
      if (this.loaded.has(id)) continue;
      // The occupied cell always loads immediately, regardless of budget.
      if (built >= budget && w.d > 0) break;
      this.load(id, w.col, w.row, version);
      built++;
    }

    for (const id of [...this.loaded]) {
      const c = this.coords.get(id)!;
      if (Math.max(Math.abs(c.col - here.col), Math.abs(c.row - here.row)) > this.unloadRadius) {
        this.unload(id);
      }
    }
  }

  /** Swap every resident cell to another version in one go. */
  reloadAll(version: VersionId): void {
    for (const id of [...this.loaded]) {
      const c = this.coords.get(id)!;
      this.unload(id);
      this.load(id, c.col, c.row, version);
    }
  }

  private load(id: string, col: number, row: number, version: VersionId): void {
    const objects = resolveCell(this.content.world, this.content.versions, col, row, version);
    for (const s of this.sinks) s.loadCell(id, objects);
    this.loaded.add(id);
    this.coords.set(id, { col, row });
  }

  private unload(id: string): void {
    for (const s of this.sinks) s.unloadCell(id);
    this.loaded.delete(id);
    this.coords.delete(id);
  }
}
