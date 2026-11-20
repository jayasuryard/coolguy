import * as THREE from 'three';
import { gltfLoader } from './loader';

/** Kit GLBs exported from the Blender kit project (see art/README.md). */
export const KIT_FILES = ['assets/models/punch_quay_kit.glb', 'assets/models/tram.glb'];

/**
 * Loads kit GLBs once and hands out clones of their `KIT_*` roots.
 * Clones share geometry and materials, so instancing a piece is cheap.
 */
export class AssetLibrary {
  private readonly pieces = new Map<string, THREE.Object3D>();

  static async load(
    files = KIT_FILES,
    onProgress?: (fraction: number) => void,
  ): Promise<AssetLibrary> {
    const lib = new AssetLibrary();
    const loader = gltfLoader();
    const base = import.meta.env.BASE_URL;
    const total = files.length + 1;
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
