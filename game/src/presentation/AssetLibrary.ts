import * as THREE from 'three';
import type { CastClips } from './CastAnimator';
import { gltfLoader } from './loader';

/** Kit GLBs exported from the Blender kit project (see art/README.md). */
export const KIT_FILES = [
  'assets/models/punch_quay_kit.glb',
  'assets/models/tram.glb',
  // CC0 props from Poly Haven (tools/fetch-props.mjs)
  ...['barrel', 'crate', 'chest', 'lamp', 'bench', 'pot', 'planter', 'boombox', 'guitar'].map(
    (n) => `assets/models/prop_${n}.glb`,
  ),
];

/** Reduced CC0 nature models in assets/models/scatter (tools/fetch-scatter.mjs). */
export const SCATTER = [
  'tree_island',
  'tree_jacaranda',
  'tree_small',
  'boulder',
  'rocks',
  'cliff',
  'grass_tall',
  'grass_low',
  'log',
  'roots',
  'fir',
  'celandine',
  'periwinkle',
  'heliophila',
  'moss',
];

/**
 * Loads kit GLBs once and hands out clones of their `KIT_*` roots.
 * Clones share geometry and materials, so instancing a piece is cheap.
 */
export class AssetLibrary {
  private readonly pieces = new Map<string, THREE.Object3D>();

  static async load(
    files = KIT_FILES,
    onProgress?: (fraction: number) => void,
    cast: string[] = [],
    scatter: string[] = SCATTER,
  ): Promise<AssetLibrary> {
    const lib = new AssetLibrary();
    const loader = gltfLoader();
    const base = import.meta.env.BASE_URL;
    const total = files.length + 1 + cast.length + scatter.length;
    let done = 0;
    const step = (e?: ProgressEvent) =>
      onProgress?.(Math.min(1, (done + (e && e.total ? e.loaded / e.total : 0)) / total));
    for (const f of files) {
      const gltf = await loader.loadAsync(base + f, step);
      done++;
      gltf.scene.traverse((o) => {
        if (o.name.startsWith('KIT_') && !lib.pieces.has(o.name)) lib.pieces.set(o.name, o);
      });
    }
    try {
      const kit = await loader.loadAsync(base + 'assets/models/kit.glb', step);
      lib.kitModel = kit.scene;
      lib.kitClips = kit.animations;
    } catch (err) {
      console.warn('[assets] no kit.glb; Kit stays a placeholder', err);
    }
    for (const name of cast) {
      try {
        const gltf = await loader.loadAsync(`${base}assets/models/cast/${name}.glb`, step);
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.frustumCulled = false; // skinned bounds are unreliable across these rigs
          }
        });
        lib.cast.set(name, gltf.scene);
      } catch (err) {
        console.warn(`[assets] cast model ${name} missing; using a stand-in`, err);
      }
      done++;
    }
    for (const name of scatter) {
      try {
        const gltf = await loader.loadAsync(`${base}assets/models/scatter/${name}.glb`, step);
        lib.scatter.set(name, gltf.scene);
      } catch (err) {
        console.warn(`[assets] scatter model ${name} missing`, err);
      }
      done++;
    }
    if (cast.length) {
      try {
        const res = await fetch(`${base}assets/anim/cast.json`);
        if (res.ok) lib.castClips = (await res.json()) as CastClips;
      } catch (err) {
        console.warn('[assets] no mocap clips; characters use the procedural walk', err);
      }
    }
    done = total;
    step();
    for (const piece of lib.pieces.values()) {
      piece.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
    }
    return lib;
  }

  /** Kit Vale's character model (Hunyuan 3D export, optimized by `npm run assets`). */
  kitModel: THREE.Object3D | null = null;
  /** Rigged characters for residents and enemies, by file name (see ActorDef.model). */
  readonly cast = new Map<string, THREE.Object3D>();
  /** Nature models drawn many times over (trees, rocks, grass). See tools/fetch-scatter.mjs. */
  readonly scatter = new Map<string, THREE.Object3D>();
  /** Motion-capture loops for the cast (walk, run), baked by tools/fbx-anim.mjs. */
  castClips: CastClips | null = null;
  /** Animation clips exported with Kit (empty until the model is rigged). */
  kitClips: THREE.AnimationClip[] = [];

  has(name: string): boolean {
    return this.pieces.has(name);
  }

  get names(): string[] {
    return [...this.pieces.keys()];
  }

  /** A fresh instance at the origin (the source's review-layout transform is dropped). */
  instance(name: string): THREE.Object3D {
    const src = this.pieces.get(name);
    if (!src) {
      console.warn(`[assets] missing kit piece ${name}`);
      return new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xff00ff }),
      );
    }
    const copy = src.clone(true);
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.set(1, 1, 1);
    return copy;
  }
}
