/**
 * Convert a rigged FBX character (Mixamo and friends) to GLB, keeping skeleton and skin weights.
 * Pure JS: three.js FBXLoader for parsing, glTF-Transform for writing. No Blender, no binaries.
 *
 *   node tools/fbx-rig-to-glb.mjs <in.fbx> <out.glb> [--tex 1024]
 *
 * - Bone names lose their `mixamorig…` prefix (`mixamorig8:LeftArm` → `LeftArm`) so one set of
 *   animation clips drives every character.
 * - Centimetres become metres through a 0.01 scale on the root node `Character`.
 * - Embedded textures are re-encoded (base colour as JPEG, or PNG when it carries alpha).
 * - Static (unskinned) meshes are kept as plain meshes.
 */
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const args = process.argv.slice(2);
const ti = args.indexOf('--tex');
const TEX = ti >= 0 ? Number(args.splice(ti, 2)[1]) : 1024;
const [IN, OUT] = args;
if (!IN || !OUT) {
  console.error('usage: node tools/fbx-rig-to-glb.mjs <in.fbx> <out.glb> [--tex 1024]');
  process.exit(1);
}

// ---------------------------------------------------------------- parse
globalThis.window ??= globalThis;
THREE.TextureLoader.prototype.load = (url) =>
  Object.assign(new THREE.Texture(), { userData: { url } });
const warn = console.warn;
console.warn = () => {};
const raw = readFileSync(IN);
const group = new FBXLoader().parse(
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  '',
);
console.warn = warn;
group.updateMatrixWorld(true);

const cleanName = (n) => n.replace(/^mixamorig\d*:?/, '');

// ---------------------------------------------------------------- document
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');
const root = doc.createNode('Character').setScale([0.01, 0.01, 0.01]);
scene.addChild(root);
const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

// bones → nodes (only bones that some skin uses, plus their bone ancestors)
const used = new Set();
group.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  for (let b of o.skeleton.bones) {
    while (b && b.isBone && !used.has(b)) {
      used.add(b);
      b = b.parent;
    }
  }
});
const boneNode = new Map();
const seenNames = new Set();
for (const b of used) {
  let name = cleanName(b.name);
  if (seenNames.has(name)) name = `${name}_${boneNode.size}`;
  seenNames.add(name);
  boneNode.set(
    b,
    doc
      .createNode(name)
      .setTranslation(b.position.toArray())
      .setRotation(b.quaternion.toArray())
      .setScale(b.scale.toArray()),
  );
}
for (const [b, node] of boneNode) {
  const parent = boneNode.get(b.parent);
  if (parent) parent.addChild(node);
  else {
    // a skeleton root: carry its non-bone ancestors' transform on an armature node
    const arm = doc
      .createNode('Armature')
      .setMatrix(b.parent ? b.parent.matrixWorld.toArray() : new THREE.Matrix4().toArray());
    root.addChild(arm.addChild(node));
  }
}

// ---------------------------------------------------------------- textures & materials
const texCache = new Map();
async function texture(t, kind) {
  const url = t?.userData?.url;
  if (!url) return null;
  const key = `${url}|${kind}`;
  if (texCache.has(key)) return texCache.get(key);
  let out;
  try {
    const blob = resolveObjectURL(url);
    const input = Buffer.from(await blob.arrayBuffer());
    const img = sharp(input).resize(TEX, TEX, { fit: 'inside', withoutEnlargement: true });
    const meta = await sharp(input).metadata();
    const alpha = kind === 'color' && meta.hasAlpha && !(await sharp(input).stats()).isOpaque;
    const bytes =
      alpha || kind === 'normal'
        ? await img.png().toBuffer()
        : await img.jpeg({ quality: 88 }).toBuffer();
    out = {
      tex: doc
        .createTexture(`${kind}_${texCache.size}`)
        .setImage(new Uint8Array(bytes))
        .setMimeType(alpha || kind === 'normal' ? 'image/png' : 'image/jpeg'),
      alpha,
    };
  } catch {
    out = null; // unsupported image (e.g. TGA) or texture not embedded
  }
  texCache.set(key, out);
  return out;
}
const matCache = new Map();
async function material(m) {
  if (matCache.has(m)) return matCache.get(m);
  const out = doc
    .createMaterial(m.name || 'Material')
    .setRoughnessFactor(0.85)
    .setMetallicFactor(0);
  const color = await texture(m.map, 'color');
  if (color) {
    out.setBaseColorTexture(color.tex);
    // hair cards / eyelashes: cut-out, not sorted blending
    if (color.alpha) out.setAlphaMode('MASK').setAlphaCutoff(0.4).setDoubleSided(true);
  } else if (m.color) out.setBaseColorFactor([...m.color.toArray(), 1]);
  const normal = await texture(m.normalMap, 'normal');
  if (normal) out.setNormalTexture(normal.tex);
  matCache.set(m, out);
  return out;
}

