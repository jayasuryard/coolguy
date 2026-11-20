/**
 * Author Seaglass Cove: the first district beyond Old Bellweather, reached by a boardwalk
 * from the east end of Punch Quay. Deterministic — rerun to regenerate the sheet.
 *
 *   node tools/districts/seaglass.mjs   →   content/world/districts/seaglass.json
 *
 * Layout (world metres, x east, z south): a sand cove facing the bay, a paved promenade behind
 * it, two rows of townhouses on the sea-level terrace and three on the terrace above, a small
 * marina with finger piers to the west, a lighthouse on the east headland.
 */
import { writeFileSync } from 'node:fs';

const G = 2.6; // promenade / quay level
const UP = G + 3.3; // upper terrace: one storey higher, so window rows line up across the town

let seed = 20261120;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (a, b) => a + rnd() * (b - a);
const r1 = (x) => Math.round(x * 10) / 10;

const WALLS = [
  '#e8c9a0',
  '#e3b98a',
  '#d9a679',
  '#f0dcc0',
  '#e6b0a0',
  '#d7c7a4',
  '#cdd6c2',
  '#f2e6d0',
  '#e0a070',
  '#c9b8d0',
];
const ROOFS = ['#c4603c', '#b9552f', '#cf6d45', '#a94e30'];
const AWNINGS = ['#c8412f', '#2f7f86', '#e0b24a', '#3d6fb0', '#f0e6d0'];
const BOATS = ['#f0ead8', '#2f7f86', '#c8412f', '#e0b24a', '#34506e'];

const lands = [];
const buildings = [];
const props = [];

// ---------------------------------------------------------------- ground
const beachBack = [
  [690, 2],
  [715, -8],
  [756, -12],
  [797, -8],
  [822, 2],
];
lands.push({
  id: 'cove.town',
  surface: 'paving',
  y: G,
  outline: [
    [588, 112],
    [588, -150],
    [950, -150],
    [950, 58],
    [905, 78],
    [868, 48],
    [838, 12],
    ...[...beachBack].reverse(),
    [668, 36],
    [650, 84],
    [630, 112],
  ],
});
lands.push({
  id: 'cove.terrace',
  surface: 'plaza',
  y: UP,
  skirt: 3.6,
  outline: [
    [588, -72],
    [950, -72],
    [950, -150],
    [588, -150],
  ],
});
lands.push({
  id: 'cove.beach',
  surface: 'sand',
  y: G,
  skirt: 2,
  outline: [
    ...beachBack.map(([x, z]) => [x, z, G]),
    [838, 12, G],
    [850, 42, -2.6],
    [812, 64, -2.6],
    [756, 72, -2.6],
    [700, 64, -2.6],
    [662, 42, -2.6],
    [668, 36, G],
  ],
});
/** Rough sand height at a point on the beach (for dressing it). */
const beachY = (z) => G - (5.2 * Math.min(71, Math.max(0, z + 5))) / 71;

// stair streets up to the terrace
const STREETS = [661, 766, 871];
for (const x of STREETS) {
  lands.push({
    id: `cove.stairs.${x}`,
    surface: 'stone',
    y: G,
    skirt: 0.5,
    outline: [
      [x - 4, -59, G],
      [x + 4, -59, G],
      [x + 4, -73, UP],
      [x - 4, -73, UP],
    ],
  });
}
// a pocket park on the terrace
lands.push({
  id: 'cove.park',
  surface: 'grass',
  y: UP + 0.06,
  skirt: 0.1,
  outline: [
    [775, -100],
    [860, -100],
    [860, -128],
    [775, -128],
  ],
});

