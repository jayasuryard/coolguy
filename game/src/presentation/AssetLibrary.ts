import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Kit GLBs exported from the Blender kit project (see art/README.md). */
export const KIT_FILES = ['assets/models/punch_quay_kit.glb'];

/**
 * Loads kit GLBs once and hands out clones of their `KIT_*` roots.
 * Clones share geometry and materials, so instancing a piece is cheap.
 */
export class AssetLibrary {
  private readonly pieces = new Map<string, THREE.Object3D>();

  static async load(files = KIT_FILES): Promise<AssetLibrary> {
    const lib = new AssetLibrary();
    const loader = new GLTFLoader();
    const base = import.meta.env.BASE_URL;
    for (const f of files) {
      const gltf = await loader.loadAsync(base + f);
      gltf.scene.traverse((o) => {
        if (o.name.startsWith('KIT_') && !lib.pieces.has(o.name)) lib.pieces.set(o.name, o);
      });
    }
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
