/**
 * Download nature models from Poly Haven (polyhaven.com, licence CC0) and reduce them to
 * something a browser can draw hundreds of: trees, rocks, cliff pieces, grass.
 *
 *   NODE_USE_ENV_PROXY=1 node tools/fetch-scatter.mjs [name …]
 *
 * Sources: art/source/scatter/<id>/ (git-ignored). Output: game/public/assets/models/scatter/<name>.glb
 *
 * Reduction, per mesh:
 *  - foliage (anything with a leaf/grass alpha map) is thousands of loose cards that ordinary
 *    simplification cannot merge, so cards are dropped at random and the survivors enlarged
 *    to keep the crown's volume;
 *  - everything else (trunks, rock) is simplified by edge collapse.
 * The model is then scaled to a real-world height and stood on y = 0.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  compactPrimitive,
  dedup,
  flatten,
  getBounds,
  join,
  prune,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/** name → { id, height (m), tris: target for solid parts, cards: target for foliage, tex } */
const ASSETS = {
  tree_island: { id: 'island_tree_02', height: 6.5, tris: 2500, cards: 20000, tex: 1024 },
  tree_jacaranda: { id: 'jacaranda_tree', height: 8.5, tris: 3000, cards: 22000, tex: 1024 },
  tree_small: { id: 'tree_small_02', height: 4.2, tris: 2000, cards: 16000, tex: 1024 },
  boulder: { id: 'namaqualand_boulder_02', height: 1.3, tris: 2400, cards: 0, tex: 1024 },
  rocks: { id: 'namaqualand_rocks_01', height: 0.4, tris: 1500, cards: 0, tex: 512 },
  cliff: { id: 'namaqualand_cliff_01', height: 4.4, tris: 3200, cards: 0, tex: 1024 },
  grass_tall: { id: 'grass_medium_01', height: 0.6, tris: 0, cards: 2600, tex: 512 },
  grass_low: { id: 'grass_bermuda_01', height: 0.28, tris: 0, cards: 941, tex: 512 },
  log: { id: 'dead_tree_trunk', height: 0.32, tris: 1200, cards: 0, tex: 512 },
  roots: { id: 'pine_roots', height: 0.2, tris: 1400, cards: 0, tex: 512 },
  fir: { id: 'fir_sapling_medium', height: 4.5, tris: 1800, cards: 11000, tex: 1024 },
  celandine: { id: 'celandine_01', height: 0.32, tris: 900, cards: 2400, tex: 512 },
  periwinkle: { id: 'periwinkle_plant', height: 0.34, tris: 900, cards: 2400, tex: 512 },
  heliophila: { id: 'flower_heliophila', height: 0.5, tris: 900, cards: 2400, tex: 512 },
  moss: { id: 'moss_01', height: 0.09, tris: 900, cards: 1500, tex: 512 },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const get = async (url, dest) => {
  if (existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
};

/** Drop loose cards at random, enlarging the ones kept. Returns the new triangle count. */
function thinCards(prim, target) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const tris = idx.getCount() / 3;
  if (tris <= target) return tris;
  const n = pos.getCount();
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const ia = idx.getArray();
  for (let t = 0; t < ia.length; t += 3) {
    parent[find(ia[t])] = find(ia[t + 1]);
    parent[find(ia[t + 1])] = find(ia[t + 2]);
  }
  const keepEvery = tris / target;
  // area kept constant: fewer leaves, each larger (capped so a leaf never becomes a sail)
  const scale = Math.min(8, Math.sqrt(keepEvery));
  // decide per card (connected piece), by a hash of its root so the choice is stable
  const keep = new Map();
  let seen = 0;
  const roots = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = (roots[i] = find(i));
    if (!keep.has(r))
      keep.set(
        r,
        Math.floor(seen++ / keepEvery) !== Math.floor((seen - 2) / keepEvery) || seen === 1,
      );
  }
  // centroids of kept cards, then scale their vertices about them
  const sum = new Map();
  const v = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!keep.get(roots[i])) continue;
    pos.getElement(i, v);
    const s = sum.get(roots[i]) ?? [0, 0, 0, 0];
    s[0] += v[0];
    s[1] += v[1];
    s[2] += v[2];
    s[3]++;
    sum.set(roots[i], s);
  }
  const arr = pos.getArray().slice();
  for (let i = 0; i < n; i++) {
    const s = sum.get(roots[i]);
    if (!s) continue;
    for (let k = 0; k < 3; k++) {
      const c = s[k] / s[3];
      arr[i * 3 + k] = c + (arr[i * 3 + k] - c) * scale;
    }
  }
  pos.setArray(arr);
  const out = [];
  for (let t = 0; t < ia.length; t += 3)
    if (keep.get(roots[ia[t]])) out.push(ia[t], ia[t + 1], ia[t + 2]);
  idx.setArray(new Uint32Array(out));
  return out.length / 3;
}