// ---------------------------------------------------------------- boardwalk from Punch Quay
/** A deck of the given width along a polyline; each point is [x, z, y]. */
function strip(id, points, width, surface, skirt) {
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az, ay] = points[i];
    const [bx, bz, by] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const nx = (-(bz - az) / len) * (width / 2);
    const nz = ((bx - ax) / len) * (width / 2);
    // Flat pieces run long at flat corners so bends overlap. A sloped piece ends exactly on
    // its points — otherwise the next deck's end face sticks up out of the ramp as a lip.
    const flat = (k) => k >= 0 && k < points.length - 1 && points[k][2] === points[k + 1][2];
    const e0 = flat(i) && flat(i - 1) ? width / 2 : 0;
    const e1 = flat(i) && flat(i + 1) ? width / 2 : 0;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    lands.push({
      id: `${id}.${i}`,
      surface,
      y: ay,
      skirt,
      outline: [
        [r1(ax - dx * e0 + nx), r1(az - dz * e0 + nz), ay],
        [r1(bx + dx * e1 + nx), r1(bz + dz * e1 + nz), by],
        [r1(bx + dx * e1 - nx), r1(bz + dz * e1 - nz), by],
        [r1(ax - dx * e0 - nx), r1(az - dz * e0 - nz), ay],
      ],
    });
  }
}
const WALK = [
  [321, 308, 0.05],
  [338, 308, G],
  [472, 308, G],
  [502, 240, G],
  [540, 152, G],
  [592, 106, G],
];
strip('cove.boardwalk', WALK, 6, 'planks', 0.35);
for (let i = 1; i < WALK.length - 1; i++) {
  const [ax, az] = WALK[i];
  const [bx, bz] = WALK[i + 1];
  const len = Math.hypot(bx - ax, bz - az);
  const nx = -(bz - az) / len;
  const nz = (bx - ax) / len;
  // handrails down both sides (they also keep Kit on the deck)
  for (const side of [-1, 1]) {
    props.push({
      prop: 'rail',
      position: [r1((ax + bx) / 2 + nx * 2.85 * side), G, r1((az + bz) / 2 + nz * 2.85 * side)],
      rotationY: r1((-Math.atan2(bz - az, bx - ax) * 180) / Math.PI),
      length: r1(len - (i === WALK.length - 2 ? 8 : 1)),
    });
  }
  for (let d = 0; d < len; d += 9) {
    const x = ax + ((bx - ax) * d) / len;
    const z = az + ((bz - az) * d) / len;
    for (const side of [-1, 1]) {
      props.push({
        prop: 'post',
        position: [r1(x + nx * 3.15 * side), -3, r1(z + nz * 3.15 * side)],
        scale: 1,
      });
    }
    if (Math.round(d / 9) % 4 === 1)
      props.push({ prop: 'lamp', position: [r1(x + nx * 2.6), G, r1(z + nz * 2.6)] });
  }
}

// ---------------------------------------------------------------- marina
for (const [i, x] of [602, 620, 638].entries()) {
  strip(
    `cove.pier.${i}`,
    [
      [x, 110, G],
      [x, 120, 1.1],
      [x, 162, 1.1],
    ],
    3.6,
    'planks',
    0.3,
  );
  for (let z = 126; z < 160; z += 11) {
    for (const side of [-1, 1]) {
      props.push({ prop: 'post', position: [x + 1.9 * side, -3.6, z + 5], scale: 0.8 });
      if (rnd() < 0.75) {
        props.push({
          prop: 'boat',
          position: [x + 4.6 * side, -1.5, z],
          rotationY: side > 0 ? 90 : -90,
          scale: between(0.85, 1.2),
          color: pick(BOATS),
        });
      }
    }
  }
}
for (const [x, z, a] of [
  [716, 112, 20],
  [792, 124, -35],
  [858, 104, 60],
  [680, 150, 110],
]) {
  props.push({
    prop: 'sailboat',
    position: [x, -1.5, z],
    rotationY: a,
    scale: between(1, 1.3),
    color: pick(BOATS),
  });
}
buildings.push({
  position: [606, G, 84],
  size: [10, 4.4, 8],
  rotationY: 90,
  roof: 'flat',
  wall: '#f0dcc0',
  awning: '#2f7f86',
});

