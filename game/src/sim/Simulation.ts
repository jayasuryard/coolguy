import type RAPIER from '@dimforge/rapier3d-compat';
import type { WorldObject } from '@content/types';
import { CONFIG } from '../config';
import { rampTransform } from '../story/geometry';
import type { CellSink } from '../story/CellStreamer';
import { Kit, type KitIntent, type V3 } from './Kit';

/** Owns the physics world: static cell colliders, Kit, and spatial queries. */
export class Simulation implements CellSink {
  readonly world: RAPIER.World;
  readonly kit: Kit;
  private readonly cellColliders = new Map<string, RAPIER.Collider[]>();

  constructor(
    private readonly rapier: typeof RAPIER,
    spawn: V3,
    bounds: { width: number; depth: number },
  ) {
    this.world = new rapier.World({ x: 0, y: CONFIG.sim.gravity, z: 0 });
    this.world.timestep = CONFIG.sim.dt;
    this.addBoundary(bounds.width, bounds.depth);
    this.kit = new Kit(rapier, this.world, spawn);
  }

  step(intent: KitIntent): void {
    this.kit.fixedUpdate(CONFIG.sim.dt, intent);
    this.world.step();
    this.kit.postStep(CONFIG.sim.dt);
  }

  // ---- CellSink ----
  loadCell(id: string, objects: WorldObject[]): void {
    const R = this.rapier;
    const list: RAPIER.Collider[] = [];
    for (const o of objects) {
      if (o.kind === 'block' && o.collide !== false) {
        const [hx, hy, hz] = o.size.map((v) => v / 2) as [number, number, number];
        list.push(
          this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(...o.center)),
        );
      } else if (o.kind === 'ramp') {
        const t = rampTransform(o);
        const [x, y, z, w] = t.rotation;
        list.push(
          this.world.createCollider(
            R.ColliderDesc.cuboid(...t.halfExtents)
              .setTranslation(...t.center)
              .setRotation({ x, y, z, w }),
          ),
        );
      }
    }
    this.cellColliders.set(id, list);
  }

  /** Static trimesh collider from world-space triangles (city terrain, COL_* pieces). */
  addStaticMesh(vertices: Float32Array, indices: Uint32Array): void {
    this.world.createCollider(this.rapier.ColliderDesc.trimesh(vertices, indices));
  }

  unloadCell(id: string): void {
    for (const c of this.cellColliders.get(id) ?? []) this.world.removeCollider(c, false);
    this.cellColliders.delete(id);
  }

  /** Distance along a ray until it hits static geometry (excluding Kit), or maxDist. */
  rayDistance(origin: V3, dir: V3, maxDist: number): number {
    const ray = new this.rapier.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, this.kit.collider);
    return hit ? hit.timeOfImpact : maxDist;
  }

  /** Invisible walls around the playable envelope. */
  private addBoundary(w: number, d: number): void {
    const R = this.rapier;
    const h = 60;
    const t = 1;
    const walls: Array<[number, number, number, number, number, number]> = [
      [w / 2, h / 2, -t, w / 2, h / 2, t],
      [w / 2, h / 2, d + t, w / 2, h / 2, t],
      [-t, h / 2, d / 2, t, h / 2, d / 2],
      [w + t, h / 2, d / 2, t, h / 2, d / 2],
    ];
    for (const [x, y, z, hx, hy, hz] of walls) {
      this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
    }
  }
}
