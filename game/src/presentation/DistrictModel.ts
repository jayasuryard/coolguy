import type { BuildingDef, DistrictSheet, LandDef, PropDef } from '@content/types';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ColliderMesh } from './CityModel';
import { registerLamp } from './ambience';
import { applySurface } from './Surfaces';

/** A solid box for physics (buildings, tree trunks). */
export interface ColliderBox {
  center: [number, number, number];
  half: [number, number, number];
  yaw: number;
}

const LAND_COLOR: Record<LandDef['surface'], number> = {
  paving: 0xcbb49a,
  plaza: 0xd8c6a8,
  sand: 0xe9d3a2,
  grass: 0x7f9a55,
  planks: 0x9a7650,
  stone: 0xb3a48f,
  road: 0x8c8478,
};
const LAND_MATERIAL: Record<LandDef['surface'], Bucket> = {
  paving: 'ground',
  plaza: 'ground',
  road: 'ground',
  stone: 'ground',
  grass: 'ground',
  sand: 'sand',
  planks: 'planks',
};
type Bucket =
  | 'ground'
  | 'sand'
  | 'planks'
  | 'facade'
  | 'roof'
  | 'cloth'
  | 'wood'
  | 'flora'
  | 'painted'
  | 'rock'
  | 'bulb';

/**
 * Builds a mainland district from its sheet: extruded land, townhouses with roofs and awnings,
 * and street dressing — merged into one mesh per material, with matching colliders. Districts
 * are always resident (they are the skyline), like the island city model.
 */
export class DistrictModel {
  readonly root = new THREE.Group();
  readonly meshes: ColliderMesh[] = [];
  readonly boxes: ColliderBox[] = [];
  private readonly parts = new Map<Bucket, THREE.BufferGeometry[]>();

