import type RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';

/** FPS meter, live-tuning panel and Rapier collider wireframes. Toggle with the ` key. */
export class DebugTools {
  readonly gui = new GUI({ title: 'Debug  ( ` to toggle )' });
  private readonly stats = new Stats();
  private readonly physicsLines: THREE.LineSegments;
  showPhysics = false;

  constructor(
    scene: THREE.Scene,
    private readonly world: RAPIER.World,
  ) {
    document.body.appendChild(this.stats.dom);
    this.physicsLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
    );
    this.physicsLines.frustumCulled = false;
    this.physicsLines.renderOrder = 999;
    scene.add(this.physicsLines);

    if (!import.meta.env.DEV) this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.gui.show(v);
    this.stats.dom.style.display = v ? '' : 'none';
  }

  toggle(): void {
    this.setVisible(this.gui._hidden);
  }

  begin(): void {
    this.stats.begin();
  }

  end(): void {
    this.physicsLines.visible = this.showPhysics;
    if (this.showPhysics) {
      const { vertices, colors } = this.world.debugRender();
      const g = this.physicsLines.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    }
    this.stats.end();
  }
}
