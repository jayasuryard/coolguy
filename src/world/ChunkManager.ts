import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Config } from '../config';
import { chunkKey, chunksInRadius, worldToChunk } from './chunkMath';
import type { RGB, TerrainGenerator } from './terrain';

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  collider: RAPIER.Collider;
}

/**
 * Streams terrain chunks (render mesh + physics trimesh) in and out around a focus point.
 * Generation is budgeted per frame; move it to a Web Worker once generation gets heavier.
 */
export class ChunkManager {
  private readonly chunks = new Map<string, Chunk>();
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  private wanted: Array<[number, number]> = [];
  private wantedFor = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly rapier: typeof RAPIER,
    private readonly world: RAPIER.World,
    private terrain: TerrainGenerator,
    private readonly cfg: Config['chunk'],
  ) {}

  get loadedCount(): number {
    return this.chunks.size;
  }

  get pendingCount(): number {
    let n = 0;
    for (const [cx, cz] of this.wanted) if (!this.chunks.has(chunkKey(cx, cz))) n++;
    return n;
  }

  set wireframe(v: boolean) {
    this.material.wireframe = v;
  }

  update(focus: THREE.Vector3, budget = this.cfg.buildsPerFrame): void {
    const { size, viewDistance } = this.cfg;
    const ccx = worldToChunk(focus.x, size);
    const ccz = worldToChunk(focus.z, size);

    const wantedKey = `${ccx},${ccz},${viewDistance}`;
    if (wantedKey !== this.wantedFor) {
      this.wanted = chunksInRadius(ccx, ccz, viewDistance);
      this.wantedFor = wantedKey;
    }

    let built = 0;
    for (const [cx, cz] of this.wanted) {
      if (built >= budget) break;
      const key = chunkKey(cx, cz);
      if (this.chunks.has(key)) continue;
      this.chunks.set(key, this.build(cx, cz));
      built++;
    }

    // Unload with a little hysteresis so walking along a border doesn't thrash.
    const limit2 = (viewDistance + 1.5) ** 2;
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - ccx;
      const dz = chunk.cz - ccz;
      if (dx * dx + dz * dz > limit2) {
        this.dispose(chunk);
        this.chunks.delete(key);
      }
    }
  }

  private build(cx: number, cz: number): Chunk {
    const { size, resolution: res } = this.cfg;
    const cell = size / res;
    const ox = cx * size;
    const oz = cz * size;
    const n = res + 1; // vertices per edge
    const g = res + 3; // sampled grid incl. 1-cell border (for seamless normals)

    const heights = new Float32Array(g * g);
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        heights[j * g + i] = this.terrain.heightAt(ox + (i - 1) * cell, oz + (j - 1) * cell);
      }
    }
    const h = (i: number, j: number) => heights[(j + 1) * g + (i + 1)]!;

    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const rgb: RGB = { r: 0, g: 0, b: 0 };

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = (j * n + i) * 3;
        const y = h(i, j);
        positions[v] = i * cell;
        positions[v + 1] = y;
        positions[v + 2] = j * cell;

        const nx = h(i - 1, j) - h(i + 1, j);
        const nz = h(i, j - 1) - h(i, j + 1);
        const ny = 2 * cell;
        const len = Math.hypot(nx, ny, nz);
        normals[v] = nx / len;
        normals[v + 1] = ny / len;
        normals[v + 2] = nz / len;

        this.terrain.colorAt(y, ny / len, rgb);
        colors[v] = rgb.r;
        colors[v + 1] = rgb.g;
        colors[v + 2] = rgb.b;
      }
    }

    const indices = new Uint32Array(res * res * 6);
    let k = 0;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(ox, 0, oz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `chunk ${cx},${cz}`;
    this.scene.add(mesh);

    const colliderDesc = this.rapier.ColliderDesc.trimesh(positions, indices).setTranslation(
      ox,
      0,
      oz,
    );
    const collider = this.world.createCollider(colliderDesc);

    return { cx, cz, mesh, collider };
  }

  private dispose(chunk: Chunk): void {
    this.scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    this.world.removeCollider(chunk.collider, false);
  }

  /** Swap the height function (e.g. new seed) and rebuild everything. */
  setTerrain(terrain: TerrainGenerator): void {
    this.disposeAll();
    this.terrain = terrain;
  }

  disposeAll(): void {
    for (const c of this.chunks.values()) this.dispose(c);
    this.chunks.clear();
    this.wantedFor = '';
  }
}
