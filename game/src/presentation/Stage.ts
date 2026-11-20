import * as THREE from 'three';
import type { ActorState, Director } from '../story/Director';

interface Figure {
  root: THREE.Group;
  body: THREE.Object3D;
  eye: THREE.MeshStandardMaterial | null;
  maxHp: number;
  phase: number;
}

/**
 * Draws what the Director stages: residents, enemies, the objective beacon and pickups.
 * Figures are simple stylised shapes in the city's flat-colour language.
 */
export class Stage {
  private readonly figures = new Map<string, Figure>();
  private readonly beacon: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly pickup: THREE.Group;
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    const glow = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 40, 12, 1, true), glow);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.pickup = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({
      color: 0xd9a441,
      emissive: 0xd9a441,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.4,
    });
    for (const x of [-0.09, 0.09]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 8, 20), brass);
      lens.position.x = x;
      this.pickup.add(lens);
    }
    for (const o of [this.beacon, this.ring, this.pickup]) {
      o.visible = false;
      scene.add(o);
    }
  }

  sync(d: Director, dt: number, beat: number, kit: THREE.Vector3): void {
    this.time += dt;
    for (const [id, f] of this.figures) {
      if (!d.actors.has(id)) {
        this.scene.remove(f.root);
        this.figures.delete(id);
      }
    }
    for (const [id, a] of d.actors) {
      let f = this.figures.get(id);
      if (!f) {
        f = a.def.kind === 'enemy' ? enemyFigure(a) : npcFigure(a);
        this.figures.set(id, f);
        this.scene.add(f.root);
        f.root.position.set(a.x, a.y, a.z);
      }
      // ease towards the logic position so 60 Hz steps don't judder
      const k = 1 - Math.exp(-dt * 14);
      f.root.position.x += (a.x - f.root.position.x) * k;
      f.root.position.y += (a.y - f.root.position.y) * k;
      f.root.position.z += (a.z - f.root.position.z) * k;
      let turn = a.facing - f.root.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      f.root.rotation.y += turn * (1 - Math.exp(-dt * 8));
      const t = this.time * (a.moving ? 9 : 2) + f.phase;
      f.body.position.y = Math.abs(Math.sin(t)) * (a.moving ? 0.07 : 0.015);
      f.body.rotation.z = a.stagger > 0 ? Math.sin(this.time * 30) * 0.12 : 0;
      if (f.eye) {
        const pulse = Math.max(0, 1 - (beat - Math.floor(beat)) * 2);
        f.eye.emissiveIntensity = a.stagger > 0 ? 0.15 : 0.8 + pulse * 2.2;
      }
    }

    const step = d.step;
    const t = step?.trigger;
    const target = d.target;
    const far = target ? Math.hypot(target.x - kit.x, target.z - kit.z) > 4 : false;
    this.beacon.visible = !!target && far && t?.type !== 'defeat';
    if (target) this.beacon.position.set(target.x, target.y + 20, target.z);

    const radius =
      t?.type === 'perform' || t?.type === 'escort' || t?.type === 'reach' ? t.radius : 0;
    this.ring.visible = radius > 0 && !!target;
    if (target && radius) {
      this.ring.position.set(target.x, target.y + 0.06, target.z);
      this.ring.scale.setScalar(radius);
    }

    this.pickup.visible = t?.type === 'collect';
    if (t?.type === 'collect') {
      this.pickup.position.set(
        t.position[0],
        t.position[1] + 0.7 + Math.sin(this.time * 2) * 0.08,
        t.position[2],
      );
      this.pickup.rotation.y = this.time * 1.6;
    }
  }
}

function flat(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
}

function shadowed(root: THREE.Object3D): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
}

/** A resident: coat, head, hat — about 1.7 m tall. */
function npcFigure(a: ActorState): Figure {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const coat = flat(a.def.color);
  const skin = flat(0xe0b08a);
  const dark = flat(0x2a2a30);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.8, 10), dark);
  legs.position.y = 0.4;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 4, 12), coat);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin);
  head.position.y = 1.62;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 14), coat);
  hat.position.y = 1.78;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), skin);
  nose.position.set(0, 1.6, 0.17);
  body.add(legs, torso, head, hat, nose);
  root.add(body, label(a.def.name, 2.15));
  root.scale.setScalar(a.def.scale ?? 1);
  shadowed(body);
  return { root, body, eye: null, maxHp: 1, phase: Math.random() * 6 };
}

/** A municipal counting machine: riveted drum body, dial face, one beat-synced eye. */
function enemyFigure(a: ActorState): Figure {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const shell = flat(a.def.color, { metalness: 0.35, roughness: 0.55 });
  const dark = flat(0x23262c, { metalness: 0.4, roughness: 0.6 });
  const eye = new THREE.MeshStandardMaterial({
    color: 0xfff1c9,
    emissive: 0xff5a36,
    emissiveIntensity: 1.5,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.35, 16), dark);
  base.position.y = 0.18;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 1.1, 16), shell);
  drum.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.6), shell);
  head.position.y = 1.72;
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 20), eye);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0, 1.72, 0.31);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.3, 6), dark);
  crown.position.y = 2.1;
  body.add(base, drum, head, dial, crown);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.85, 0.14), dark);
    arm.position.set(side * 0.62, 1.0, 0.05);
    arm.rotation.z = side * 0.18;
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.3), shell);
    clamp.position.set(side * 0.7, 0.55, 0.1);
    body.add(arm, clamp);
  }
  root.add(body, label(a.def.name, 2.6));
  root.scale.setScalar(a.def.scale ?? 1);
  shadowed(body);
  return { root, body, eye, maxHp: a.def.hp ?? 1, phase: 0 };
}

/** Floating name tag (canvas sprite). */
function label(text: string, y: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'italic 700 46px Saira, "Nunito Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(10,12,16,0.85)';
  ctx.strokeText(text, 256, 50);
  ctx.fillStyle = '#fff4dc';
  ctx.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(2.4, 0.45, 1);
  sprite.position.y = y;
  return sprite;
}