// ---------------------------------------------------------------- townhouses
function row({ z, depth, y, floors, front, awnings }) {
  let x = 597;
  while (x < 944) {
    const street = STREETS.find((s) => x < s + 5 && x + 11 > s - 5);
    if (street) {
      x = street + 5;
      continue;
    }
    const next = STREETS.find((s) => s - 5 > x) ?? 946;
    const w = Math.min(Math.round(between(11, 19)), next - 5 - x);
    if (w < 7) {
      x = next + 5;
      continue;
    }
    const f = Math.round(between(floors[0], floors[1]));
    buildings.push({
      position: [r1(x + w / 2), y, z],
      size: [w - 0.3, r1(f * 3.3 + 0.5), r1(depth + between(-1.5, 1.5))],
      rotationY: front,
      roof: rnd() < 0.82 ? 'hip' : 'flat',
      wall: pick(WALLS),
      roofColor: pick(ROOFS),
      ...(awnings && rnd() < 0.72 ? { awning: pick(AWNINGS) } : {}),
    });
    x += w;
  }
}
row({ z: -35, depth: 17, y: G, floors: [3, 5], front: 0, awnings: true });
row({ z: -60, depth: 12, y: G, floors: [3, 4], front: 180, awnings: false });
row({ z: -90, depth: 15, y: UP, floors: [3, 5], front: 0, awnings: true });
row({ z: -115, depth: 13, y: UP, floors: [2, 4], front: 180, awnings: false });
row({ z: -140, depth: 13, y: UP, floors: [3, 6], front: 0, awnings: false });
// keep the pocket park open
for (let i = buildings.length - 1; i >= 0; i--) {
  const [x, , z] = buildings[i].position;
  if (x > 770 && x < 865 && z < -100 && z > -128) buildings.splice(i, 1);
}

// landmarks
buildings.push({
  position: [632, G, 30],
  size: [9, 3.6, 9],
  roof: 'dome',
  wall: '#f2e6d0',
  roofColor: '#4f9a8f',
}); // bandstand
buildings.push({
  position: [918, G, 52],
  size: [5.4, 17, 5.4],
  roof: 'dome',
  wall: '#f4efe4',
  roofColor: '#c8412f',
}); // lighthouse
props.push({ prop: 'lamp', position: [918, G + 19.2, 52], scale: 2.4 });

// ---------------------------------------------------------------- dressing
for (let x = 600; x <= 940; x += 13) {
  if (STREETS.some((s) => Math.abs(s - x) < 6)) continue;
  props.push({
    prop: 'palm',
    position: [x, G, r1(-18 + between(-1, 1))],
    rotationY: Math.round(between(0, 360)),
    scale: r1(between(0.9, 1.25)),
  });
}
for (let x = 611; x <= 940; x += 22) props.push({ prop: 'lamp', position: [x, G, -22] });
for (let x = 700; x <= 815; x += 23)
  props.push({ prop: 'bench', position: [x, G, -14.5], rotationY: 0 });
for (let i = 0; i < 16; i++) {
  const x = between(700, 815);
  const z = between(4, 40);
  props.push({
    prop: 'parasol',
    position: [r1(x), r1(beachY(z)), r1(z)],
    rotationY: Math.round(between(0, 360)),
    color: pick(AWNINGS),
  });
}
for (let i = 0; i < 9; i++) {
  props.push({
    prop: 'tree',
    position: [r1(between(780, 856)), UP, r1(between(-125, -103))],
    scale: r1(between(0.8, 1.3)),
  });
}
for (const x of STREETS) {
  for (const z of [-80, -104, -128])
    props.push({ prop: 'tree', position: [x + 6.5, UP, z + 9], scale: 0.8 });
}
for (let i = 0; i < 26; i++) {
  const a = between(-0.4, 1.9);
  props.push({
    prop: 'rock',
    position: [
      r1(930 + Math.cos(a) * between(14, 30)),
      -1.8,
      r1(62 + Math.sin(a) * between(10, 26)),
    ],
    scale: r1(between(1.2, 3.2)),
    rotationY: Math.round(between(0, 360)),
  });
}
for (let i = 0; i < 14; i++) {
  props.push({
    prop: 'rock',
    position: [r1(between(566, 590)), -1.6, r1(between(-40, 104))],
    scale: r1(between(1.5, 3.5)),
    rotationY: Math.round(between(0, 360)),
  });
}

const sheet = { id: 'cove', name: 'Seaglass Cove', lands, buildings, props };
writeFileSync('content/world/districts/seaglass.json', JSON.stringify(sheet, null, 1) + '\n');
console.log(
  `Seaglass Cove: ${lands.length} lands, ${buildings.length} buildings, ${props.length} props`,
);
