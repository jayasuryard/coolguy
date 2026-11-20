import type { ColliderBox } from './DistrictModel';
import type { TreeSpot } from './CityModel';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurface } from './Surfaces';
import { FOG_FAR } from './Environment';
import type { Placement, Scatter } from './Scatter';

/** Deterministic random stream, so the island is dressed the same on every load. */
function stream(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const STONE_TINT: [number, number, number] = [2.1, 1.85, 1.55];
const TREE_HEIGHT = { tree_island: 6.5, tree_jacaranda: 8.5, tree_small: 4.2 };

/**
 * Dress Old Bellweather with the nature models: real trees where the art team planted them,
 * boulders along the natural shore, cliff rock on the big drops to the sea, and grass, logs
 * and roots on the open hillside. `heightAt` reads the solid world from above (null = sea).
 * Returns boxes for the things Kit should not walk through.
 */
export function dressIsland(
  scatter: Scatter,
  spots: TreeSpot[],
  heightAt: (x: number, z: number) => number | null,
): ColliderBox[] {
  const rnd = stream(20261120);
  const solid: ColliderBox[] = [];
  const spin = () => rnd() * Math.PI * 2;

  // ---------------------------------------------------------------- trees
  const trees: Record<keyof typeof TREE_HEIGHT, Placement[]> = {
    tree_island: [],
    tree_jacaranda: [],
    tree_small: [],
  };
  let jacarandas = 0;
  const firs: Placement[] = [];
  const beds: Record<'celandine' | 'periwinkle' | 'heliophila', Placement[]> = {
    celandine: [],
    periwinkle: [],
    heliophila: [],
  };
  const moss: Placement[] = [];
  const bedParts: THREE.BufferGeometry[] = [];
  const stoneParts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, color: number): THREE.BufferGeometry => {
    const flat = g.toNonIndexed();
    g.dispose();
    const c = new THREE.Color(color);
    const n = flat.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) c.toArray(colors, k * 3);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    flat.deleteAttribute('uv');
    flat.computeVertexNormals();
    return flat;
  };
  /** Ground under a point if it is close to where the art put the plant, else that height. */
  const settle = (x: number, z: number, y: number): number => {
    const h = heightAt(x, z);
    return h !== null && Math.abs(h - y) < 0.45 ? h : y;
  };
  for (const sp of spots) {
    if (sp.kind === 'fir') {
      const y = settle(sp.x, sp.z, sp.base);
      firs.push({
        x: sp.x,
        y: y - 0.05,
        z: sp.z,
        yaw: spin(),
        scale: Math.max(2.2, sp.top - y) / 4.5,
      });
      solid.push({ center: [sp.x, y + 1, sp.z], half: [0.22, 1, 0.22], yaw: 0 });
      continue;
    }
    if (sp.kind === 'plants') {
      // A bed is built in layers: dark soil, a low leafy mound that gives it body, and the
      // real plants standing thickly out of that. A raised bed gets a stone planter around it.
      let cx = sp.x;
      let cz = sp.z;
      let top = sp.base;
      let hx = Math.max(0.3, sp.halfX);
      let hz = Math.max(0.3, sp.halfZ);
      const box = sp.box;
      if (box) {
        const w = box.maxX - box.minX;
        const d = box.maxZ - box.minZ;
        const h = box.top - box.bottom;
        cx = (box.minX + box.maxX) / 2;
        cz = (box.minZ + box.maxZ) / 2;
        const WALL = 0.13;
        const slab = (
          sx: number,
          sy: number,
          sz: number,
          x: number,
          y: number,
          z: number,
          color = 0xd8ccb6,
        ) => {
          const g = new THREE.BoxGeometry(sx, sy, sz);
          g.translate(cx + x, box.bottom + y, cz + z);
          stoneParts.push(paint(g, color));
        };
        slab(w + 0.18, 0.12, d + 0.18, 0, 0.06, 0, 0xc4b79f); // plinth
        for (const side of [-1, 1]) {
          slab(w, h - 0.12, WALL, 0, 0.12 + (h - 0.12) / 2, side * (d / 2 - WALL / 2));
          slab(WALL, h - 0.12, d - WALL * 2, side * (w / 2 - WALL / 2), 0.12 + (h - 0.12) / 2, 0);
          // capstones, slightly proud of the walls
          slab(w + 0.1, 0.08, 0.26, 0, h + 0.04, side * (d / 2 - 0.08), 0xe2d8c4);
          slab(0.26, 0.08, d - 0.42, side * (w / 2 - 0.08), h + 0.04, 0, 0xe2d8c4);
        }
        top = box.top - 0.05; // soil sits just below the rim
        hx = w / 2 - 0.3;
        hz = d / 2 - 0.3;
        solid.push({ center: [cx, box.bottom + h / 2, cz], half: [w / 2, h / 2, d / 2], yaw: 0 });
      }
      const soil = new THREE.BoxGeometry(
        hx * 2 + (box ? 0.34 : -0.3 * hx),
        0.07,
        hz * 2 + (box ? 0.34 : -0.3 * hz),
      );
      soil.translate(cx, top + 0.035, cz);
      bedParts.push(paint(soil, 0x3a2a1e));
      for (let i = 0; i < 4; i++) {
        const mound = new THREE.IcosahedronGeometry(1, 2);
        mound.scale(hx * (0.5 + rnd() * 0.3), 0.1 + rnd() * 0.07, hz * (0.5 + rnd() * 0.3));
        mound.translate(cx + (rnd() - 0.5) * hx * 0.7, top + 0.08, cz + (rnd() - 0.5) * hz * 0.7);
        bedParts.push(paint(mound, sp.flowers ? 0x2c4a25 : 0x29452a));
      }
      const count = Math.round(THREE.MathUtils.clamp(hx * hz * 4 * 26, 26, 64));
      for (let i = 0; i < count; i++) {
        const x = cx + (rnd() * 2 - 1) * hx * 0.9;
        const z = cz + (rnd() * 2 - 1) * hz * 0.9;
        const roll = rnd();
        const kind = sp.flowers
          ? roll < 0.42
            ? 'heliophila'
            : roll < 0.8
              ? 'celandine'
              : 'periwinkle'
          : roll < 0.6
            ? 'periwinkle'
            : roll < 0.92
              ? 'celandine'
              : 'heliophila';
        // heliophila is a tall, loose stem: keep it short so it stands rather than sprawls;
        // in a planter everything stays compact enough to keep inside the rim
        const size =
          kind === 'heliophila'
            ? 0.75 + rnd() * 0.3
            : box
              ? 1.25 + rnd() * 0.55
              : 1.5 + rnd() * 0.8;
        beds[kind].push({ x, y: top + 0.12 + rnd() * 0.1, z, yaw: spin(), scale: size });
      }
      continue;
    }
    // moss gathers in the shade at the foot of each tree
    if (sp.kind === 'pine') {
      for (let i = 0; i < 3; i++) {
        const x = sp.x + (rnd() - 0.5) * 3;
        const z = sp.z + (rnd() - 0.5) * 3;
        const h = heightAt(x, z);
        if (h !== null && Math.abs(h - sp.base) < 1.5)
          moss.push({ x, y: h - 0.01, z, yaw: spin(), scale: 1.5 + rnd() * 2 });
      }
    }

    if (sp.kind === 'planter') {
      // stand the tree in the middle of its planter
      const home = spots.find(
        (o) =>
          o.box && sp.x > o.box.minX && sp.x < o.box.maxX && sp.z > o.box.minZ && sp.z < o.box.maxZ,
      )?.box;
      if (home) {
        sp.x = (home.minX + home.maxX) / 2;
        sp.z = (home.minZ + home.maxZ) / 2;
        sp.base = home.top - 0.05;
      }
    }
    const model: keyof typeof TREE_HEIGHT =
      sp.kind === 'planter'
        ? 'tree_small'
        : sp.width > 9.5 && jacarandas++ < 9
          ? 'tree_jacaranda'
          : 'tree_island';
    const want = Math.max(2.5, sp.top - sp.base) * (model === 'tree_small' ? 1.05 : 1.12);
    trees[model].push({
      x: sp.x,
      y: sp.base - 0.05,
      z: sp.z,
      yaw: spin(),
      scale: want / TREE_HEIGHT[model],
    });
    solid.push({ center: [sp.x, sp.base + 1.2, sp.z], half: [0.3, 1.2, 0.3], yaw: 0 });
  }
  scatter.add('fir', firs, true, undefined, FOG_FAR);
  for (const [name, list] of Object.entries(beds)) scatter.add(name, list, false, undefined, 150);
  for (const [name, list] of Object.entries(trees))
    scatter.add(name, list, true, undefined, FOG_FAR);

  // ---------------------------------------------------------------- shore rock and sea cliffs
  const boulders: Placement[] = [];
  const pebbles: Placement[] = [];
  const cliffs: Placement[] = [];
  const STEP = 6.5;
  const DIRS: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let z = 6; z < 380; z += STEP) {
    for (let x = 6; x < 506; x += STEP) {
      // the built harbour (quay, ferry, boardwalk landing) and the viaduct's end tower are
      // masonry and steel, not coastline
      if ((z > 262 && x < 350) || Math.hypot(x - 452, z - 183) < 26) continue;
      const h = heightAt(x, z);
      if (h === null) continue;
      const around = DIRS.map(([dx, dz]) => heightAt(x + dx * STEP, z + dz * STEP));
      const seaward = DIRS.filter((_, i) => around[i] === null || around[i]! < -1.2);
      if (!seaward.length) continue;
      const [dx, dz] = seaward[Math.floor(rnd() * seaward.length)]!;
      const flatQuay =
        Math.abs(h) < 0.03 && around.every((a) => a === null || Math.abs(a) < 0.03 || a < -1);
      if (flatQuay) continue; // built quay walls stay clean
      if (h < 1.6) {
        // natural shoreline: a boulder half in the water, pebbles around it
        boulders.push({
          x: x + dx * (1.5 + rnd() * 2.5) + (rnd() - 0.5) * 3,
          y: Math.min(h, 0) - 0.5 - rnd() * 0.4,
          z: z + dz * (1.5 + rnd() * 2.5) + (rnd() - 0.5) * 3,
          yaw: spin(),
          scale: 1 + rnd() * 1.6,
          tiltX: (rnd() - 0.5) * 0.4,
          tiltZ: (rnd() - 0.5) * 0.4,
        });
        for (let i = 0; i < 2; i++) {
          pebbles.push({
            x: x + (rnd() - 0.5) * 6,
            y: Math.max(h, -0.6) - 0.05,
            z: z + (rnd() - 0.5) * 6,
            yaw: spin(),
            scale: 1.5 + rnd() * 2.5,
          });
        }
      } else if (h > 5) {
        // sea cliff: rock faces stacked up the drop, facing the water
        const yaw = Math.atan2(dx, dz);
        for (let y = -2; y < h - 1.5; y += 5.2) {
          cliffs.push({
            x: x + dx * (2.2 + rnd() * 1.2) + (rnd() - 0.5) * 2,
            y: y + rnd() * 1.2,
            z: z + dz * (2.2 + rnd() * 1.2) + (rnd() - 0.5) * 2,
            yaw: yaw + (rnd() - 0.5) * 0.5,
            scale: 1.25 + rnd() * 0.5,
            tiltX: (rnd() - 0.5) * 0.15,
          });
        }
        boulders.push({
          x: x + dx * (5 + rnd() * 3),
          y: -1.2 - rnd() * 0.5,
          z: z + dz * (5 + rnd() * 3),
          yaw: spin(),
          scale: 1.4 + rnd() * 2,
        });
      }
    }
  }

  // ---------------------------------------------------------------- the open hillside
  const tall: Placement[] = [];
  const low: Placement[] = [];
  const logs: Placement[] = [];
  const roots: Placement[] = [];
  for (let z = 104; z < 336; z += 3.4) {
    for (let x = 322; x < 474; x += 3.4) {
      const px = x + (rnd() - 0.5) * 3;
      const pz = z + (rnd() - 0.5) * 3;
      const roll = rnd();
      const h = heightAt(px, pz);
      if (h === null || h < 1.2) continue;
      const hx = heightAt(px + 1.5, pz);
      const hz = heightAt(px, pz + 1.5);
      if (hx === null || hz === null) continue;
      const slope = Math.max(Math.abs(hx - h), Math.abs(hz - h));
      // paved terraces and stairs are dead flat or stepped; natural ground rolls gently
      if (slope < 0.025 || slope > 1.1) continue;
      const near = spots.some((sp) => Math.hypot(sp.x - px, sp.z - pz) < 1.2);
      if (near) continue;
      if (roll < 0.2 && tall.length < 230)
        tall.push({ x: px, y: h - 0.04, z: pz, yaw: spin(), scale: 0.8 + rnd() * 0.7 });
      else if (roll < 0.62 && low.length < 460)
        low.push({ x: px, y: h - 0.02, z: pz, yaw: spin(), scale: 1 + rnd() * 1.4 });
      else if (roll > 0.992 && logs.length < 7)
        logs.push({ x: px, y: h, z: pz, yaw: spin(), scale: 0.9 + rnd() * 0.5 });
      else if (roll > 0.984 && roots.length < 7)
        roots.push({ x: px, y: h - 0.03, z: pz, yaw: spin(), scale: 1 + rnd() * 0.6 });
      else if (roll > 0.62 && roll < 0.76 && moss.length < 420)
        moss.push({ x: px, y: h - 0.01, z: pz, yaw: spin(), scale: 1.5 + rnd() * 2.5 });
      else if (roll > 0.955 && roll < 0.984) {
        // hillside outcrops reuse the pebble model
        pebbles.push({ x: px, y: h - 0.08, z: pz, yaw: spin(), scale: 2 + rnd() * 3 });
      }
    }
  }
  // the scans are dark desert rock; lift them towards the island's pale limestone
  scatter.add('boulder', boulders, true, STONE_TINT, FOG_FAR);
  scatter.add('rocks', pebbles, true, STONE_TINT, 260);
  scatter.add('cliff', cliffs, true, STONE_TINT, FOG_FAR);
  scatter.add('grass_tall', tall, false, undefined, 130);
  scatter.add('grass_low', low, false, undefined, 90);
  scatter.add('log', logs, true, undefined, 220);
  scatter.add('roots', roots, true, undefined, 160);
  const bedGeometry = bedParts.length ? mergeGeometries(bedParts, false) : null;
  bedParts.forEach((g) => g.dispose());
  if (bedGeometry) {
    const material = new THREE.MeshStandardMaterial({
      name: 'M_flora',
      vertexColors: true,
      roughness: 0.95,
    });
    applySurface(material);
    const bedsMesh = new THREE.Mesh(bedGeometry, material);
    bedsMesh.name = 'beds';
    bedsMesh.castShadow = bedsMesh.receiveShadow = true;
    scatter.root.add(bedsMesh);
  }
  const stone = stoneParts.length ? mergeGeometries(stoneParts, false) : null;
  stoneParts.forEach((g) => g.dispose());
  if (stone) {
    const material = new THREE.MeshStandardMaterial({
      name: 'M_stone',
      vertexColors: true,
      roughness: 0.85,
    });
    applySurface(material);
    const planters = new THREE.Mesh(stone, material);
    planters.name = 'planters';
    planters.castShadow = planters.receiveShadow = true;
    scatter.root.add(planters);
  }
  scatter.add('moss', moss, false, [1.9, 2.3, 1.4], 110); // the scan is very dark; lift it to a living green
  return solid;
}
