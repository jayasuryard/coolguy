import type { WorldDef } from '@content/types';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerLamp } from './ambience';
import { applySurface } from './Surfaces';

type Part = 'paint' | 'brass' | 'steel' | 'stone' | 'wood' | 'glass' | 'lamp';

/** Collects tinted geometry per material and merges each into one mesh. */
class Kit {
  private readonly parts = new Map<Part, THREE.BufferGeometry[]>();
  constructor(private readonly origin: THREE.Matrix4) {}

  add(
    part: Part,
    g: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    rot: [number, number, number] = [0, 0, 0],
  ): this {
    const out = g.index ? g.toNonIndexed() : g;
    out.applyMatrix4(
      this.origin
        .clone()
        .multiply(
          new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)).setPosition(x, y, z),
        ),
    );
    const n = out.getAttribute('position').count;
    const c = new THREE.Color(color);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    out.deleteAttribute('uv');
    const list = this.parts.get(part) ?? [];
    list.push(out);
    this.parts.set(part, list);
    return this;
  }
  box(
    part: Part,
    color: number,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rot?: [number, number, number],
  ): this {
    return this.add(part, new THREE.BoxGeometry(w, h, d), color, x, y, z, rot);
  }
  /** Cylinder along X (axis 'x'), Y or Z. */
  rod(
    part: Part,
    color: number,
    r: number,
    len: number,
    axis: 'x' | 'y' | 'z',
    x: number,
    y: number,
    z: number,
    r2 = r,
  ): this {
    const rot: [number, number, number] =
      axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.add(part, new THREE.CylinderGeometry(r2, r, len, 20), color, x, y, z, rot);
  }
  build(into: THREE.Group): void {
    for (const [part, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, MATERIALS[part]);
      mesh.castShadow = part !== 'glass' && part !== 'lamp';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      into.add(mesh);
    }
  }
}

const surfaced = (name: string, params: THREE.MeshStandardMaterialParameters) => {
  const m = new THREE.MeshStandardMaterial({ name, vertexColors: true, ...params });
  applySurface(m);
  return m;
};
const MATERIALS: Record<Part, THREE.Material> = {
  paint: surfaced('M_painted', { roughness: 0.55, metalness: 0.15 }),
  stone: surfaced('M_stone', { roughness: 0.85 }),
  wood: surfaced('M_wood', { roughness: 0.8 }),
  brass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x9fc3c0,
    roughness: 0.06,
    metalness: 0.7,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  }),
  lamp: new THREE.MeshStandardMaterial({
    color: 0xffe2a6,
    emissive: 0xffa544,
    emissiveIntensity: 5,
  }),
};

const TEAL = 0x3f7f78;
const BRASS = 0xd9a441;
const IRON = 0x34383d;
const STEEL = 0xb9bcc0;
const AUBERGINE = 0x4b2c52;

