/**
 * Convert a Hunyuan 3D FBX export (static, embedded PBR textures) into a clean GLB — no Blender.
 *
 *   node tools/fbx-to-glb.mjs <in.fbx> [out.glb] [--prop] [--length <m>] [--name <NodeName>]
 *
 * - Parses geometry with three.js FBXLoader (textures stubbed), converts cm → m.
 * - Characters (default): auto-orients — tallest axis becomes +Y, feet (two leg clusters) at y=0,
 *   toes facing +Z, arm span along X.
 * - Props (--prop): keeps the FBX's own up axis and lays the longest horizontal side along X;
 *   --length scales that side to real-world metres (e.g. --length 9 for the tram).
 * - --name sets the root node name (use KIT_* so the game's AssetLibrary can place it).
 * - Extracts the embedded PNGs straight from the FBX and packs roughness (G) + metallic (B)
 *   into the glTF metallicRoughness texture.
 * - Welds duplicate vertices.
 */
import { readFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
};
const PROP = flag('--prop') === true;
const LENGTH = Number(flag('--length')) || 0;
const NAME = flag('--name') || 'Mesh_0';
const [IN, OUT = 'art/source/kit_hunyuan.glb'] = args;
if (!IN) {
  console.error('usage: node tools/fbx-to-glb.mjs <in.fbx> [out.glb]');
  process.exit(1);
}
const raw = readFileSync(IN);

// ---------------------------------------------------------------- geometry
THREE.TextureLoader.prototype.load = () => new THREE.Texture(); // no DOM in Node
const group = new FBXLoader().parse(
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  '',
);
group.updateMatrixWorld(true);
let mesh = null;
group.traverse((o) => {
  if (o.isMesh && !mesh) mesh = o;
});
if (!mesh) throw new Error('no mesh in FBX');
const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
geo.scale(0.01, 0.01, 0.01); // FBX centimetres → metres
const pos = geo.attributes.position;

const extent = () => {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  return { min: b.min.clone(), max: b.max.clone(), size: b.getSize(new THREE.Vector3()) };
};
let { size } = extent();
if (!PROP) {
  // 1) tallest axis → +Y
  if (size.z > size.y && size.z >= size.x) geo.rotateX(-Math.PI / 2);
  else if (size.x > size.y && size.x > size.z) geo.rotateZ(Math.PI / 2);
}
// 2) wider horizontal axis (arm span / vehicle length) → X
({ size } = extent());
if (size.z > size.x) geo.rotateY(Math.PI / 2);
if (LENGTH) {
  ({ size } = extent());
  const k = LENGTH / size.x;
  geo.scale(k, k, k);
}

/** Number of separated clusters along X in a thin slice at height fraction f. */
function clustersAt(f) {
  const { min, size: s } = extent();
  const y = min.y + f * s.y;
  const xs = [];
  for (let i = 0; i < pos.count; i++)
    if (Math.abs(pos.getY(i) - y) < s.y * 0.01) xs.push(pos.getX(i));
  xs.sort((a, b) => a - b);
  let n = xs.length ? 1 : 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > s.y * 0.02) n++;
  return n;
}
// 3) feet at the bottom: the leg end splits into two clusters, the head end does not
if (!PROP && clustersAt(0.9) >= 2 && clustersAt(0.15) < 2) geo.rotateX(Math.PI);
// 4) toes face +Z: the feet reach further from the body centre than the heels
if (!PROP) {
  const { min, size: s } = extent();
  let footZ = 0;
  let footN = 0;
  let bodyZ = 0;
  let bodyN = 0;
  for (let i = 0; i < pos.count; i++) {
    const f = (pos.getY(i) - min.y) / s.y;
    if (f < 0.03) {
      footZ += pos.getZ(i);
      footN++;
    } else if (f > 0.4 && f < 0.7) {
      bodyZ += pos.getZ(i);
      bodyN++;
    }
  }
  if (footN && bodyN && footZ / footN < bodyZ / bodyN) geo.rotateY(Math.PI);
}
// 5) feet on y=0, centred on X/Z
{
  const { min, max } = extent();
  geo.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
}
const final = extent();

