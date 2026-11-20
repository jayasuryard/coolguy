import * as THREE from 'three';
import { pieces, regrowCanopies, withoutPieces, type Blob } from './Foliage';
import { registerLamp } from './ambience';
import { dressBuildings } from './Facades';
import { gltfLoader } from './loader';
import { applySurface } from './Surfaces';

/** The whole-island city export from the Blender project (see art/README.md). */
export const CITY_FILE = 'assets/models/bellweather_city.glb';

/** A tree the Blender scene planted: where it stands and how big its crown was. */
export interface TreeSpot {
  x: number;
  z: number;
  top: number;
  base: number;
  width: number;
  /** Half the footprint along x and z. */
  halfX: number;
  halfZ: number;
  kind: 'pine' | 'planter' | 'fir' | 'plants';
  /** `plants`: the raised box the bed stood on, if any (a planter is built in its place). */
  box?: { minX: number; maxX: number; minZ: number; maxZ: number; top: number; bottom: number };
  /** `plants`: the bed was a flowering one. */
  flowers?: boolean;
}

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
    /** Where the art team planted trees that real tree models now stand in for. */
    readonly treeSpots: TreeSpot[] = [],
  ) {}

  static async load(
    file = CITY_FILE,
    onProgress?: (fraction: number) => void,
    realTrees = false,
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
    const styled = new Set<THREE.Material>();
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
          mat.opacity = 0.62;
          mat.depthWrite = false;
          mat.metalness = 0.6; // mirrors the evening sky
        } else if (mat && mat.name === 'M_bulb') {
          mat.emissiveIntensity = 2.2; // a warm lantern, not a flare
          registerLamp(mat);
        } else if (mat && !styled.has(mat)) {
          styled.add(mat);
          applySurface(mat);
        }
      }
    });
    // Trees. Wide flat canopies are umbrella pines and planter trees: with real tree models
    // available those are handed over (recorded as tree spots); cypresses, shrubs and flowers
    // are regrown in place as fuller canopies.
    const grown: THREE.Mesh[] = [];
    const extras: THREE.Object3D[] = [];
    const spots: TreeSpot[] = [];
    const stems: Array<{ x: number; z: number; y: number }> = [];
    const isTree = (b: Blob, planter: boolean): boolean => {
      const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      const h = b.max.y - b.min.y;
      const green = b.count === 0 || b.color.g >= b.color.r;
      return green && (planter ? w > 2.5 : w > 5 && h < w * 0.6);
    };
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const name = nameOf(mesh);
      if (!mesh.isMesh || !/^CITY_(foliage|civic_flora|quay_planters)$/.test(name)) return;
      const planter = name === 'CITY_quay_planters';
      const canopy = regrowCanopies(mesh, (b) => {
        if (!realTrees) return false;
        const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
        const h = b.max.y - b.min.y;
        const spot = {
          x: (b.min.x + b.max.x) / 2,
          z: (b.min.z + b.max.z) / 2,
          top: b.max.y,
          base: b.min.y,
          width: w,
          halfX: (b.max.x - b.min.x) / 2,
          halfZ: (b.max.z - b.min.z) / 2,
        };
        if (planter && w < 0.8) {
          stems.push({ x: spot.x, z: spot.z, y: b.min.y }); // the tree goes where its stem was
          return true;
        }
        if (isTree(b, planter)) {
          spots.push({
            ...spot,
            base: b.min.y - (planter ? 1.7 : 5),
            kind: planter ? 'planter' : 'pine',
          });
        } else if (h > w * 1.8) {
          spots.push({ ...spot, kind: 'fir' }); // the tall narrow shapes become fir saplings
        } else {
          // low bushes and flower beds become real plants
          spots.push({
            ...spot,
            kind: 'plants',
            flowers: b.count > 0 && b.color.r > b.color.g * 1.1,
          });
        }
        return true;
      });
      if (canopy) grown.push(canopy);
      drop.push(mesh);
    });
    for (const sp of spots) {
      if (sp.kind !== 'planter') continue;
      const stem = stems
        .filter((st) => Math.hypot(st.x - sp.x, st.z - sp.z) < 3)
        .sort((a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z))[0];
      if (stem) Object.assign(sp, { x: stem.x, z: stem.z, base: stem.y });
    }
    // Raised flower beds sit on plain boxes in the quay clutter. Find each bed's box, take it
    // out of the clutter and note its size: a proper planter is built in its place.
    if (spots.length) {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || nameOf(mesh) !== 'CITY_quay_clutter') return;
        const taken: Blob[] = [];
        for (const b of pieces(mesh)) {
          const bed = spots.find(
            (sp) =>
              sp.kind === 'plants' &&
              sp.x > b.min.x &&
              sp.x < b.max.x &&
              sp.z > b.min.z &&
              sp.z < b.max.z &&
              Math.abs(b.max.y - sp.base) < 0.35,
          );
          if (!bed) continue;
          bed.box = {
            minX: b.min.x,
            maxX: b.max.x,
            minZ: b.min.z,
            maxZ: b.max.z,
            top: b.max.y,
            bottom: b.min.y,
          };
          taken.push(b);
        }
        if (!taken.length) return;
        grown.push(
          withoutPieces(mesh, (b) =>
            taken.some((t) => t.min.distanceTo(b.min) < 0.05 && t.max.distanceTo(b.max) < 0.05),
          ),
        );
        drop.push(mesh);
      });
    }
    // trunks: the model trees bring their own, so remove the old ones under handed-over pines
    if (spots.length) {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || nameOf(mesh) !== 'CITY_tree_trunks') return;
        for (const b of pieces(mesh)) {
          const spot = spots.find(
            (sp) =>
              Math.hypot(sp.x - (b.min.x + b.max.x) / 2, sp.z - (b.min.z + b.max.z) / 2) < 3.5,
          );
          if (spot && spot.kind === 'pine') spot.base = b.min.y;
        }
        grown.push(
          withoutPieces(mesh, (b) =>
            spots.some(
              (sp) =>
                sp.kind === 'pine' &&
                Math.hypot(sp.x - (b.min.x + b.max.x) / 2, sp.z - (b.min.z + b.max.z) / 2) < 3.5,
            ),
          ),
        );
        drop.push(mesh);
      });
    }
    // windows, shutters, doors, balconies and the station's ironwork
    const facades = dressBuildings(scene, nameOf);
    for (const [old, fresh] of facades.replace) {
      drop.push(old);
      extras.push(fresh);
    }
    extras.push(...facades.add);
    drop.forEach((o) => o.removeFromParent());
    grown.forEach((m) => scene.add(m));
    extras.forEach((m) => scene.add(m));

    const root = new THREE.Group();
    root.name = 'city';
    root.add(scene);
    onProgress?.(1);
    return new CityModel(root, colliders, spots);
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
  // The Blender scene has a solid box where the tram used to be parked. The tram moves now and
  // carries its own collider, so that box comes out.
  if (nameOf(mesh) === 'COL_quay') {
    const parked = (i: number) =>
      v[i * 3]! > 144.5 && v[i * 3]! < 155.5 && v[i * 3 + 2]! > 288 && v[i * 3 + 2]! < 292;
    const keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      if (parked(idx[t]!) && parked(idx[t + 1]!) && parked(idx[t + 2]!)) continue;
      keep.push(idx[t]!, idx[t + 1]!, idx[t + 2]!);
    }
    idx = Uint32Array.from(keep);
  }
  return { name: nameOf(mesh), vertices: v, indices: idx };
}
