import * as THREE from 'three';

/**
 * Procedural idle / walk / stagger for any character on the Mixamo skeleton.
 * The rigs arrive in a T-pose with no clips, so poses are written as rotations about the
 * character's own axes (x = its left, y = up, z = forward) and converted to each bone's local
 * space from its rest orientation. One animator drives every skin that shares the bone names.
 */
type Axis = 'x' | 'y' | 'z';
interface Joint {
  bones: THREE.Bone[];
  rest: THREE.Quaternion[];
  /** Rest orientation in character space, per bone. */
  world: THREE.Quaternion[];
}

const AXES: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const ARM_DOWN = 1.22;

/** One baked motion-capture loop (see tools/fbx-anim.mjs). */
export interface CastClip {
  duration: number;
  frames: number;
  /** Distance covered per loop, in hip heights. */
  stride: number;
  /** Vertical hip bob per frame, as a fraction of hip height. */
  hipsY: number[];
  /** Bone name → flat xyzw rotations, one per frame. */
  tracks: Record<string, number[]>;
}
export interface CastClips {
  fps: number;
  clips: Record<string, CastClip>;
}

/** Canonical bone name: converters may suffix duplicates (`Hips_65`). */
export const canonicalBone = (name: string): string =>
  name.replace(/^mixamorig\d*:?/, '').replace(/_\d+$/, '');

export class CastAnimator {
  private readonly joints = new Map<string, Joint>();
  private phase = Math.random() * 6;
  private time = Math.random() * 10;
  private walk = 0; // 0 idle … 1 walking (smoothed)
  private hurt = 0;
  private readonly d = new THREE.Quaternion();
  private readonly q = new THREE.Quaternion();
  private readonly inv = new THREE.Quaternion();

  private clipTime = 0;
  private hipsRestY = 0;
  /** Hip height in metres once the model is fitted (set by `fit`). */
  private hipHeight = 1;
  private readonly a = new THREE.Quaternion();
  private readonly b = new THREE.Quaternion();

