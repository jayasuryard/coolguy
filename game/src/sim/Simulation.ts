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
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  ) {
    this.world = new rapier.World({ x: 0, y: CONFIG.sim.gravity, z: 0 });
    this.world.timestep = CONFIG.sim.dt;
    this.addBoundary(bounds);
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

  /** Make colliders added since the last step visible to ray queries (used while building the world). */
  refreshQueries(): void {
    const w = this.world as unknown as { updateSceneQueries?: () => void };
    if (w.updateSceneQueries) w.updateSceneQueries();
    else this.world.step();
  }

  /** Height of whatever is solid at (x, z) seen from the sky, or null over open water. */
  heightAt(x: number, z: number): number | null {
    const ray = new this.rapier.Ray({ x, y: 160, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 260, true, undefined, undefined, this.kit.collider);
    return hit ? 160 - hit.timeOfImpact : null;
  }

  /** Height of the ground under (x, z), searching down from a little above `nearY`. */
  groundY(x: number, z: number, nearY: number): number {
    const top = nearY + 2.5;
    const ray = new this.rapier.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 40, true, undefined, undefined, this.kit.collider);
    return hit ? top - hit.timeOfImpact : nearY;
  }

  /** Invisible walls around the playable envelope. */
  private addBoundary(b: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    const R = this.rapier;
    const h = 60;
    const t = 1;
    const w = (b.maxX - b.minX) / 2;
    const d = (b.maxZ - b.minZ) / 2;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const walls: Array<[number, number, number, number, number, number]> = [
      [cx, h / 2, b.minZ - t, w, h / 2, t],
      [cx, h / 2, b.maxZ + t, w, h / 2, t],
      [b.minX - t, h / 2, cz, t, h / 2, d],
      [b.maxX + t, h / 2, cz, t, h / 2, d],
    ];
    for (const [x, y, z, hx, hy, hz] of walls) {
      this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
    }
  }

  /** A solid box that is moved about (the tram). Call `move` once per frame. */
  addKinematicBox(half: V3): { move(center: V3, yaw: number): void } {
    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.kinematicPositionBased());
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(half.x, half.y, half.z), body);
    return {
      move: (c, yaw) => {
        body.setNextKinematicTranslation(c);
        body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      },
    };
  }

  /** Static box (a building): centre, half extents, yaw in radians. */
  addStaticBox(center: V3, half: V3, yaw = 0): void {
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
    );
  }
}
