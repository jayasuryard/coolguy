/**
 * Dev model viewer: /viewer.html?src=<url> renders front / side / top views of a GLB with its
 * bounds, so exports can be checked for orientation and scale. Not part of the production build.
 */
import * as THREE from 'three';
import { gltfLoader } from '../presentation/loader';

const src = new URLSearchParams(location.search).get('src') ?? '/assets/models/kit.glb';
const info = document.getElementById('info')!;
const host = document.getElementById('views')!;

const gltf = await gltfLoader().loadAsync(src);
const model = gltf.scene;
const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3());
const centre = box.getCenter(new THREE.Vector3());
info.textContent = `${src} · ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} m · clips: ${gltf.animations.map((a) => a.name).join(', ') || 'none'}`;

const scene = new THREE.Scene();
scene.add(model, new THREE.HemisphereLight(0xffffff, 0x445544, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(2, 4, 3);
scene.add(sun, new THREE.AxesHelper(Math.max(size.x, size.y, size.z) * 0.6));
const r = Math.max(size.x, size.y, size.z) * 0.75;
const views: Array<[string, THREE.Vector3, THREE.Vector3]> = [
  ['front (+Z)', new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  ['side (+X)', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  ['top (+Y)', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)],
];
for (const [label, dir, up] of views) {
  const cell = document.createElement('div');
  cell.style.position = 'relative';
  const tag = document.createElement('span');
  tag.className = 'label';
  tag.textContent = label;
  cell.append(tag);
  host.append(cell);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(cell.clientWidth, cell.clientHeight);
  cell.append(renderer.domElement);
  const aspect = cell.clientWidth / cell.clientHeight;
  const cam = new THREE.OrthographicCamera(-r * aspect, r * aspect, r, -r, 0.01, 100);
  cam.position.copy(centre).addScaledVector(dir, 10);
  cam.up.copy(up);
  cam.lookAt(centre);
  renderer.render(scene, cam);
}