  /**
   * `model` must be un-parented and at identity so rest orientations are in character space.
   * With a `clip`, moving plays that mocap loop; standing and reeling stay procedural.
   */
  constructor(
    model: THREE.Object3D,
    private readonly clip: CastClip | null = null,
  ) {
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const name = canonicalBone(o.name);
      let j = this.joints.get(name);
      if (!j) this.joints.set(name, (j = { bones: [], rest: [], world: [] }));
      j.bones.push(o as THREE.Bone);
      j.rest.push(o.quaternion.clone());
      j.world.push(o.getWorldQuaternion(new THREE.Quaternion()));
    });
    const hips = this.joints.get('Hips')?.bones[0];
    if (hips) {
      this.hipsRestY = hips.position.y;
      this.hipHeight = hips.getWorldPosition(new THREE.Vector3()).y;
    }
  }

  /** Tell the animator the scale the model was fitted with (for stride matching). */
  fit(scale: number, feetY: number): void {
    this.hipHeight = Math.max(0.3, (this.hipHeight - feetY) * scale);
  }

  get rigged(): boolean {
    return this.joints.has('Hips');
  }

  /** Highest and lowest bone in character space (metres), for fitting height and feet. */
  static extent(model: THREE.Object3D): { min: number; max: number } {
    model.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    let min = Infinity;
    let max = -Infinity;
    model.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const y = o.getWorldPosition(p).y;
      min = Math.min(min, y);
      max = Math.max(max, y);
    });
    return { min, max };
  }

  /** speed in m/s (0 = standing); staggered = reeling from a hit. */
  update(dt: number, speed: number, staggered: boolean): void {
    this.time += dt;
    this.phase += dt * (2.6 + speed * 2.3);
    const k = 1 - Math.exp(-dt * 8);
    this.walk += ((speed > 0.1 ? 1 : 0) - this.walk) * k;
    this.hurt += ((staggered ? 1 : 0) - this.hurt) * k;
    const w = this.walk;
    const h = this.hurt;
    const s = Math.sin(this.phase) * w;
    const c = Math.cos(this.phase);
    const breathe = Math.sin(this.time * 1.7) * 0.02;
    const reel = Math.sin(this.time * 22) * 0.05 * h;

    this.pose('Spine', ['x', 0.03 * w + breathe - 0.32 * h], ['y', 0.07 * s], ['z', reel]);
    this.pose('Spine1', ['x', breathe - 0.12 * h]);
    this.pose('Neck', ['x', -0.02 * w + 0.2 * h]);
    this.pose('Head', ['y', -0.05 * s], ['z', -reel]);

    this.pose('LeftUpLeg', ['x', -0.52 * s]);
    this.pose('RightUpLeg', ['x', 0.52 * s]);
    this.pose('LeftLeg', ['x', 0.85 * Math.max(0, c) * w]);
    this.pose('RightLeg', ['x', 0.85 * Math.max(0, -c) * w]);
    this.pose('LeftFoot', ['x', -0.18 * Math.max(0, c) * w]);
    this.pose('RightFoot', ['x', -0.18 * Math.max(0, -c) * w]);

    const lift = 0.9 * h; // arms fly up when hit
    this.pose('LeftArm', ['z', -(ARM_DOWN - lift) - breathe], ['x', 0.42 * s]);
    this.pose('RightArm', ['z', ARM_DOWN - lift + breathe], ['x', -0.42 * s]);
    this.pose('LeftForeArm', ['y', -0.22 - 0.3 * Math.max(0, -s) - 0.5 * h]);
    this.pose('RightForeArm', ['y', 0.22 + 0.3 * Math.max(0, s) + 0.5 * h]);

    if (this.clip) this.blendClip(dt, speed, w * (1 - h));
  }

  /** Blend the mocap loop over the procedural pose, advancing it in step with ground speed. */
  private blendClip(dt: number, speed: number, weight: number): void {
    const clip = this.clip!;
    const groundSpeed = (clip.stride * this.hipHeight) / clip.duration; // m/s at 1× playback
    const rate = speed > 0.1 ? THREE.MathUtils.clamp(speed / groundSpeed, 0.5, 1.8) : 1;
    this.clipTime = (this.clipTime + dt * rate) % clip.duration;
    if (weight < 0.01) return;
    const f = (this.clipTime / clip.duration) * clip.frames;
    const i0 = Math.floor(f) % clip.frames;
    const i1 = (i0 + 1) % clip.frames;
    const t = f - Math.floor(f);
    for (const name in clip.tracks) {
      const j = this.joints.get(name);
      if (!j) continue;
      const v = clip.tracks[name]!;
      this.a.fromArray(v, i0 * 4);
      this.b.fromArray(v, i1 * 4);
      this.a.slerp(this.b, t);
      for (const bone of j.bones) bone.quaternion.slerp(this.a, weight);
    }
    const bob = clip.hipsY[i0]! + (clip.hipsY[i1]! - clip.hipsY[i0]!) * t;
    for (const hips of this.joints.get('Hips')?.bones ?? []) {
      hips.position.y = this.hipsRestY * (1 + bob * weight);
    }
  }

  /** Apply rotations (about character axes, first listed = applied first) on top of the rest pose. */
  private pose(name: string, ...turns: Array<[Axis, number]>): void {
    const j = this.joints.get(name);
    if (!j) return;
    this.d.identity();
    for (const [axis, angle] of turns) {
      this.d.premultiply(this.q.setFromAxisAngle(AXES[axis], angle));
    }
    for (let i = 0; i < j.bones.length; i++) {
      const W = j.world[i]!;
      // local = rest · W⁻¹ · D · W
      this.q.copy(j.rest[i]!).multiply(this.inv.copy(W).invert()).multiply(this.d).multiply(W);
      j.bones[i]!.quaternion.copy(this.q);
    }
  }
}