/** FBX puts v=0 at the bottom of the image, glTF at the top. */
const flipV = (uv) => Float32Array.from(uv, (x, i) => (i % 2 ? 1 - x : x));

// ---------------------------------------------------------------- meshes
const meshes = [];
group.traverse((o) => o.isMesh && meshes.push(o));
let tris = 0;
for (const o of meshes) {
  const g = o.geometry;
  const pos = g.attributes.position;
  const count = pos.count;
  const mats = [].concat(o.material);
  const groups = g.groups.length
    ? g.groups
    : [{ start: 0, count: g.index ? g.index.count : count, materialIndex: 0 }];
  const mesh = doc.createMesh(o.name);
  const base = {
    POSITION: acc('VEC3', new Float32Array(pos.array)),
    NORMAL: g.attributes.normal && acc('VEC3', new Float32Array(g.attributes.normal.array)),
    TEXCOORD_0: g.attributes.uv && acc('VEC2', flipV(g.attributes.uv.array)),
  };
  if (o.isSkinnedMesh) {
    const w = new Float32Array(g.attributes.skinWeight.array);
    for (let i = 0; i < w.length; i += 4) {
      const s = w[i] + w[i + 1] + w[i + 2] + w[i + 3] || 1;
      for (let k = 0; k < 4; k++) w[i + k] /= s;
    }
    base.JOINTS_0 = acc('VEC4', new Uint16Array(g.attributes.skinIndex.array));
    base.WEIGHTS_0 = acc('VEC4', w);
  }
  for (const grp of groups) {
    const idx = new Uint32Array(grp.count);
    for (let i = 0; i < grp.count; i++)
      idx[i] = g.index ? g.index.getX(grp.start + i) : grp.start + i;
    const prim = doc.createPrimitive().setIndices(acc('SCALAR', idx));
    for (const [k, a] of Object.entries(base)) if (a) prim.setAttribute(k, a);
    prim.setMaterial(await material(mats[grp.materialIndex ?? 0] ?? mats[0]));
    mesh.addPrimitive(prim);
    tris += grp.count / 3;
  }
  const node = doc.createNode(o.name).setMesh(mesh);
  if (o.isSkinnedMesh) {
    const ibm = new Float32Array(o.skeleton.bones.length * 16);
    const m = new THREE.Matrix4();
    const skin = doc.createSkin(o.name);
    o.skeleton.bones.forEach((b, j) => {
      m.multiplyMatrices(o.skeleton.boneInverses[j], o.bindMatrix).toArray(ibm, j * 16);
      skin.addJoint(boneNode.get(b));
    });
    skin.setInverseBindMatrices(acc('MAT4', ibm));
    node.setSkin(skin);
  } else node.setMatrix(o.matrixWorld.toArray());
  root.addChild(node);
}

await doc.transform(weld());
await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(OUT, doc);
const box = new THREE.Box3().setFromObject(group);
console.log(
  `${IN.split('/').pop()} → ${OUT}: ${meshes.length} meshes, ${Math.round(tris / 1000)}k tris, ${boneNode.size} bones, ` +
    `${[...texCache.values()].filter(Boolean).length} textures, ${(box.max.y - box.min.y).toFixed(0)} cm tall`,
);
