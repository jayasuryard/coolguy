import type { WorldObject } from '@content/types';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CellSink } from '../story/CellStreamer';
import { rampTransform } from '../story/geometry';
import type { AssetLibrary } from './AssetLibrary';

const unitBox = new THREE.BoxGeometry(1, 1, 1);

/**
 * Render meshes for resident cells. Static pieces (blocks, ramps, kit models) are baked into one
 * merged mesh per material per cell, so a cell costs roughly one draw call per material no matter
 * how many kit pieces it holds. Pads and receivers stay separate because they animate.
 */
export class CellView implements CellSink {
  private readonly groups = new Map<string, THREE.Group>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly padMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x4fd1c5,
    emissiveIntensity: 0.6,
  });
  private readonly receiverMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd36b,
    emissive: 0xffb300,
    emissiveIntensity: 0.4,
  });
  /** Receiver meshes by id, so the presentation can pulse them on the beat. */
  readonly receivers = new Map<string, THREE.Mesh>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetLibrary | null,
  ) {}

  get pulseMaterial(): THREE.MeshStandardMaterial {
    return this.receiverMaterial;
  }

  loadCell(id: string, objects: WorldObject[]): void {
    const cell = new THREE.Group();
    cell.name = id;
    const statics = new THREE.Group();

    for (const o of objects) {
      if (o.kind === 'pad' || o.kind === 'receiver') {
        const m = this.markerFor(o);
        m.name = o.id;
        cell.add(m);
        if (o.kind === 'receiver') this.receivers.set(o.id, m);
        continue;
      }
      const node = this.staticFor(o);
      if (node) statics.add(node);
    }

    for (const merged of this.mergeByMaterial(statics)) cell.add(merged);
    this.scene.add(cell);
    this.groups.set(id, cell);
  }

  unloadCell(id: string): void {
    const g = this.groups.get(id);
    if (!g) return;
    this.scene.remove(g);
    g.traverse((o) => {
      if (this.receivers.get(o.name) === o) this.receivers.delete(o.name);
      // Merged geometry is owned by this cell; marker geometry is small and per-object.
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    this.groups.delete(id);
  }

  private material(color = '#999999'): THREE.MeshStandardMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      this.materials.set(color, m);
    }
    return m;
  }

  private staticFor(o: WorldObject): THREE.Object3D | null {
    switch (o.kind) {
      case 'block': {
        if (o.visual === false) return null;
        const m = new THREE.Mesh(unitBox, this.material(o.color));
        m.position.set(...o.center);
        m.scale.set(...o.size);
        return m;
      }
      case 'ramp': {
        if (o.visual === false) return null;
        const t = rampTransform(o);
        const m = new THREE.Mesh(unitBox, this.material(o.color));
        m.position.set(...t.center);
        m.quaternion.set(...t.rotation);
        m.scale.set(t.halfExtents[0] * 2, t.halfExtents[1] * 2, t.halfExtents[2] * 2);
        return m;
      }
      case 'model': {
        if (!this.assets) return null;
        const inst = this.assets.instance(o.model);
        inst.position.set(...o.position);
        inst.rotation.y = THREE.MathUtils.degToRad(o.rotationY ?? 0);
        return inst;
      }
      default:
        return null;
    }
  }

  private markerFor(o: WorldObject): THREE.Mesh {
    if (o.kind === 'pad') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 24), this.padMaterial);
      m.position.set(o.position[0], o.position[1] + 0.03, o.position[2]);
      m.receiveShadow = true;
      return m;
    }
    const pos = (o as { position: [number, number, number] }).position;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), this.receiverMaterial);
    m.position.set(...pos);
    return m;
  }

  /** Bake every static mesh into world space and merge per material. */
  private mergeByMaterial(root: THREE.Group): THREE.Mesh[] {
    root.updateMatrixWorld(true);
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      const src = mesh.geometry;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.getAttribute('position').clone());
      const normal = src.getAttribute('normal');
      if (normal) g.setAttribute('normal', normal.clone());
      if (src.index) g.setIndex(src.index.clone());
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) g.dispose();
      flat.applyMatrix4(mesh.matrixWorld);
      if (!flat.getAttribute('normal')) flat.computeVertexNormals();
      const list = buckets.get(mat) ?? [];
      list.push(flat);
      buckets.set(mat, list);
    });

    const out: THREE.Mesh[] = [];
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      out.push(m);
    }
    return out;
  }
}
