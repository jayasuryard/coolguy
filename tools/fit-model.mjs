/**
 * Fit a generated GLB (Hunyuan3D / TRELLIS output) for the game: stand it on y=0, centre it,
 * scale it to a real-world height, and wrap it in a `KIT_*` root the AssetLibrary can place.
 *
 *   node tools/fit-model.mjs <in.glb> <out.glb> --name KIT_x --height 1.7 [--turn 180]
 *
 * The mesh stays on child nodes: the game resets the KIT_* root's transform when instancing,
 * and meshopt stores its dequantisation transform on the mesh's own node.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  return args.splice(i, 2)[1];
};
const NAME = opt('--name', 'KIT_model');
const HEIGHT = Number(opt('--height', 1));
const TURN = (Number(opt('--turn', 0)) * Math.PI) / 180;
const [IN, OUT] = args;
if (!IN || !OUT) {
  console.error('usage: node tools/fit-model.mjs <in.glb> <out.glb> --name KIT_x --height <m>');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
const { min, max } = getBounds(scene);
const k = HEIGHT / (max[1] - min[1]);
const cx = (min[0] + max[0]) / 2;
const cz = (min[2] + max[2]) / 2;

// root (identity) → turn → fit (scale, then move feet to the origin) → original nodes
const fit = doc
  .createNode(`fit_${NAME}`)
  .setScale([k, k, k])
  .setTranslation([-cx * k, -min[1] * k, -cz * k]);
for (const child of scene.listChildren()) fit.addChild(child);
const turn = doc
  .createNode(`turn_${NAME}`)
  .setRotation([0, Math.sin(TURN / 2), 0, Math.cos(TURN / 2)])
  .addChild(fit);
scene.addChild(doc.createNode(NAME).addChild(turn));
for (const m of doc.getRoot().listMaterials()) m.setName(NAME);

await io.write(OUT, doc);
const size = [0, 1, 2].map((i) => ((max[i] - min[i]) * k).toFixed(2)).join(' × ');
console.log(`${NAME}: ${size} m → ${OUT}`);
