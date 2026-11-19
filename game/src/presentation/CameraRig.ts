import * as THREE from 'three';
import { CONFIG } from '../config';
import type { V3 } from '../sim/Kit';

export type RayProbe = (origin: V3, dir: V3, max: number) => number;

/** Third-person orbit on a 3 m spring arm that shortens against walls; recenter on demand. */
export class CameraRig {
  yaw = 0;
  pitch = 0.25;
  /** Player look sensitivity multiplier and Y inversion (Settings → Controls). */
  lookScale = 1;
  invertY = false;
  private arm = CONFIG.camera.armLength;
  private readonly pivot = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private recentering: number | null = null;
  private initialised = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly probe: RayProbe,
  ) {}

  /** Yaw that places the camera behind a character facing `facing`. */
  recenterBehind(facing: number): void {
    this.recentering = facing + Math.PI;
  }

  update(
    dt: number,
    focus: THREE.Vector3,
    look: { dx: number; dy: number; padX: number; padY: number },
  ): void {
    const c = CONFIG.camera;
    const k = this.lookScale;
    const iy = this.invertY ? -1 : 1;
    this.yaw -= (look.dx * c.sensitivity + look.padX * c.padSensitivity * dt) * k;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + (look.dy * c.sensitivity + look.padY * c.padSensitivity * dt) * k * iy,
      -0.5,
      1.2,
    );
    if (look.dx || look.padX) this.recentering = null;
    if (this.recentering !== null) {
      const d = Math.atan2(
        Math.sin(this.recentering - this.yaw),
        Math.cos(this.recentering - this.yaw),
      );
      this.yaw += d * (1 - Math.exp(-dt * 10));
      if (Math.abs(d) < 0.01) this.recentering = null;
    }

    const target = this.pivot.set(focus.x, focus.y + c.lookHeight - 0.9, focus.z);
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // Spring arm: shorten instantly when blocked, ease back out when clear.
    const free = Math.max(0.4, this.probe(target, this.dir, c.armLength) - 0.25);
    this.arm =
      free < this.arm || !this.initialised
        ? free
        : this.arm + (free - this.arm) * (1 - Math.exp(-dt * 6));
    this.initialised = true;

    this.camera.position.copy(target).addScaledVector(this.dir, this.arm);
    this.camera.lookAt(target);
  }
}