/** The Roll Press: a glazed aubergine print shop with the press working inside. */
function rollPressShop(kit: Kit): void {
  const W = 8;
  const H = 5.4;
  const D = 6;
  kit.box('stone', 0xb9aa94, W + 0.5, 0.3, D + 0.5, 0, 0.15, 0);
  // solid back and left wall, cornice, roof
  kit.box('paint', AUBERGINE, W, H, 0.25, 0, H / 2 + 0.3, -D / 2 + 0.12);
  kit.box('paint', AUBERGINE, 0.25, H, D, -W / 2 + 0.12, H / 2 + 0.3, 0);
  kit.box('paint', 0x3c2242, W + 0.5, 0.45, D + 0.5, 0, H + 0.5, 0);
  kit.box('paint', 0x5a3562, W + 0.25, 0.14, D + 0.25, 0, H + 0.22, 0);
  // glazed front (+z) and right side: posts, a low panelled base, mullions, panes
  for (const x of [-W / 2 + 0.15, W / 2 - 0.15])
    kit.box('paint', AUBERGINE, 0.3, H, 0.3, x, H / 2 + 0.3, D / 2 - 0.15);
  kit.box('paint', AUBERGINE, 0.3, H, 0.3, W / 2 - 0.15, H / 2 + 0.3, -D / 2 + 0.15);
  kit.box('paint', AUBERGINE, W, 0.9, 0.22, 0, 0.75, D / 2 - 0.12);
  kit.box('paint', AUBERGINE, 0.22, 0.9, D, W / 2 - 0.12, 0.75, 0);
  kit.box('paint', AUBERGINE, W, 0.8, 0.22, 0, H - 0.1, D / 2 - 0.12);
  kit.box('paint', AUBERGINE, 0.22, 0.8, D, W / 2 - 0.12, H - 0.1, 0);
  for (let i = 1; i < 5; i++)
    kit.box('paint', 0x3c2242, 0.09, H - 1.9, 0.12, -W / 2 + (i * W) / 5, 2.75, D / 2 - 0.12);
  for (let i = 1; i < 4; i++)
    kit.box('paint', 0x3c2242, 0.12, H - 1.9, 0.09, W / 2 - 0.12, 2.75, -D / 2 + (i * D) / 4);
  kit.box('paint', 0x3c2242, W - 0.4, 0.09, 0.12, 0, 3.4, D / 2 - 0.12);
  kit.box('glass', 0xffffff, W - 0.5, H - 1.9, 0.04, 0, 2.75, D / 2 - 0.14);
  kit.box('glass', 0xffffff, 0.04, H - 1.9, D - 0.5, W / 2 - 0.14, 2.75, 0);
  // brass crest over the shopfront
  kit.rod('brass', BRASS, 0.42, 0.08, 'z', 0, H - 0.1, D / 2 + 0.02);
  kit.rod('brass', 0x8a6a2c, 0.26, 0.1, 'z', 0, H - 0.1, D / 2 + 0.04);
  // inside: floor, the press, paper stacks, a hanging lamp
  kit.box('wood', 0x8a6a48, W - 0.4, 0.08, D - 0.4, 0, 0.34, 0);
  const py = 0.38;
  for (const x of [-1.5, 1.5]) {
    kit.box('paint', TEAL, 0.28, 2.3, 1.9, x, py + 1.15, 0);
    kit.box('paint', TEAL, 0.4, 0.2, 2.2, x, py + 0.1, 0);
  }
  kit.rod('steel', STEEL, 0.5, 2.7, 'x', 0, py + 1.75, 0);
  kit.rod('steel', 0x8d9094, 0.16, 3.3, 'x', 0, py + 2.45, 0);
  kit.box('steel', 0x7d8185, 2.7, 0.14, 2.6, 0, py + 1.15, 0.5);
  kit.box('wood', 0x7a5c40, 2.6, 0.1, 1.7, 0, py + 0.5, 0);
  kit.rod('brass', BRASS, 0.34, 0.16, 'x', -1.75, py + 1.75, 0);
  kit.rod('steel', IRON, 0.05, 1.7, 'y', 1.85, py + 2.3, -0.5);
  kit.add('brass', new THREE.SphereGeometry(0.16, 16, 12), BRASS, 1.85, py + 3.2, -0.5);
  kit.box('wood', 0xf2ead8, 1.1, 0.5, 0.8, -2.9, py + 0.3, 1.7);
  kit.box('wood', 0xf2ead8, 1.0, 0.3, 0.8, 2.7, py + 0.2, -1.8);
  kit.rod('steel', IRON, 0.02, 1.2, 'y', 0, H - 0.5, 0.3);
  kit.add('lamp', new THREE.SphereGeometry(0.2, 14, 10), 0xffffff, 0, H - 1.2, 0.3);
}

