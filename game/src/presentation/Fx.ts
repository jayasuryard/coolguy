import * as THREE from 'three';

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number; // seconds left; ≤ 0 = free
  span: number;
  delay: number;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  travel: number;
  grow: [number, number];
  flat: boolean;
}

const HIT = new THREE.Color(0x9fe8ff);
const GOLD = new THREE.Color(0xffd27a);
const MISS = new THREE.Color(0x9aa0a8);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Sound made visible: rings that leave Kit's guitar when a phrase is released. An on-beat
 * release throws a train of rings at its target (a receiver, an enemy) or rolls them out across
 * the ground; an off-beat one coughs up a single grey ring.
 */
export class Fx {
  private readonly rings: Ring[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.RingGeometry(0.86, 1, 56);
    for (let i = 0; i < 28; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: HIT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.rings.push({
        mesh,
        material,
        life: 0,
        span: 1,
        delay: 0,
        from: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        travel: 0,
        grow: [1, 1],
        flat: false,
      });
    }
  }

  private spawn(init: Partial<Ring> & { color: THREE.Color; span: number }): void {
    const ring = this.rings.find((r) => r.life <= 0);
    if (!ring) return;
    Object.assign(ring, { delay: 0, travel: 0, grow: [1, 1], flat: false }, init);
    ring.life = init.span + (init.delay ?? 0);
    ring.material.color.copy(init.color);
  }

  /** A released phrase. `to` = what it was aimed at, if anything. */
  phrase(from: THREE.Vector3, to: THREE.Vector3 | null, hit: boolean): void {
    if (!hit) {
      this.spawn({
        color: MISS,
        span: 0.45,
        from: from.clone(),
        dir: UP.clone(),
        grow: [0.3, 1.3],
        flat: true,
      });
      return;
    }
    if (to) {
      const dir = to.clone().sub(from);
      const travel = dir.length();
      dir.normalize();
      for (let i = 0; i < 5; i++) {
        this.spawn({
          color: i % 2 ? GOLD : HIT,
          span: 0.2 + travel / 16,
          delay: i * 0.075,
          from: from.clone(),
          dir: dir.clone(),
          travel,
          grow: [0.35, 1.5 + i * 0.12],
        });
      }
      this.burst(to, GOLD);
    } else {
      const ground = from.clone();
      ground.y -= 1.05;
      for (let i = 0; i < 4; i++) {
        this.spawn({
          color: i % 2 ? GOLD : HIT,
          span: 1.1,
          delay: i * 0.12,
          from: ground.clone(),
          dir: UP.clone(),
          grow: [0.6, 8.5],
          flat: true,
        });
      }
    }
  }

  /** A flash where something was struck or picked up. */
  burst(at: THREE.Vector3, color: THREE.Color = GOLD): void {
    for (let i = 0; i < 2; i++) {
      this.spawn({
        color,
        span: 0.5,
        delay: 0.18 + i * 0.1,
        from: at.clone(),
        dir: UP.clone(),
        grow: [0.3, 2.6 + i],
        flat: false,
        travel: -1, // billboard
      });
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const t = 1 - r.life / r.span; // < 0 while delayed
      if (t < 0) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.visible = true;
      const ease = 1 - (1 - t) * (1 - t);
      r.mesh.position.copy(r.from);
      if (r.travel > 0) r.mesh.position.addScaledVector(r.dir, r.travel * t);
      r.mesh.scale.setScalar(r.grow[0] + (r.grow[1] - r.grow[0]) * ease);
      if (r.flat) r.mesh.rotation.set(-Math.PI / 2, 0, 0);
      else if (r.travel > 0) r.mesh.lookAt(this.tmp.copy(r.mesh.position).add(r.dir));
      else r.mesh.quaternion.copy(camera.quaternion);
      r.material.opacity = Math.sin(Math.min(1, t * 6) * Math.PI * 0.5) * (1 - t) * 0.42;
    }
  }
}
