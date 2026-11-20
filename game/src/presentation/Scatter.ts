import * as THREE from 'three';

export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Radians around +Y. */
  yaw: number;
  scale: number;
  /** Optional lean (radians) about X and Z, for rocks and logs. */
  tiltX?: number;
  tiltZ?: number;
  /** Optional non-uniform stretch along the model's own x / y / z. */
  stretch?: [number, number, number];
}

/**
 * Draws one model many times with GPU instancing: a whole hillside of trees, rocks or grass
 * costs one draw call per mesh of the model, however many copies there are.
 */
/** Side of a scatter group in metres. */
const CHUNK = 64;

export class Scatter {
  readonly root = new THREE.Group();

  constructor(private readonly models: Map<string, THREE.Object3D>) {
    this.root.name = 'scatter';
  }

  has(name: string): boolean {
    return this.models.has(name);
  }

  private readonly chunks: Array<{
    mesh: THREE.InstancedMesh;
    centre: THREE.Vector3;
    reach: number;
  }> = [];

  /**
   * `tint` multiplies the model's colour (values above 1 brighten it). Copies are grouped into
   * CHUNK-metre squares, each its own instanced mesh, so whole groups drop out when they are
   * off-screen or further than `maxDistance` (small things like grass need not be drawn far away).
   */
  add(
    name: string,
    placements: Placement[],
    shadows = true,
    tint?: [number, number, number],
    maxDistance = Infinity,
  ): void {
    const source = this.models.get(name);
    if (!source || !placements.length) return;
    source.updateMatrixWorld(true);
    const groups = new Map<string, Placement[]>();
    for (const pl of placements) {
      const key = `${Math.floor(pl.x / CHUNK)},${Math.floor(pl.z / CHUNK)}`;
      groups.set(key, [...(groups.get(key) ?? []), pl]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    source.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (tint) material.color.setRGB(tint[0], tint[1], tint[2]);
      if (material.alphaTest > 0) {
        material.alphaToCoverage = true; // soft leaf edges with MSAA
        material.side = THREE.DoubleSide;
        material.shadowSide = THREE.DoubleSide;
      }
      for (const group of groups.values()) {
        const inst = new THREE.InstancedMesh(mesh.geometry, material, group.length);
        group.forEach((pl, i) => {
          q.setFromEuler(e.set(pl.tiltX ?? 0, pl.yaw, pl.tiltZ ?? 0, 'YXZ'));
          s.set(pl.scale, pl.scale, pl.scale);
          if (pl.stretch)
            s.set(pl.scale * pl.stretch[0], pl.scale * pl.stretch[1], pl.scale * pl.stretch[2]);
          m.compose(p.set(pl.x, pl.y, pl.z), q, s).multiply(mesh.matrixWorld);
          inst.setMatrixAt(i, m);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.castShadow = shadows;
        inst.receiveShadow = true;
        inst.name = `${name}:${mesh.name}`;
        this.root.add(inst);
        const sphere = inst.boundingSphere!;
        this.chunks.push({
          mesh: inst,
          centre: sphere.center.clone(),
          reach: maxDistance + sphere.radius,
        });
      }
    });
  }

  /** Hide the groups that are beyond their distance limit from the camera. */
  cull(camera: THREE.Vector3): void {
    for (const c of this.chunks) c.mesh.visible = c.centre.distanceTo(camera) < c.reach;
  }
}
