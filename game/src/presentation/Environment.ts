import * as THREE from 'three';

// Late-afternoon Bellweather: warm haze at the horizon, clear blue overhead (Art Direction plates).
const HORIZON = new THREE.Color(0xf6cf9c);
const ZENITH = new THREE.Color(0x3f7fd0);

/** Sky dome, fog, sun with a shadow frustum that follows Kit, and the harbour water. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private readonly sunOffset = new THREE.Vector3(-55, 48, 40); // low sun from the sea side (south-west)

  constructor(
    scene: THREE.Scene,
    waterLevel: number | null,
    envelope: { width: number; depth: number },
  ) {
    scene.background = HORIZON.clone();
    // The island city is meant to be seen across the harbour, so fog only softens the far sea.
    scene.fog = new THREE.Fog(
      HORIZON.clone(),
      waterLevel === null ? 90 : 220,
      waterLevel === null ? 260 : 900,
    );
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8a6a4c, 1.0)); // cool sky, warm stone bounce

    this.sun = new THREE.DirectionalLight(0xffd6a0, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -40;
    s.right = s.top = 40;
    s.near = 1;
    s.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { horizon: { value: HORIZON }, zenith: { value: ZENITH } },
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
            gl_FragColor = vec4(mix(horizon, zenith, pow(clamp(vDir.y, 0.0, 1.0), 0.55)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.scale.setScalar(1500);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    // Harbour south of Punch Quay.
    const all = waterLevel !== null;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(all ? 4000 : envelope.width + 800, all ? 4000 : 600).rotateX(
        -Math.PI / 2,
      ),
      new THREE.MeshStandardMaterial({ color: 0x2f7d8c, roughness: 0.12, metalness: 0.25 }),
    );
    if (all) water.position.set(envelope.width / 2, waterLevel, envelope.depth / 2);
    else water.position.set(envelope.width / 2, -0.6, envelope.depth + 300);
    water.receiveShadow = true;
    scene.add(water);
  }

  update(focus: THREE.Vector3, camera: THREE.Camera): void {
    this.sun.position.copy(focus).add(this.sunOffset);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(camera.position);
  }
}