/** The Crown Lathe: a brass-and-teal engine lathe on a stone plinth. */
function crownLathe(kit: Kit): void {
  kit.box('stone', 0xc9bca6, 6.2, 0.7, 2.6, 0, 0.35, 0);
  kit.box('stone', 0xb9aa94, 6.6, 0.18, 3.0, 0, 0.09, 0);
  const y = 0.7;
  // bed on two cabinet legs with brass drawer fronts
  for (const x of [-1.9, 1.9]) {
    kit.box('paint', TEAL, 1.5, 0.95, 1.2, x, y + 0.48, 0);
    kit.box('brass', BRASS, 1.0, 0.36, 0.05, x, y + 0.5, 0.62);
    kit.box('brass', 0x8a6a2c, 0.3, 0.07, 0.07, x, y + 0.5, 0.66);
  }
  kit.box('paint', TEAL, 5.4, 0.3, 1.0, 0, y + 1.1, 0);
  kit.box('steel', STEEL, 5.2, 0.06, 0.16, 0, y + 1.28, 0.3);
  kit.box('steel', STEEL, 5.2, 0.06, 0.16, 0, y + 1.28, -0.3);
  // headstock with its crown
  kit.box('paint', TEAL, 1.2, 1.3, 1.1, -2.0, y + 1.9, 0);
  kit.rod('brass', BRASS, 0.36, 0.3, 'x', -1.25, y + 2.0, 0);
  kit.rod('steel', STEEL, 0.27, 0.5, 'x', -0.9, y + 2.0, 0);
  kit.rod('steel', 0x8d9094, 0.07, 1.6, 'x', 0.1, y + 2.0, 0);
  kit.rod('brass', BRASS, 0.5, 0.16, 'y', -2.0, y + 2.63, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    kit.add(
      'brass',
      new THREE.ConeGeometry(0.09, 0.42, 8),
      BRASS,
      -2.0 + Math.cos(a) * 0.4,
      y + 2.9,
      Math.sin(a) * 0.4,
    );
  }
  kit.add('brass', new THREE.SphereGeometry(0.13, 12, 10), BRASS, -2.0, y + 3.05, 0);
  // carriage, tool post, handwheels, tailstock
  kit.box('steel', 0x7d8185, 0.9, 0.2, 1.3, 0.4, y + 1.4, 0);
  kit.box('steel', IRON, 0.36, 0.34, 0.36, 0.4, y + 1.65, 0.1);
  kit.add('brass', new THREE.TorusGeometry(0.22, 0.035, 8, 20), BRASS, 0.4, y + 1.15, 0.72);
  kit.box('paint', TEAL, 0.8, 0.8, 0.8, 2.1, y + 1.65, 0);
  kit.rod('steel', STEEL, 0.1, 0.9, 'x', 1.5, y + 2.0, 0, 0.03);
  kit.add('brass', new THREE.TorusGeometry(0.28, 0.04, 8, 22), BRASS, 2.62, y + 2.0, 0, [
    0,
    Math.PI / 2,
    0,
  ]);
  kit.rod('steel', IRON, 0.03, 0.56, 'z', 2.62, y + 2.0, 0);
}

/**
 * Places the district machines the story is about, at the spots the world file gives their
 * (collider-only) blocks. A warm light inside the press shop makes it read at dusk.
 */
export function buildMachines(world: WorldDef): THREE.Group {
  registerLamp(MATERIALS.lamp as THREE.MeshStandardMaterial);
  const root = new THREE.Group();
  root.name = 'machines';
  const block = (id: string) => {
    for (const cell of world.cells) {
      const o = cell.objects.find((x) => x.id === id);
      if (o && o.kind === 'block') return o;
    }
    return null;
  };
  const press = block('market.rollPress');
  if (press) {
    const base = press.center[1] - press.size[1] / 2;
    const kit = new Kit(
      new THREE.Matrix4().makeTranslation(press.center[0], base, press.center[2]),
    );
    rollPressShop(kit);
    kit.build(root);
    const glow = new THREE.PointLight(0xffb060, 14, 14, 1.6);
    glow.position.set(press.center[0], base + 3.8, press.center[2] + 0.3);
    root.add(glow);
  }
  const lathe = block('crown.lathe');
  if (lathe) {
    const base = lathe.center[1] - lathe.size[1] / 2;
    const kit = new Kit(
      new THREE.Matrix4().makeTranslation(lathe.center[0], base, lathe.center[2]),
    );
    crownLathe(kit);
    kit.build(root);
  }
  return root;
}
