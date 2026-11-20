/**
 * Bake Mixamo animation FBX files ("without skin") into one compact JSON the game samples
 * directly: game/public/assets/anim/cast.json.
 *
 *   node tools/fbx-anim.mjs <dir-with-fbx>
 *
 * Per clip: bone rotations resampled at 30 fps (bone names without the `mixamorig` prefix),
 * the hips' vertical bob as a fraction of hip height, and `stride` = distance travelled per
 * loop in hip heights, so playback can be matched to ground speed. Root motion is dropped.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/** clip id → source file. Add rows here to bring more clips in. */
const CLIPS = {
  walk: 'Walking.fbx',
  walkF: 'gitl normal Walking.fbx',
  run: 'run.fbx',
};
const FPS = 30;
const DIR = process.argv[2];
if (!DIR) {
  console.error('usage: node tools/fbx-anim.mjs <dir-with-fbx>');
  process.exit(1);
}

globalThis.window ??= globalThis;
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const warn = console.warn;
console.warn = () => {};
const round = (x) => Math.round(x * 1e4) / 1e4;
const out = { fps: FPS, clips: {} };

for (const [id, file] of Object.entries(CLIPS)) {
  const raw = readFileSync(`${DIR}/${file}`);
  const group = new FBXLoader().parse(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    '',
  );
  const clip = group.animations.reduce((a, b) => (b.duration > a.duration ? b : a));
  const frames = Math.max(2, Math.round(clip.duration * FPS));
  const tracks = {};
  let hipsY = [];
  let stride = 0;
  for (const track of clip.tracks) {
    const [bone, prop] = track.name.split('.');
    const name = bone.replace(/^mixamorig\d*:?/, '');
    const interp = track.createInterpolant();
    const sample = (i) => Array.from(interp.evaluate((i / frames) * clip.duration));
    if (prop === 'quaternion') {
      const flat = [];
      let prev = null;
      for (let i = 0; i < frames; i++) {
        const q = sample(i);
        // keep neighbouring keys in the same hemisphere so blends take the short way round
        if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) {
          for (let k = 0; k < 4; k++) q[k] = -q[k];
        }
        prev = q;
        flat.push(...q.map(round));
      }
      tracks[name] = flat;
    } else if (prop === 'position' && name === 'Hips') {
      const ys = [];
      for (let i = 0; i < frames; i++) ys.push(sample(i)[1]);
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      hipsY = ys.map((y) => round((y - mean) / mean));
      const v = track.values;
      const n = v.length;
      stride = round(Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]) / mean);
    }
  }
  out.clips[id] = { duration: round(clip.duration), frames, stride, hipsY, tracks };
  console.log(
    `${id}: ${file} — ${clip.duration.toFixed(2)} s, ${frames} frames, ${Object.keys(tracks).length} bones, stride ${stride}`,
  );
}
console.warn = warn;
mkdirSync('game/public/assets/anim', { recursive: true });
const json = JSON.stringify(out);
writeFileSync('game/public/assets/anim/cast.json', json);
console.log(`→ game/public/assets/anim/cast.json (${(json.length / 1024).toFixed(0)} KB)`);
