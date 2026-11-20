/** Print what a (rigged) FBX contains: meshes, bones, materials, textures, clips. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

globalThis.window ??= globalThis;
THREE.TextureLoader.prototype.load = (url) =>
  Object.assign(new THREE.Texture(), { userData: { url } });
const warn = console.warn;
console.warn = () => {};
for (const file of process.argv.slice(2)) {
  const raw = readFileSync(file);
  let g;
  try {
    g = new FBXLoader().parse(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      '',
    );
  } catch (e) {
    console.log(`${file.split('/').pop()}: FAILED ${e.message}`);
    continue;
  }
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  let bones = 0,
    tris = 0;
  const meshes = [],
    boneNames = [];
  g.traverse((o) => {
    if (o.isBone) {
      bones++;
      if (boneNames.length < 3) boneNames.push(o.name);
    }
    if (o.isMesh) {
      const n = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      tris += n;
      const mats = []
        .concat(o.material)
        .map(
          (m) =>
            `${m.name}${m.map ? '+map' : ''}${m.normalMap ? '+n' : ''}${m.transparent ? '+alpha' : ''}`,
        );
      meshes.push(
        `${o.name}${o.isSkinnedMesh ? '[skin]' : ''}(${Math.round(n / 1000)}k: ${mats.join(',')})`,
      );
    }
  });
  console.log(
    `${file.split('/').pop()}: ${size.x.toFixed(0)}×${size.y.toFixed(0)}×${size.z.toFixed(0)}, ${bones} bones (${boneNames.join(', ')}), ${Math.round(tris / 1000)}k tris, clips ${g.animations.map((a) => `${a.name}:${a.duration.toFixed(1)}s`).join(',') || 'none'}\n   ${meshes.join('\n   ')}`,
  );
}
console.warn = warn;
