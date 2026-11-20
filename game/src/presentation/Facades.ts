import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerLamp } from './ambience';
import { pieces, withoutPieces, type Blob } from './Foliage';
import { applySurface } from './Surfaces';

/**
 * The Blender city marks every window, shutter and door with a flat slab. This reads those
 * slabs and builds the real thing at each one — stone surrounds, glazed sashes, louvred
 * shutters, panelled doors under arches, balconies, cornices — and gives the station its
 * iron brackets, lanterns, doors and plank ceiling. Each kind is one instanced mesh.
 */
export interface FacadeResult {
  add: THREE.Object3D[];
  replace: Array<[THREE.Mesh, THREE.Mesh]>;
}

const box = (
  w: number,
  h: number,
  d: number,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  return g.translate(x, y, z);
};
const join = (...parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const flat = parts.map((p) => {
    const n = p.index ? p.toNonIndexed() : p;
    n.deleteAttribute('uv');
    return n;
  });
  return mergeGeometries(flat, false)!;
};

// ---------------------------------------------------------------- unit pieces (facing +z)
const windowStone = () =>
  join(
    box(1.16, 0.09, 0.22, 0, -0.745, 0.1),
    box(1.12, 0.15, 0.15, 0, 0.775, 0.07),
    box(0.1, 1.4, 0.11, -0.5, 0, 0.055),
    box(0.1, 1.4, 0.11, 0.5, 0, 0.055),
  );
const windowFrame = () =>
  join(
    box(0.9, 0.06, 0.06, 0, 0.67, 0.045),
    box(0.9, 0.06, 0.06, 0, -0.67, 0.045),
    box(0.06, 1.4, 0.06, -0.42, 0, 0.045),
    box(0.06, 1.4, 0.06, 0.42, 0, 0.045),
    box(0.04, 1.3, 0.05, 0, 0, 0.045),
    box(0.8, 0.035, 0.05, 0, 0.22, 0.045),
  );
const windowGlass = () => join(box(0.8, 1.3, 0.02, 0, 0, 0.018));
const shutter = () => {
  const parts = [
    box(0.5, 0.06, 0.05, 0, 0.67, 0.04),
    box(0.5, 0.06, 0.05, 0, -0.67, 0.04),
    box(0.06, 1.4, 0.05, -0.22, 0, 0.04),
    box(0.06, 1.4, 0.05, 0.22, 0, 0.04),
    box(0.5, 0.05, 0.05, 0, 0, 0.04),
    box(0.42, 1.3, 0.012, 0, 0, 0.012),
  ];
  for (let i = 0; i < 12; i++) {
    const y = -0.59 + i * 0.107 + (i > 5 ? 0.04 : -0.04);
    parts.push(box(0.4, 0.07, 0.014, 0, y, 0.04, 0.6));
  }
  return join(...parts);
};
const doorStone = () => {
  const arch = new THREE.TorusGeometry(0.68, 0.085, 6, 14, Math.PI).translate(0, 1.15, 0.08);
  return join(
    box(0.17, 2.3, 0.17, -0.68, 0, 0.085),
    box(0.17, 2.3, 0.17, 0.68, 0, 0.085),
    arch,
    box(1.66, 0.14, 0.42, 0, -1.22, 0.2),
    box(0.2, 0.12, 0.2, -0.68, 1.15, 0.09),
    box(0.2, 0.12, 0.2, 0.68, 1.15, 0.09),
  );
};
const doorLeaves = () => {
  const parts = [box(1.2, 0.5, 0.05, 0, 1.38, 0.02)];
  for (const x of [-0.3, 0.3]) {
    parts.push(
      box(0.58, 2.28, 0.06, x, 0, 0.04),
      box(0.4, 0.82, 0.03, x, 0.56, 0.085),
      box(0.4, 0.82, 0.03, x, -0.5, 0.085),
      box(0.3, 0.66, 0.02, x, 0.56, 0.105),
      box(0.3, 0.66, 0.02, x, -0.5, 0.105),
    );
  }
  return join(...parts);
};
const doorBrass = () =>
  join(
    new THREE.SphereGeometry(0.04, 8, 6).translate(-0.07, 0.02, 0.12),
    new THREE.SphereGeometry(0.04, 8, 6).translate(0.07, 0.02, 0.12),
  );
const balconyStone = () =>
  join(
    box(1.5, 0.1, 0.6, 0, -0.86, 0.3),
    box(0.12, 0.3, 0.45, -0.55, -1.03, 0.22, 0.5),
    box(0.12, 0.3, 0.45, 0.55, -1.03, 0.22, 0.5),
  );