// ---------------------------------------------------------------- textures from the FBX bytes
function embeddedPngs() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out = new Map();
  let i = 0;
  while ((i = raw.indexOf(sig, i)) >= 0) {
    // walk PNG chunks to IEND
    let p = i + 8;
    while (p < raw.length) {
      const len = raw.readUInt32BE(p);
      const type = raw.toString('latin1', p + 4, p + 8);
      p += 12 + len;
      if (type === 'IEND') break;
    }
    const before = raw.toString('latin1', Math.max(0, i - 600), i);
    const names = [...before.matchAll(/texture_pbr_[A-Za-z0-9_]*\.png/g)].map((m) => m[0]);
    const name = names[names.length - 1] ?? `image_${out.size}.png`;
    if (!out.has(name)) out.set(name, raw.subarray(i, p));
    i = p;
  }
  return out;
}
const pngs = embeddedPngs();
const pick = (re) => [...pngs.entries()].find(([n]) => re.test(n))?.[1];
const baseColor = pick(/texture_pbr_\d+\.png$/);
const normal = pick(/normal/);
const roughness = pick(/roughness/);
const metallic = pick(/metallic/);

let metalRough = null;
if (roughness || metallic) {
  const ref = await sharp(roughness ?? metallic).metadata();
  const w = ref.width;
  const h = ref.height;
  const chan = async (png, fill) =>
    png ? sharp(png).resize(w, h).greyscale().raw().toBuffer() : Buffer.alloc(w * h, fill);
  const [g, b] = await Promise.all([chan(roughness, 200), chan(metallic, 0)]);
  const rgb = Buffer.alloc(w * h * 3);
  for (let k = 0; k < w * h; k++) {
    rgb[k * 3] = 255;
    rgb[k * 3 + 1] = g[k];
    rgb[k * 3 + 2] = b[k];
  }
  metalRough = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------- write glTF
const doc = new Document();
const buffer = doc.createBuffer();
const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const prim = doc
  .createPrimitive()
  .setAttribute('POSITION', acc('VEC3', new Float32Array(geo.attributes.position.array)))
  .setAttribute('NORMAL', acc('VEC3', new Float32Array(geo.attributes.normal.array)));
if (geo.attributes.uv)
  prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(geo.attributes.uv.array)));
const tex = (name, png) =>
  png ? doc.createTexture(name).setImage(new Uint8Array(png)).setMimeType('image/png') : null;
// Hunyuan metallic maps read near-black without an environment map; keep a hint of sheen only.
const material = doc
  .createMaterial(NAME)
  .setRoughnessFactor(1)
  .setMetallicFactor(metalRough ? 0.15 : 0);
const bc = tex('baseColor', baseColor);
if (bc) material.setBaseColorTexture(bc);
const nm = tex('normal', normal);
if (nm) material.setNormalTexture(nm);
const mr = tex('metallicRoughness', metalRough);
if (mr) material.setMetallicRoughnessTexture(mr);
prim.setMaterial(material);
// Mesh on a child node: meshopt quantization stores its dequantize scale/offset on the mesh's
// node, and AssetLibrary resets the KIT_* root's transform when instancing.
const meshNode = doc.createNode(`${NAME}_mesh`).setMesh(doc.createMesh(NAME).addPrimitive(prim));
const node = doc.createNode(NAME).addChild(meshNode);
doc.createScene('Scene').addChild(node);
await doc.transform(weld());

await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(OUT, doc);
console.log(
  `converted ${IN.split('/').pop()} → ${OUT}: ${final.size.x.toFixed(3)} × ${final.size.y.toFixed(3)} × ${final.size.z.toFixed(3)} m, ` +
    `textures: ${[bc && 'baseColor', nm && 'normal', mr && 'metallicRoughness'].filter(Boolean).join(', ')} ` +
    `(found ${[...pngs.keys()].join(', ')})`,
);
