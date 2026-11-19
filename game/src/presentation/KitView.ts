import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Kit } from '../sim/Kit';
import type { AssetLibrary } from './AssetLibrary';
import { KitAnimator } from './KitAnimator';

const BACK_Z = -CONFIG.kit.radius - 0.07;
const KIT_HEIGHT = 1.8;
/** Distance from the capsule centre (the physics position) down to the feet. */
const FEET = CONFIG.kit.halfHeight + CONFIG.kit.radius;
/** Turns the model so it faces the movement direction (+Z local). */
const MODEL_YAW = 0;
const PLAY_Z = 0.34;
/** Guitar height (relative to the capsule centre) on the back vs. held at the belly while playing. */
const BACK_Y = -0.05;
const PLAY_Y = 0.16;

/**
 * Kit: the Hunyuan 3D model (or a placeholder capsule) carrying the modeled cobalt guitar.
 * Rigged exports animate through KitAnimator; static ones get a procedural bob.
 */
export class KitView {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  private readonly guitar: THREE.Group;
  private model: THREE.Object3D | null = null;
  private stride = 0;
  private modelFloor = 0;
  /** Set when the model ships with a skeleton and clips; otherwise the procedural bob runs. */
  private animator: KitAnimator | null = null;

  constructor(scene: THREE.Scene, assets: AssetLibrary | null) {
    const k = CONFIG.kit;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(k.radius, k.halfHeight * 2, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0xc18a39, roughness: 0.8 }), // Kit jacket swatch
    );
    body.castShadow = true;
    if (assets?.kitModel) {
      // Hunyuan export: feet at y=0, ~1.15 m tall. Scale to Kit's height; capsule centre is the root.
      const model = assets.kitModel;
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y;
      const s = KIT_HEIGHT / height;
      model.scale.setScalar(s);
      model.position.set(
        -((box.min.x + box.max.x) / 2) * s,
        -FEET - box.min.y * s,
        -((box.min.z + box.max.z) / 2) * s,
      );
      model.rotation.y = MODEL_YAW;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
      });
      body.visible = false;
      this.modelFloor = box.min.y * s;
      this.model = model;
      this.root.add(model);
      if (assets.kitClips.length) {
        this.animator = new KitAnimator(model, assets.kitClips);
        console.info('[kit] animation states:', this.animator.states.join(', ') || 'none matched');
      }
    }
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
    if (this.animator) {
      this.animator.update(dt, kit.speed, strumming);
    } else if (this.model) {
      // Procedural walk until the rig arrives: a small bob and lean with speed.
      const speed = Math.min(kit.speed, 6);
      this.stride += dt * (4 + speed * 2.2);
      this.model.position.y =
        -FEET - this.modelFloor + Math.abs(Math.sin(this.stride)) * 0.035 * speed;
      this.model.rotation.x = Math.min(0.12, speed * 0.02);
    }
    // Playing: guitar swings to the right hip, face forward (left hand on the frets).
    const k = 1 - Math.exp(-dt * 14);
    this.guitar.position.z += ((strumming ? PLAY_Z : BACK_Z) - this.guitar.position.z) * k;
    this.guitar.position.x += ((strumming ? -0.06 : 0) - this.guitar.position.x) * k;
    this.guitar.position.y += ((strumming ? PLAY_Y : BACK_Y) - this.guitar.position.y) * k;
    this.guitar.rotation.y += ((strumming ? Math.PI : 0) - this.guitar.rotation.y) * k;
    this.guitar.rotation.z += ((strumming ? 1.0 : 0.6) - this.guitar.rotation.z) * k;
  }
}