  constructor(sheets: DistrictSheet[]) {
    this.root.name = 'districts';
    for (const sheet of sheets) {
      sheet.lands.forEach((l) => this.land(l));
      sheet.buildings.forEach((b) => this.building(b));
      sheet.props.forEach((p) => this.prop(p));
    }
    for (const [bucket, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material(bucket));
      mesh.name = `district_${bucket}`;
      mesh.castShadow = bucket !== 'ground' && bucket !== 'sand';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
  }

  /** Add a geometry (any indexing) to a material bucket, tinted, with a transform baked in. */
  private add(
    bucket: Bucket,
    g: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    m?: THREE.Matrix4,
  ): void {
    const out = g.index ? g.toNonIndexed() : g;
    if (m) out.applyMatrix4(m);
    if (!out.getAttribute('normal')) out.computeVertexNormals();
    const n = out.getAttribute('position').count;
    const c = new THREE.Color(color);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // every bucket carries the facade attribute so merged geometries stay compatible
    if (!out.getAttribute('surfUv')) {
      out.setAttribute('surfUv', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    }
    out.deleteAttribute('uv');
    if (out !== g) g.dispose();
    const list = this.parts.get(bucket) ?? [];
    list.push(out);
    this.parts.set(bucket, list);
  }

  // ---------------------------------------------------------------- land
  private land(l: LandDef): void {
    const pts = l.outline.map(([x, z, y]) => new THREE.Vector3(x, y ?? l.y, z));
    const flat = pts.map((p) => new THREE.Vector2(p.x, p.z));
    const tris = THREE.ShapeUtils.triangulateShape(flat, []);
    const low = Math.min(...pts.map((p) => p.y)) - (l.skirt ?? 5);
    const pos: number[] = [];
    const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      // keep the top facing up and the sides facing out, whatever the outline's winding
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    for (const [a, b, c] of tris) {
      const A = pts[a!]!;
      const B = pts[b!]!;
      const C = pts[c!]!;
      const up = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z) > 0;
      if (up) push(A, B, C);
      else push(A, C, B);
    }
    const clockwise = THREE.ShapeUtils.isClockWise(flat);
    for (let i = 0; i < pts.length; i++) {
      const A = pts[i]!;
      const B = pts[(i + 1) % pts.length]!;
      const A0 = new THREE.Vector3(A.x, low, A.z);
      const B0 = new THREE.Vector3(B.x, low, B.z);
      if (clockwise) {
        push(A, B, B0);
        push(A, B0, A0);
      } else {
        push(A, B0, B);
        push(A, A0, B0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    this.meshes.push({
      name: l.id,
      vertices: new Float32Array(pos),
      indices: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i),
    });
    this.add(LAND_MATERIAL[l.surface], g, LAND_COLOR[l.surface]);
  }

  // ---------------------------------------------------------------- buildings
  private building(b: BuildingDef): void {
    const [w, h, d] = b.size;
    const yaw = THREE.MathUtils.degToRad(b.rotationY ?? 0);
    const place = new THREE.Matrix4()
      .makeRotationY(yaw)
      .setPosition(b.position[0], b.position[1], b.position[2]);
    const at = (x: number, y: number, z: number, rx = 0) =>
      place.clone().multiply(new THREE.Matrix4().makeRotationX(rx).setPosition(x, y, z));

    // walls: a box whose faces know their own size, so the facade shader can lay out windows
    const walls = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    const uv = walls.getAttribute('uv');
    const nrm = walls.getAttribute('normal');
    const surf = new Float32Array(uv.count * 4);
    for (let i = 0; i < uv.count; i++) {
      const side = Math.abs(nrm.getX(i)) > 0.5 ? d : Math.abs(nrm.getZ(i)) > 0.5 ? w : 0;
      surf.set([uv.getX(i) * side, uv.getY(i) * h, side, h], i * 4);
    }
    walls.setAttribute('surfUv', new THREE.BufferAttribute(surf, 4));
    this.add('facade', walls, b.wall, at(0, h / 2, 0));
    this.boxes.push({
      center: [b.position[0], b.position[1] + h / 2, b.position[2]],
      half: [w / 2, h / 2, d / 2],
      yaw,
    });

    const roofColor = b.roofColor ?? 0xc4603c;
    if (b.roof === 'hip') {
      this.add('roof', hipRoof(w + 0.9, d + 0.9, Math.min(w, d) * 0.3), roofColor, at(0, h, 0));
      this.add(
        'facade',
        new THREE.BoxGeometry(w + 0.5, 0.28, d + 0.5),
        0xe9dcc4,
        at(0, h - 0.1, 0),
      );
    } else if (b.roof === 'dome') {
      const r = Math.min(w, d) * 0.52;
      const dome = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      this.add('painted', dome, roofColor, at(0, h, 0));
      this.add('facade', new THREE.BoxGeometry(w + 0.6, 0.3, d + 0.6), 0xe9dcc4, at(0, h, 0));
    } else {
      // flat roof terrace with a parapet
      this.add('facade', new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), 0xe9dcc4, at(0, h + 0.1, 0));
      this.add('roof', new THREE.BoxGeometry(w - 0.5, 0.12, d - 0.5), 0x9c8f80, at(0, h + 0.36, 0));
    }
    if (b.awning) {
      const awning = new THREE.BoxGeometry(w * 0.86, 0.07, 1.9);
      this.add('cloth', awning, b.awning, at(0, 2.85, d / 2 + 0.85, 0.3));
    }
  }

  // ---------------------------------------------------------------- props
  private prop(p: PropDef): void {
    const s = p.scale ?? 1;
    const yaw = THREE.MathUtils.degToRad(p.rotationY ?? 0);
    const base = new THREE.Matrix4()
      .makeRotationY(yaw)
      .scale(new THREE.Vector3(s, s, s))
      .setPosition(p.position[0], p.position[1], p.position[2]);
    const at = (x: number, y: number, z: number, rx = 0, rz = 0, ry = 0) =>
      base
        .clone()
        .multiply(
          new THREE.Matrix4()
            .makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))
            .setPosition(x, y, z),
        );
    const solid = (h: number, r: number) =>
      this.boxes.push({
        center: [p.position[0], p.position[1] + (h * s) / 2, p.position[2]],
        half: [r * s, (h * s) / 2, r * s],
        yaw,
      });

    switch (p.prop) {
      case 'palm': {
        // a gently leaning trunk in three segments, then a crown of drooping fronds
        let x = 0;
        for (let i = 0; i < 3; i++) {
          this.add(
            'wood',
            new THREE.CylinderGeometry(0.16 - i * 0.02, 0.2 - i * 0.02, 2.2, 7),
            0x8a7458,
            at(x, 1.1 + i * 2.1, 0, 0, -0.07 * (i + 1)),
          );
          x += 0.16 * (i + 1);
        }
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const frond = new THREE.ConeGeometry(0.42, 3.1, 4)
            .rotateX(Math.PI / 2)
            .translate(0, 0, 1.55);
          this.add('flora', frond, i % 2 ? 0x5f8f45 : 0x6fa04c, at(x, 6.45, 0, 0.42, 0, a));
        }
        solid(6, 0.22);
        break;
      }
      case 'tree':
        this.add('wood', new THREE.CylinderGeometry(0.16, 0.24, 2.6, 7), 0x7a5c40, at(0, 1.3, 0));
        this.add('flora', new THREE.IcosahedronGeometry(1.7, 1), 0x6f9a4a, at(0, 3.5, 0));
        this.add('flora', new THREE.IcosahedronGeometry(1.2, 1), 0x82aa55, at(0.9, 4.3, 0.4));
        solid(2.6, 0.25);
        break;
      case 'lamp':
        this.add(
          'painted',
          new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8),
          0x2c5f5c,
          at(0, 2.1, 0),
        );
        this.add('painted', new THREE.BoxGeometry(0.5, 0.06, 0.06), 0x2c5f5c, at(0.22, 4.15, 0));
        this.add('bulb', new THREE.SphereGeometry(0.2, 12, 8), 0xffe2a6, at(0.45, 3.95, 0));
        solid(4.2, 0.12);
        break;
      case 'parasol':
        this.add('wood', new THREE.CylinderGeometry(0.035, 0.035, 3.2, 6), 0xd8cdb8, at(0, 1.0, 0));
        this.add(
          'cloth',
          new THREE.ConeGeometry(1.5, 0.55, 10),
          p.color ?? 0xc8412f,
          at(0, 2.5, 0),
        );
        this.add('cloth', new THREE.BoxGeometry(0.85, 0.05, 1.9), 0xf0e6d0, at(1.1, 0.06, 0.3));
        break;
      case 'bench':
        this.add('wood', new THREE.BoxGeometry(1.9, 0.07, 0.5), 0x8a6a48, at(0, 0.46, 0));
        this.add(
          'wood',
          new THREE.BoxGeometry(1.9, 0.5, 0.07),
          0x8a6a48,
          at(0, 0.78, -0.24, -0.15),
        );
        for (const x of [-0.8, 0.8])
          this.add('painted', new THREE.BoxGeometry(0.07, 0.46, 0.46), 0x2c5f5c, at(x, 0.23, 0));
        solid(0.8, 0.5);
        break;
      case 'rail': {
        // timber handrail: posts every ~2.2 m, a top rail and a mid rail
        const len = p.length ?? 4;
        const n = Math.max(1, Math.round(len / 2.2));
        for (let i = 0; i <= n; i++) {
          this.add(
            'wood',
            new THREE.BoxGeometry(0.12, 1.15, 0.12),
            0x7a5c40,
            at(-len / 2 + (i * len) / n, 0.57, 0),
          );
        }
        this.add('wood', new THREE.BoxGeometry(len + 0.1, 0.09, 0.16), 0x8a6a48, at(0, 1.12, 0));
        this.add('wood', new THREE.BoxGeometry(len, 0.07, 0.07), 0x7a5c40, at(0, 0.62, 0));
        this.boxes.push({
          center: [p.position[0], p.position[1] + 0.6, p.position[2]],
          half: [len / 2, 0.6, 0.08],
          yaw,
        });
        break;
      }
      case 'post':
        this.add('wood', new THREE.CylinderGeometry(0.2, 0.2, 7, 8), 0x6e5740, at(0, 3.3, 0));
        break;
      case 'rock':
        this.add(
          'rock',
          new THREE.DodecahedronGeometry(1, 0).scale(1.3, 0.8, 1),
          0xa39a8c,
          at(0, 0.3, 0, 0.3, 0.2),
        );
        break;
      case 'boat':
      case 'sailboat': {
        const hull = new THREE.SphereGeometry(
          1,
          12,
          8,
          0,
          Math.PI * 2,
          Math.PI / 2,
          Math.PI / 2,
        ).scale(1.1, 0.9, 3.1);
        this.add('painted', hull, p.color ?? 0xf0ead8, at(0, 0.75, 0));
        this.add('wood', new THREE.BoxGeometry(1.9, 0.08, 5.4), 0xb0895c, at(0, 0.72, 0));
        this.add('painted', new THREE.BoxGeometry(1.2, 0.5, 1.5), 0xf0ead8, at(0, 1.0, -0.6));
        if (p.prop === 'sailboat') {
          this.add(
            'wood',
            new THREE.CylinderGeometry(0.06, 0.08, 7.5, 6),
            0xd8cdb8,
            at(0, 4.4, 0.4),
          );
          const sail = new THREE.BufferGeometry();
          sail.setAttribute(
            'position',
            new THREE.BufferAttribute(
              new Float32Array([0, 0, 0, 0, 6.2, 0, 0, 0, -2.6, 0, 0, 0, 0, 0, -2.6, 0, 6.2, 0]),
              3,
            ),
          );
          this.add('cloth', sail, 0xfaf5e8, at(0.02, 1.6, 0.3));
        }
        break;
      }
    }
  }
}

