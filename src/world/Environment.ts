import * as THREE from 'three';
import type { Config } from '../config';

const HORIZON = new THREE.Color(0xb9d4ea);
const ZENITH = new THREE.Color(0x3d7cc9);

/** Sky dome, fog, sun (with a shadow frustum that follows the player) and water plane. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private readonly water: THREE.Mesh;
  private readonly sunOffset = new THREE.Vector3(80, 120, 50);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly cfg: Config,
  ) {
    scene.background = HORIZON.clone();
    scene.fog = new THREE.Fog(HORIZON.clone(), 1, 1);
    this.updateFog();

    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 1.1));

    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -60;
    s.right = s.top = 60;
    s.near = 1;
    s.far = 400;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          horizon: { value: HORIZON },
          zenith: { value: ZENITH },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 horizon;
          uniform vec3 zenith;
          varying vec3 vDir;
          void main() {
            float t = pow(clamp(vDir.y, 0.0, 1.0), 0.55);
            gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.scale.setScalar(900);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x2a6f97,
        transparent: true,
        opacity: 0.82,
        roughness: 0.15,
        metalness: 0.1,
      }),
    );
    this.water.receiveShadow = true;
    scene.add(this.water);
  }

  /** Fog distance tracks view distance so chunk pop-in is hidden. */
  updateFog(): void {
    const far = this.cfg.chunk.viewDistance * this.cfg.chunk.size;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = far * 0.35;
    fog.far = far * 0.95;
  }

  update(focus: THREE.Vector3, camera: THREE.Camera): void {
    this.sun.position.copy(focus).add(this.sunOffset);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(camera.position);
    const snap = this.cfg.chunk.size;
    this.water.position.set(
      Math.round(focus.x / snap) * snap,
      this.cfg.terrain.seaLevel,
      Math.round(focus.z / snap) * snap,
    );
  }
}
