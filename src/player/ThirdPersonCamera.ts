import * as THREE from 'three';
import type { Input } from '../core/Input';

const SENSITIVITY = 0.0025;
const LOOK_HEIGHT = 1.2;

/** Orbit camera: mouse controls yaw/pitch, wheel zooms, never dips under the terrain. */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.35;
  distance = 9;
  private readonly target = new THREE.Vector3();
  private initialised = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  update(dt: number, input: Input, focus: THREE.Vector3): void {
    this.yaw -= input.mouseDX * SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.mouseDY * SENSITIVITY, -0.3, 1.4);
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + input.wheel * 0.001), 2.5, 60);

    if (!this.initialised) {
      this.target.copy(focus);
      this.initialised = true;
    } else {
      this.target.lerp(focus, 1 - Math.exp(-dt * 14));
    }

    const cp = Math.cos(this.pitch);
    const cam = this.camera.position;
    cam.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + LOOK_HEIGHT + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    const minY = this.groundAt(cam.x, cam.z) + 0.6;
    if (cam.y < minY) cam.y = minY;

    this.camera.lookAt(this.target.x, this.target.y + LOOK_HEIGHT, this.target.z);
  }
}
