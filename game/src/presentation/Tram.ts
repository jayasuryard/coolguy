import * as THREE from 'three';
import { registerLamp } from './ambience';

/** The quay loop, read off the rails in the city model: two straights joined by half-circles. */
const X0 = 115;
const X1 = 225;
const ZC = 302;
const R = 12.1;
const STRAIGHT = X1 - X0;
const ARC = Math.PI * R;
export const LOOP = 2 * STRAIGHT + 2 * ARC;
/** Where the tram waits: alongside the station platform. */
const STOP = 150 - X0;

const MAX_SPEED = 6.2; // m/s on the straights
const CURVE_SPEED = 3.1;
const ACCEL = 0.75;
const BRAKE = 1.15;
const DWELL = 16; // seconds at the platform
const BOGIE = 3.1; // metres from the middle to each bogie

/** Point on the loop's centreline at distance s (metres, wraps). */
function at(s: number, out: THREE.Vector3): THREE.Vector3 {
  s = ((s % LOOP) + LOOP) % LOOP;
  if (s < STRAIGHT) return out.set(X0 + s, 0, ZC - R); // platform side, heading east
  s -= STRAIGHT;
  if (s < ARC) {
    const a = -Math.PI / 2 + s / R;
    return out.set(X1 + Math.cos(a) * R, 0, ZC + Math.sin(a) * R);
  }
  s -= ARC;
  if (s < STRAIGHT) return out.set(X1 - s, 0, ZC + R); // sea side, heading west
  s -= STRAIGHT;
  const a = Math.PI / 2 + s / R;
  return out.set(X0 + Math.cos(a) * R, 0, ZC + Math.sin(a) * R);
}
const onCurve = (s: number): boolean => {
  s = ((s % LOOP) + LOOP) % LOOP;
  return (s > STRAIGHT && s < STRAIGHT + ARC) || s > 2 * STRAIGHT + ARC;
};

/**
 * The quay tram. It circles the loop, slowing for the curves, and pulls up at the platform for
 * a while before ringing off again. It rides on two bogies, so the body swings through the
 * curves the way a real car does; it leans a touch, noses down under braking, and will not run
 * Kit over — if he stands on the line it stops short and rings its bell.
 */
export class Tram {
  readonly root = new THREE.Group();
  /** Centre and heading for the physics box. */
  readonly position = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  private s = STOP;
  private state: 'run' | 'dwell' = 'dwell';
  private wait = 6;
  private departing = false;
  private blockedFor = 0;
  private time = 0;
  private pitch = 0;
  private roll = 0;
  private readonly body = new THREE.Group();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();

  constructor(
    model: THREE.Object3D,
    private readonly bell: () => void,
  ) {
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.body.add(model);
    // headlamps at both ends; they come on with the street lamps
    const lamp = new THREE.MeshStandardMaterial({
      color: 0xfff0c8,
      emissive: 0xffc070,
      emissiveIntensity: 3,
    });
    registerLamp(lamp);
    for (const x of [-4.52, 4.52]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), lamp);
      bulb.position.set(x, 1.05, 0);
      this.body.add(bulb);
    }
    this.root.add(this.body);
    this.root.name = 'tram';
    this.place(0);
  }

  /**
   * @param kit  Kit's position (the tram keeps clear of him)
   * @param hold keep the tram at the platform (the story needs it there)
   */
  update(dt: number, kit: { x: number; y: number; z: number }, hold: boolean): void {
    this.time += dt;
    const toStop = (((STOP - this.s) % LOOP) + LOOP) % LOOP;

    if (hold && (this.state !== 'dwell' || toStop > 0.5)) {
      // called up by the story: it is simply there when the scene opens
      this.s = STOP;
      this.speed = 0;
      this.state = 'dwell';
    }
    if (this.state === 'dwell') {
      this.speed = 0;
      this.wait = hold ? Math.max(this.wait, 4) : this.wait - dt;
      if (this.wait <= 0) {
        this.state = 'run';
        this.departing = true;
        this.bell();
      }
    } else {
      // someone on the line ahead?
      let blocked = false;
      if (kit.y < 3.2) {
        for (let d = 4.5; d < 17; d += 1.5) {
          at(this.s + d, this.probe);
          if (Math.hypot(this.probe.x - kit.x, this.probe.z - kit.z) < 2.4) blocked = true;
        }
      }
      if (blocked) {
        if (this.blockedFor === 0 || this.blockedFor > 4) {
          this.bell();
          this.blockedFor = 0.001;
        }
        this.blockedFor += dt;
      } else this.blockedFor = 0;

      if (this.departing && toStop > 2 && toStop < LOOP - 2) this.departing = false;
      const ahead = this.departing ? LOOP : toStop;
      // fastest speed from which it can still stop at the platform, and slow into curves
      let target = Math.min(MAX_SPEED, Math.sqrt(2 * BRAKE * 0.8 * Math.max(0, ahead - 0.03)));
      if (onCurve(this.s) || onCurve(this.s + 9)) target = Math.min(target, CURVE_SPEED);
      if (blocked) target = 0;
      const rate = target > this.speed ? ACCEL : BRAKE * (blocked ? 2.2 : 1);
      const before = this.speed;
      this.speed += THREE.MathUtils.clamp(target - this.speed, -rate * dt, rate * dt);
      this.s = (this.s + this.speed * dt) % LOOP;
      // nose dips under braking, lifts pulling away
      const accel = (this.speed - before) / Math.max(dt, 1e-4);
      this.pitch += (-accel * 0.006 - this.pitch) * (1 - Math.exp(-dt * 3));
      if (!this.departing && !blocked && ahead < 0.06 && this.speed < 0.08) {
        this.s = STOP;
        this.state = 'dwell';
        this.wait = DWELL;
      }
    }
    this.place(dt);
  }

  private place(dt: number): void {
    at(this.s + BOGIE, this.a);
    at(this.s - BOGIE, this.b);
    this.position.set((this.a.x + this.b.x) / 2, 1.6, (this.a.z + this.b.z) / 2);
    const yaw = Math.atan2(-(this.a.z - this.b.z), this.a.x - this.b.x);
    // lean out of the curve in proportion to how hard it is turning
    let turn = yaw - this.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const lean = dt > 0 ? THREE.MathUtils.clamp((turn / dt) * 0.09, -0.035, 0.035) : 0;
    this.roll += (lean - this.roll) * (1 - Math.exp(-dt * 2.5));
    this.yaw = yaw;
    this.root.position.set(this.position.x, 0.02, this.position.z);
    this.root.rotation.y = yaw;
    // rail joints and a slow body sway, both scaled by speed
    const v = this.speed / MAX_SPEED;
    this.body.position.y = Math.abs(Math.sin(this.s * 1.9)) * 0.012 * v;
    this.body.rotation.x = this.roll + Math.sin(this.time * 2.3) * 0.006 * v;
    this.body.rotation.z = this.pitch;
  }
}
