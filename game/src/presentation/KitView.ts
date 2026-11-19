import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Kit } from '../sim/Kit';
import type { AssetLibrary } from './AssetLibrary';

const BACK_Z = -CONFIG.kit.radius - 0.07;
const PLAY_Z = 0.42;

/** Kit: placeholder body (until the Hunyuan3D model lands) carrying the modeled cobalt guitar. */
export class KitView {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  private readonly guitar: THREE.Group;

  constructor(scene: THREE.Scene, assets: AssetLibrary | null) {
    const k = CONFIG.kit;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(k.radius, k.halfHeight * 2, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0xc18a39, roughness: 0.8 }), // Kit jacket swatch
    );
    body.castShadow = true;
    this.guitar = new THREE.Group();
    if (assets?.has('KIT_guitar')) {
      const g = assets.instance('KIT_guitar');
      g.rotation.y = Math.PI; // face away from Kit's back so the camera sees it
      this.guitar.add(g);
    } else {
      const fallback = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.5, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x315ca9 }),
      );
      this.guitar.add(fallback);
    }
    this.guitar.position.set(0, -0.05, BACK_Z);
    this.guitar.rotation.z = 0.6; // diagonal across the back (Art Direction)
    this.guitar.traverse((o) => (o.castShadow = true));
    this.root.add(body, this.guitar);
    scene.add(this.root);
  }

  update(kit: Kit, alpha: number, dt: number, strumming: boolean): void {
    this.position.set(
      kit.prev.x + (kit.curr.x - kit.prev.x) * alpha,
      kit.prev.y + (kit.curr.y - kit.prev.y) * alpha,
      kit.prev.z + (kit.curr.z - kit.prev.z) * alpha,
    );
    this.root.position.copy(this.position);
    const diff = Math.atan2(
      Math.sin(kit.facing - this.root.rotation.y),
      Math.cos(kit.facing - this.root.rotation.y),
    );
    this.root.rotation.y += diff * (1 - Math.exp(-dt * 12));
    // Playing: guitar swings to the right hip, face forward (left hand on the frets).
    const k = 1 - Math.exp(-dt * 14);
    this.guitar.position.z += ((strumming ? PLAY_Z : BACK_Z) - this.guitar.position.z) * k;
    this.guitar.position.x += ((strumming ? -0.12 : 0) - this.guitar.position.x) * k;
    this.guitar.rotation.y += ((strumming ? Math.PI : 0) - this.guitar.rotation.y) * k;
    this.guitar.rotation.z += ((strumming ? 1.2 : 0.6) - this.guitar.rotation.z) * k;
  }
}
