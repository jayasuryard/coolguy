import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The Blender city places every tree canopy as a low-poly blob. This reads those blobs —
 * one connected piece per tree — and grows a fuller canopy in each one's place and size:
 * umbrella pines where the blob is wide and flat, cypresses where it is tall and thin,
 * rounded shrubs otherwise. Trunks, positions and the planting plan stay the art team's.
 */
interface Blob {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Average vertex colour of the source piece (flowers keep theirs). */
  color: THREE.Color;
  count: number;
}

/** Split a mesh into its connected pieces (world-space bounds of each). */
function pieces(mesh: THREE.Mesh): Blob[] {
  const pos = mesh.geometry.getAttribute('position');
  const col = mesh.geometry.getAttribute('color');
  const tint = new THREE.Color();
  const index = mesh.geometry.index;
  const n = pos.count;
  const parent = new Int32Array(n);
  const rep = new Int32Array(n);
  const seen = new Map<string, number>();
  const v = new THREE.Vector3();
  const world: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    world.push(v.clone());
    const key = `${Math.round(v.x * 50)},${Math.round(v.y * 50)},${Math.round(v.z * 50)}`;
    const first = seen.get(key) ?? i;
    seen.set(key, first);
    rep[i] = first;
    parent[i] = i;
  }
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const count = index ? index.count : n;
  const at = (i: number) => rep[index ? index.getX(i) : i]!;
  for (let t = 0; t < count; t += 3) {
    parent[find(at(t))] = find(at(t + 1));
    parent[find(at(t + 1))] = find(at(t + 2));
  }
  const out = new Map<number, Blob>();
  for (let i = 0; i < n; i++) {
    const root = find(rep[i]!);
    let b = out.get(root);
    if (!b) {
      b = {
        min: world[i]!.clone(),
        max: world[i]!.clone(),
        color: new THREE.Color(0, 0, 0),
        count: 0,
      };
      out.set(root, b);
    }
    b.min.min(world[i]!);
    b.max.max(world[i]!);
    if (col) {
      tint.fromBufferAttribute(col, i);
      b.color.r += tint.r;
      b.color.g += tint.g;
      b.color.b += tint.b;
      b.count++;
    }
  }
  for (const b of out.values()) if (b.count) b.color.multiplyScalar(1 / b.count);
  return [...out.values()];
}

let seed = 7;
const rnd = (): number => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/** A lumpy leaf mass: a displaced icosphere, darker underneath, tinted. */
function clump(
  detail: number,
  scale: THREE.Vector3,
  at: THREE.Vector3,
  color: THREE.Color,
  taper = 0,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  const phase = rnd() * 100;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // same displacement for coincident vertices, so the surface stays closed
    const lump =
      1 +
      0.16 * Math.sin(v.x * 5.1 + phase) * Math.sin(v.y * 4.3 + phase * 1.7) +
      0.12 * Math.sin(v.z * 7.9 + phase * 0.6) * Math.sin(v.x * 6.7 + v.y * 3.1);
    const h = (v.y + 1) / 2; // 0 bottom … 1 top
    const narrow = 1 - taper * h;
    const shade = 0.55 + 0.6 * Math.max(0, v.y * 0.5 + 0.5);
    colors[i * 3] = color.r * shade;
    colors[i * 3 + 1] = color.g * shade;
    colors[i * 3 + 2] = color.b * shade;
    v.multiplyScalar(lump);
    v.x *= narrow;
    v.z *= narrow;
    v.multiply(scale).add(at);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g.toNonIndexed();
}

const PINE = [0x55803c, 0x4c7636, 0x5f8a42, 0x466e33];
const CYPRESS = [0x2f5a34, 0x33603a, 0x2a5230];
const SHRUB = [0x6b9446, 0x789f4c, 0x5f8a42];
const pick = (list: number[]) => new THREE.Color(list[Math.floor(rnd() * list.length)]!);