const balconyIron = () => {
  const parts = [
    box(1.5, 0.04, 0.04, 0, 0.1, 0.58),
    box(0.04, 0.04, 0.58, -0.73, 0.1, 0.3),
    box(0.04, 0.04, 0.58, 0.73, 0.1, 0.3),
    box(1.5, 0.03, 0.03, 0, -0.7, 0.58),
  ];
  for (let i = 0; i <= 10; i++) parts.push(box(0.022, 0.92, 0.022, -0.73 + i * 0.146, -0.35, 0.58));
  for (const x of [-0.73, 0.73])
    for (const z of [0.15, 0.36]) parts.push(box(0.022, 0.92, 0.022, x, -0.35, z));
  return join(...parts);
};
/** Quarter-circle bracket from a post (at x = 0, rising) out along +x under a beam (at y = 0). */
const bracket = () => {
  const R = 1.05;
  const arc = new THREE.TorusGeometry(R, 0.04, 6, 12, Math.PI / 2)
    .rotateZ(Math.PI / 2)
    .translate(R, -R, 0);
  const scroll = new THREE.TorusGeometry(0.2, 0.03, 6, 12).translate(0.33, -0.33, 0);
  return join(
    arc,
    scroll,
    box(0.05, R, 0.05, 0.03, -R / 2, 0),
    box(R, 0.05, 0.05, R / 2, -0.03, 0),
  );
};
const lanternIron = () => {
  const parts: THREE.BufferGeometry[] = [
    box(0.03, 0.75, 0.03, 0, 0.72, 0),
    new THREE.ConeGeometry(0.27, 0.16, 8).translate(0, 0.33, 0),
    new THREE.TorusGeometry(0.2, 0.02, 6, 12).rotateX(Math.PI / 2).translate(0, -0.24, 0),
    new THREE.TorusGeometry(0.24, 0.02, 6, 12).rotateX(Math.PI / 2).translate(0, 0.24, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(box(0.02, 0.5, 0.02, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22));
  }
  return join(...parts);
};

// ---------------------------------------------------------------- materials
const stoneMat = (): THREE.Material => {
  const m = new THREE.MeshStandardMaterial({ name: 'M_stone', color: 0xd6c9b0, roughness: 0.85 });
  applySurface(m);
  return m;
};
const paintMat = (): THREE.Material => {
  const m = new THREE.MeshStandardMaterial({ name: 'M_painted', color: 0xffffff, roughness: 0.6 });
  applySurface(m);
  return m;
};

function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  at: THREE.Matrix4[],
  colors?: THREE.Color[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, at.length);
  at.forEach((m, i) => mesh.setMatrixAt(i, m));
  colors?.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const size = (b: Blob) => new THREE.Vector3().subVectors(b.max, b.min);
const mid = (b: Blob) => new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
const near = (a: number, b: number, tol = 0.12) => Math.abs(a - b) < tol;

export function dressBuildings(
  scene: THREE.Object3D,
  nameOf: (o: THREE.Object3D) => string,
): FacadeResult {
  const out: FacadeResult = { add: [], replace: [] };
  const find = (name: string): THREE.Mesh | undefined => {
    let hit: THREE.Mesh | undefined;
    scene.traverse((o) => {
      if (!hit && (o as THREE.Mesh).isMesh && nameOf(o) === name) hit = o as THREE.Mesh;
    });
    return hit;
  };
  let seed = 4711;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ================================================================ houses
  const walls = find('CITY_village_walls');
  const trims = find('CITY_village_trims');
  if (walls && trims) {
    const houses = pieces(walls);
    const all = pieces(trims);
    const thin = (b: Blob) => Math.min(size(b).x, size(b).z) < 0.17;
    const span = (b: Blob) => Math.max(size(b).x, size(b).z);
    const isPane = (b: Blob) =>
      thin(b) && near(span(b), 0.9) && size(b).y > 1.15 && size(b).y < 1.6 && b.color.g < 0.06;
    const isShutter = (b: Blob) =>
      thin(b) && near(span(b), 0.5) && size(b).y > 1.15 && size(b).y < 1.6;
    const isDoor = (b: Blob) =>
      thin(b) && near(span(b), 1.2) && size(b).y > 2.05 && size(b).y < 2.6;

    /** Where a slab sits on its house: a matrix facing out of the wall, scaled to the slab. */
    const seat = (b: Blob, unitW: number, unitH: number): THREE.Matrix4 | null => {
      const c = mid(b);
      const s = size(b);
      const alongX = s.x < s.z; // thin in x → the wall faces ±x
      const house = houses.find(
        (h) =>
          c.x > h.min.x - 0.4 &&
          c.x < h.max.x + 0.4 &&
          c.z > h.min.z - 0.4 &&
          c.z < h.max.z + 0.4 &&
          c.y > h.min.y - 0.5 &&
          c.y < h.max.y + 0.5,
      );
      if (!house) return null;
      const hc = mid(house);
      const sign = alongX ? Math.sign(c.x - hc.x) || 1 : Math.sign(c.z - hc.z) || 1;
      const p = c.clone();
      if (alongX) p.x = sign > 0 ? house.max.x : house.min.x;
      else p.z = sign > 0 ? house.max.z : house.min.z;
      const yaw = alongX ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : sign > 0 ? 0 : Math.PI;
      return new THREE.Matrix4().compose(
        p,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
        new THREE.Vector3(span(b) / unitW, s.y / unitH, 1),
      );
    };

    const panes: THREE.Matrix4[] = [];
    const dark: THREE.Matrix4[] = [];
    const lit: THREE.Matrix4[] = [];
    const balconies: THREE.Matrix4[] = [];
    const shutters: THREE.Matrix4[] = [];
    const shutterColors: THREE.Color[] = [];
    const doors: THREE.Matrix4[] = [];
    const doorColors: THREE.Color[] = [];
    const taken: Blob[] = [];
    for (const b of all) {
      if (isPane(b)) {
        const m = seat(b, 0.9, 1.4);
        if (!m) continue;
        panes.push(m);
        (rnd() < 0.3 ? lit : dark).push(m);
        // an iron balcony under some upper windows
        if (
          rnd() < 0.14 &&
          mid(b).y -
            houses.reduce(
              (y, h) =>
                Math.abs(mid(h).x - mid(b).x) < 8 && Math.abs(mid(h).z - mid(b).z) < 8
                  ? Math.min(y, h.min.y)
                  : y,
              Infinity,
            ) >
            4.2
        )
          balconies.push(m);
        taken.push(b);
      } else if (isShutter(b)) {
        const m = seat(b, 0.5, 1.4);
        if (!m) continue;
        shutters.push(m);
        shutterColors.push(
          new THREE.Color().setRGB(b.color.r * 1.5, b.color.g * 1.5, b.color.b * 1.5),
        );
        taken.push(b);
      } else if (isDoor(b)) {
        const m = seat(b, 1.2, 2.3);
        if (!m) continue;
        doors.push(m);
        doorColors.push(
          new THREE.Color().setRGB(b.color.r * 1.4, b.color.g * 1.4, b.color.b * 1.4),
        );
        taken.push(b);
      }
    }
    const stone = stoneMat();
    const frame = new THREE.MeshStandardMaterial({ color: 0xe9e1d0, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0b1316,
      roughness: 0.07,
      metalness: 0.65,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x1a1410,
      roughness: 0.3,
      emissive: 0xffb261,
      emissiveIntensity: 1.5,
    });
    registerLamp(glow);
    const iron = new THREE.MeshStandardMaterial({
      color: 0x1c2726,
      roughness: 0.5,
      metalness: 0.6,
    });
    const brass = new THREE.MeshStandardMaterial({
      color: 0xc9a14a,
      roughness: 0.35,
      metalness: 0.9,
    });
    const paint = paintMat();
    out.add.push(
      instanced(windowStone(), stone, panes),
      instanced(windowFrame(), frame, panes),
      instanced(windowGlass(), glass, dark),
      instanced(windowGlass(), glow, lit),
      instanced(shutter(), paint, shutters, shutterColors),
      instanced(doorStone(), stone, doors),
      instanced(doorLeaves(), paint, doors, doorColors),
      instanced(doorBrass(), brass, doors),
      instanced(balconyStone(), stone, balconies),
      instanced(balconyIron(), iron, balconies),
    );
    // cornice under every eave
    const cornices: THREE.BufferGeometry[] = [];
    for (const h of houses) {
      const s = size(h);
      const c = mid(h);
      cornices.push(
        box(s.x + 0.4, 0.2, s.z + 0.4, c.x, h.max.y - 0.1, c.z),
        box(s.x + 0.22, 0.16, s.z + 0.22, c.x, h.max.y - 0.28, c.z),
      );
    }
    const cornice = new THREE.Mesh(join(...cornices), stone);
    cornice.castShadow = cornice.receiveShadow = true;
    out.add.push(cornice);
    // the flat slabs these replace come out of the trim mesh
    const keyOf = (b: Blob) =>
      `${Math.round(b.min.x * 20)},${Math.round(b.min.y * 20)},${Math.round(b.min.z * 20)}`;
    const gone = new Set(taken.map(keyOf));
    out.replace.push([trims, withoutPieces(trims, (b) => gone.has(keyOf(b)))]);
  }

  // ================================================================ station
  const ironwork = find('CITY_quay_iron');
  const bulbs = find('CITY_bulbs');
  if (ironwork) {
    const all = pieces(ironwork);
    const posts = all.filter(
      (b) => near(size(b).y, 6.4, 0.3) && size(b).x < 0.6 && size(b).z < 0.6,
    );
    const doorSlabs = all.filter((b) => near(size(b).x, 2.8, 0.2) && near(size(b).y, 4.2, 0.3));
    const transoms = all.filter(
      (b) => near(size(b).x, 2.0, 0.2) && near(size(b).y, 0.7, 0.15) && b.color.g < 0.05,
    );
    const iron = new THREE.MeshStandardMaterial({
      name: 'M_painted',
      color: 0x24524d,
      roughness: 0.55,
      metalness: 0.3,
    });
    applySurface(iron);
    const stone = stoneMat();
    const paint = paintMat();

    // brackets: four at the head of each post
    const brackets: THREE.Matrix4[] = [];
    for (const p of posts) {
      const c = mid(p);
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        brackets.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(c.x, p.max.y - 0.32, c.z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
    }
    out.add.push(instanced(bracket(), iron, brackets));

    // doors: tall panelled leaves under a stone arch, in the station's green
    const doors = doorSlabs.map((b) => {
      const c = mid(b);
      return new THREE.Matrix4().compose(
        new THREE.Vector3(c.x, c.y, b.max.z - 0.25),
        new THREE.Quaternion(),
        new THREE.Vector3(2.5 / 1.2, 4.1 / 2.3, 1.5),
      );
    });
    const green = doors.map(() => new THREE.Color().setRGB(0.07, 0.24, 0.22));
    const brass = new THREE.MeshStandardMaterial({
      color: 0xc9a14a,
      roughness: 0.35,
      metalness: 0.9,
    });
    out.add.push(
      instanced(doorStone(), stone, doors),
      instanced(doorLeaves(), paint, doors, green),
      instanced(doorBrass(), brass, doors),
    );
    const gone = new Set(
      [...doorSlabs, ...transoms].map(
        (b) => `${Math.round(b.min.x * 20)},${Math.round(b.min.y * 20)}`,
      ),
    );
    out.replace.push([
      ironwork,
      withoutPieces(ironwork, (b) =>
        gone.has(`${Math.round(b.min.x * 20)},${Math.round(b.min.y * 20)}`),
      ),
    ]);

    // plank ceiling under the glass, between the beams
    const roof = find('CITY_glass');
    if (roof && posts.length) {
      const pane = pieces(roof).find((b) => size(b).x > 60);
      if (pane) {
        const wood = new THREE.MeshStandardMaterial({
          name: 'M_planks',
          color: 0xb99a6f,
          roughness: 0.8,
        });
        applySurface(wood);
        const c = mid(pane);
        const ceiling = new THREE.Mesh(
          box(size(pane).x, 0.06, size(pane).z - 0.3, c.x, posts[0]!.max.y + 0.34, c.z),
          wood,
        );
        ceiling.castShadow = ceiling.receiveShadow = true;
        out.add.push(ceiling);
      }
    }
  }
  if (bulbs) {
    // the big bare bulbs under the canopy become caged lanterns
    const big = pieces(bulbs).filter((b) => size(b).x > 0.5);
    if (big.length) {
      const iron = new THREE.MeshStandardMaterial({
        color: 0x1c2726,
        roughness: 0.5,
        metalness: 0.6,
      });
      const flame = new THREE.MeshStandardMaterial({
        color: 0xffe9c4,
        emissive: 0xffb261,
        emissiveIntensity: 2.4,
        roughness: 0.3,
      });
      registerLamp(flame);
      const at = big.map((b) => new THREE.Matrix4().makeTranslation(mid(b).x, mid(b).y, mid(b).z));
      out.add.push(
        instanced(lanternIron(), iron, at),
        instanced(new THREE.SphereGeometry(0.17, 14, 10), flame, at),
      );
      const gone = new Set(
        big.map((b) => `${Math.round(b.min.x * 20)},${Math.round(b.min.z * 20)}`),
      );
      out.replace.push([
        bulbs,
        withoutPieces(bulbs, (b) =>
          gone.has(`${Math.round(b.min.x * 20)},${Math.round(b.min.z * 20)}`),
        ),
      ]);
    }
  }
  return out;
}
