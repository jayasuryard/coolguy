import * as THREE from 'three';
import { gltfLoader } from './loader';

/** The whole-island city export from the Blender project (see art/README.md). */
export const CITY_FILE = 'assets/models/bellweather_city.glb';

/** World-space triangle soup for one collider. */
export interface ColliderMesh {
  name: string;
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Naming contract with the Blender scene:
 *  - `COL_*`      collision only (never rendered)
 *  - `*__col`     rendered AND used for collision (e.g. the terrain)
 *  - `REVIEW_*`, cameras and lights are review-only and skipped.
 */
export class CityModel {
  private constructor(
    readonly root: THREE.Group,
    readonly colliders: ColliderMesh[],
  ) {}

  static async load(
    file = CITY_FILE,
    onProgress?: (fraction: number) => void,
  ): Promise<CityModel | null> {
    let gltf;
    try {
      gltf = await gltfLoader().loadAsync(import.meta.env.BASE_URL + file, (e) => {
        if (e.total) onProgress?.(Math.min(0.95, e.loaded / e.total));
      });
    } catch (err) {
      console.warn('[city] no city model; falling back to greybox floors', err);
      return null;
    }
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    const drop: THREE.Object3D[] = [];
    const colliders: ColliderMesh[] = [];
    scene.traverse((o) => {
      if (
        o.name.startsWith('REVIEW_') ||
        (o as THREE.Camera).isCamera ||
        (o as THREE.Light).isLight
      ) {
        drop.push(o);
        return;
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const isColOnly = nameOf(mesh).startsWith('COL_');
      const isCol = isColOnly || nameOf(mesh).endsWith('__col');
      if (isCol) colliders.push(toCollider(mesh));
      if (isColOnly) drop.push(o);
      else {
        mesh.castShadow = !nameOf(mesh).startsWith('CITY_terrain');
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.name === 'M_glass') {
          mat.transparent = true;
          mat.opacity = 0.55;
          mat.depthWrite = false;
        }
      }
    });
    drop.forEach((o) => o.removeFromParent());

    const root = new THREE.Group();
    root.name = 'city';
    root.add(scene);
    onProgress?.(1);
    return new CityModel(root, colliders);
  }
}

/** glTF splits a mesh with several materials into children; the Blender name lives on the parent. */
function nameOf(o: THREE.Object3D): string {
  return o.parent && o.name.startsWith(o.parent.name + '_') ? o.parent.name : o.name;
}

function toCollider(mesh: THREE.Mesh): ColliderMesh {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const v = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    v[i * 3] = p.x;
    v[i * 3 + 1] = p.y;
    v[i * 3 + 2] = p.z;
  }
  let idx: Uint32Array;
  if (g.index) idx = new Uint32Array(g.index.array);
  else idx = Uint32Array.from({ length: pos.count }, (_, i) => i);
  return { name: nameOf(mesh), vertices: v, indices: idx };
}