function grow(b: Blob): THREE.BufferGeometry[] {
  const size = b.max.clone().sub(b.min);
  // bougainvillea and flower beds: keep the art's colour, just give them body
  const flowers = b.count > 0 && b.color.r > b.color.g * 1.1;
  // slender pieces are stems: keep their shape and colour
  if (Math.max(size.x, size.z) < 0.8) {
    const mid = b.min.clone().add(b.max).multiplyScalar(0.5);
    const stem = b.count ? b.color.clone() : new THREE.Color(0x7a5c40);
    return [clump(0, size.clone().multiplyScalar(0.5), mid, stem)];
  }
  const c = b.min.clone().add(b.max).multiplyScalar(0.5);
  const wide = Math.max(size.x, size.z);
  const out: THREE.BufferGeometry[] = [];
  if (size.y > wide * 1.8) {
    // cypress: one tall tapering flame
    out.push(
      clump(
        2,
        new THREE.Vector3(size.x * 0.56, size.y * 0.52, size.z * 0.56),
        c,
        pick(CYPRESS),
        0.72,
      ),
    );
  } else if (wide > 5 && size.y < wide * 0.6) {
    // umbrella pine: a flat crown of overlapping clumps, slightly domed
    const count = Math.round(THREE.MathUtils.clamp(wide * 1.1, 7, 13));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd();
      const r = i === 0 ? 0 : 0.2 + rnd() * 0.3;
      const at = new THREE.Vector3(
        c.x + Math.cos(a) * size.x * r,
        c.y + size.y * (0.12 - r * 0.35) + rnd() * 0.3,
        c.z + Math.sin(a) * size.z * r,
      );
      const s = wide * (0.2 + rnd() * 0.09);
      out.push(clump(1, new THREE.Vector3(s, size.y * (0.3 + rnd() * 0.12), s), at, pick(PINE)));
    }
  } else {
    // shrub or small round tree
    const count = wide > 2.5 ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const at = new THREE.Vector3(
        c.x + (rnd() - 0.5) * size.x * 0.45,
        c.y + (rnd() - 0.5) * size.y * 0.3,
        c.z + (rnd() - 0.5) * size.z * 0.45,
      );
      const tone = flowers ? b.color.clone().multiplyScalar(0.9 + rnd() * 0.3) : pick(SHRUB);
      out.push(clump(1, size.clone().multiplyScalar(0.34 + rnd() * 0.1), at, tone));
    }
  }
  return out;
}

/**
 * Replace a canopy mesh with grown canopies. Returns the new mesh (same material), or null if
 * the source had nothing to grow from. The caller removes the original.
 */
export type { Blob };
export { pieces };

/**
 * Replace a canopy mesh with grown canopies. Blobs for which `handOver` returns true are left
 * out (a real tree model will stand there instead). Returns the new mesh (same material), or
 * null if nothing was grown. The caller removes the original.
 */
export function regrowCanopies(
  source: THREE.Mesh,
  handOver: (b: Blob) => boolean = () => false,
): THREE.Mesh | null {
  seed = 7 + source.name.length * 131;
  const parts = pieces(source)
    .filter((b) => !handOver(b))
    .flatMap(grow);
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, source.material);
  mesh.name = `${source.name}_grown`;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** A copy of `source` (world space) without the connected pieces `drop` selects. */
export function withoutPieces(source: THREE.Mesh, drop: (b: Blob) => boolean): THREE.Mesh {
  const g = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone();
  // quantised (integer) positions cannot hold world coordinates: widen to floats first
  const raw = g.getAttribute('position');
  const wide = new Float32Array(raw.count * 3);
  for (let i = 0; i < raw.count; i++) wide.set([raw.getX(i), raw.getY(i), raw.getZ(i)], i * 3);
  g.setAttribute('position', new THREE.BufferAttribute(wide, 3));
  g.applyMatrix4(source.matrixWorld);
  const probe = new THREE.Mesh(g);
  const gone = pieces(probe).filter(drop);
  const pos = g.getAttribute('position');
  const keep: number[] = [];
  const c = new THREE.Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    c.fromBufferAttribute(pos, t);
    const inDropped = gone.some(
      (b) =>
        c.x >= b.min.x - 0.01 &&
        c.x <= b.max.x + 0.01 &&
        c.y >= b.min.y - 0.01 &&
        c.y <= b.max.y + 0.01 &&
        c.z >= b.min.z - 0.01 &&
        c.z <= b.max.z + 0.01,
    );
    if (!inDropped) keep.push(t, t + 1, t + 2);
  }
  g.setIndex(keep);
  const mesh = new THREE.Mesh(g.toNonIndexed(), source.material);
  g.dispose();
  mesh.name = source.name;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