/** Hipped roof over a w × d footprint, ridge along the longer side, eaves at y = 0. */
function hipRoof(w: number, d: number, rise: number): THREE.BufferGeometry {
  const long = w >= d;
  const L = (long ? w : d) / 2;
  const S = (long ? d : w) / 2;
  const r = Math.max(0, L - S); // half ridge length
  // corners (±L, ±S) in (long, short) axes; ridge ends (±r, 0)
  const P = (a: number, y: number, b: number): [number, number, number] =>
    long ? [a, y, b] : [b, y, a];
  const A = P(-L, 0, -S);
  const B = P(L, 0, -S);
  const C = P(L, 0, S);
  const D = P(-L, 0, S);
  const R0 = P(-r, rise, 0);
  const R1 = P(r, rise, 0);
  const tris = long
    ? [D, C, R1, D, R1, R0, B, A, R0, B, R0, R1, A, D, R0, C, B, R1]
    : [C, D, R1, R1, D, R0, A, B, R0, R0, B, R1, D, A, R0, B, C, R1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  g.computeVertexNormals();
  return g;
}

function material(bucket: Bucket): THREE.Material {
  const named = (
    name: string,
    roughness: number,
    extra: THREE.MeshStandardMaterialParameters = {},
  ) => {
    const m = new THREE.MeshStandardMaterial({ name, vertexColors: true, roughness, ...extra });
    applySurface(m);
    return m;
  };
  switch (bucket) {
    case 'ground':
      return named('M_terrain', 0.9);
    case 'sand':
      return named('M_sand', 0.95);
    case 'planks':
      return named('M_planks', 0.8);
    case 'facade':
      return named('M_facade', 0.88);
    case 'roof':
      return named('M_roof', 0.75, { side: THREE.DoubleSide });
    case 'wood':
      return named('M_wood', 0.8);
    case 'flora':
      return named('M_flora', 0.9, { side: THREE.DoubleSide });
    case 'painted':
      return named('M_painted', 0.5);
    case 'rock':
      return named('M_rock', 0.95);
    case 'cloth':
      return new THREE.MeshStandardMaterial({
        name: 'cloth',
        vertexColors: true,
        roughness: 0.9,
        side: THREE.DoubleSide,
      });
    case 'bulb': {
      const bulb = new THREE.MeshStandardMaterial({
        name: 'bulb',
        color: 0xffe2a6,
        emissive: 0xffa544,
        emissiveIntensity: 2.2,
      });
      registerLamp(bulb);
      return bulb;
    }
  }
}