const only = process.argv.slice(2);
mkdirSync('game/public/assets/models/scatter', { recursive: true });
await MeshoptSimplifier.ready;
for (const [name, a] of Object.entries(ASSETS)) {
  if (only.length && !only.includes(name)) continue;
  const dir = `art/source/scatter/${a.id}`;
  const files = await (await fetch(`https://api.polyhaven.com/files/${a.id}`)).json();
  const pack = files.gltf['1k'].gltf;
  await get(pack.url, `${dir}/${a.id}.gltf`);
  for (const [path, f] of Object.entries(pack.include)) await get(f.url, `${dir}/${path}`);
  const alphaKeys = Object.keys(files).filter((k) => /alpha/i.test(k));
  const alphas = {};
  for (const k of alphaKeys) {
    const f = files[k]['1k'].png ?? files[k]['1k'].jpg;
    const dest = `${dir}/alpha/${k}.${f.url.split('.').pop()}`;
    await get(f.url, dest);
    alphas[k.replace(/_?alpha/i, '').toLowerCase()] = dest; // '' or e.g. 'leaves'
  }

  const doc = await io.read(`${dir}/${a.id}.gltf`);
  // one mesh per material, so a model costs a draw call or two however it was built
  await doc.transform(dedup(), flatten(), join(), weld());

  // which materials are foliage: the one(s) an alpha map belongs to
  const foliage = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    const tex = m.getBaseColorTexture();
    if (!tex) continue;
    const label = `${m.getName()} ${tex.getName()} ${tex.getURI()}`.toLowerCase();
    const key = Object.keys(alphas).find((k) => (k === '' ? true : label.includes(k)));
    if (key === undefined) continue;
    // bake the alpha into the colour map's alpha channel
    const size = tex.getSize() ?? [1024, 1024];
    const rgb = await sharp(Buffer.from(tex.getImage()))
      .resize(size[0], size[1])
      .removeAlpha()
      .raw()
      .toBuffer();
    const al = await sharp(alphas[key]).resize(size[0], size[1]).greyscale().raw().toBuffer();
    const rgba = Buffer.alloc(size[0] * size[1] * 4);
    for (let i = 0; i < size[0] * size[1]; i++) {
      rgba[i * 4] = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = al[i];
    }
    tex
      .setImage(
        new Uint8Array(
          await sharp(rgba, { raw: { width: size[0], height: size[1], channels: 4 } })
            .png()
            .toBuffer(),
        ),
      )
      .setMimeType('image/png');
    m.setAlphaMode('MASK').setAlphaCutoff(0.42).setDoubleSided(true);
    foliage.add(m);
  }

  // reduce
  const prims = doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives());
  const leafPrims = prims.filter((p) => foliage.has(p.getMaterial()));
  const solidPrims = prims.filter((p) => !foliage.has(p.getMaterial()));
  const leafTotal = leafPrims.reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  let cards = 0;
  for (const p of leafPrims) {
    cards += thinCards(
      p,
      Math.max(40, Math.round((a.cards * (p.getIndices().getCount() / 3)) / leafTotal)),
    );
  }
  const solidTotal = solidPrims.reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  if (solidTotal > a.tris && a.tris > 0) {
    // edge-collapse each solid part towards its share of the budget
    for (const p of solidPrims) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      const share = Math.max(60, Math.round((a.tris * (idx.getCount() / 3)) / solidTotal));
      const [reduced] = MeshoptSimplifier.simplify(
        new Uint32Array(idx.getArray()),
        new Float32Array(pos.getArray()),
        3,
        share * 3,
        0.12,
      );
      idx.setArray(new Uint32Array(reduced));
    }
  } else if (a.tris === 0) {
    for (const p of solidPrims) p.dispose(); // grass packs: keep only the blades
  }

  // drop the vertices nothing points at any more
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) compactPrimitive(p);

  // stand it on the ground at real height
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const k = a.height / (max[1] - min[1]);
  const fit = doc
    .createNode('fit')
    .setScale([k, k, k])
    .setTranslation([(-(min[0] + max[0]) / 2) * k, -min[1] * k, (-(min[2] + max[2]) / 2) * k]);
  for (const child of scene.listChildren()) fit.addChild(child);
  scene.addChild(doc.createNode(name).addChild(fit));

  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [a.tex, a.tex], quality: 84 }),
  );
  const tmp = `${dir}/reduced.glb`;
  await io.write(tmp, doc);
  const out = `game/public/assets/models/scatter/${name}.glb`;
  execFileSync('npx', ['gltf-transform', 'meshopt', tmp, out], { stdio: 'ignore' });
  const solid = doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .filter((p) => !foliage.has(p.getMaterial()))
    .reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  console.log(
    `${name}: ${a.id} — ${Math.round(solidTotal + leafTotal).toLocaleString()} → ${Math.round(solid + cards).toLocaleString()} triangles (${Math.round(cards)} foliage)`,
  );
}
