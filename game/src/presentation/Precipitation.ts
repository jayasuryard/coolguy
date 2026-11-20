import * as THREE from 'three';

const BOX = new THREE.Vector3(46, 26, 46);

/**
 * Rain and snow as a box of particles that travels with the camera. Each particle's position
 * wraps inside the box in the shader, so the fall never runs out and costs one draw call.
 */
export class Precipitation {
  readonly root = new THREE.Group();
  private readonly rain: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uRain: { value: 0 },
    uSnow: { value: 0 },
    uLight: { value: 1 },
  };

  constructor() {
    const wrap = /* glsl */ `
      uniform float uTime;
      uniform vec3 uCam;
      uniform vec3 uBox;
      vec3 fall(vec3 seed, vec3 velocity) {
        vec3 q = seed * uBox + velocity * uTime;
        return uCam + mod(q - uCam, uBox) - uBox * 0.5;
      }`;

    // rain: 5000 short streaks, two vertices each
    const N = 5000;
    const seed = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      seed.set(s, i * 6);
      seed.set(s, i * 6 + 3);
      end[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    rg.setAttribute('end', new THREE.BufferAttribute(end, 1));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `${wrap}
          attribute float end;
          varying float vEnd;
          void main() {
            vec3 v = vec3(2.2, -21.0, 0.8);
            vec3 p = fall(position, v) + normalize(v) * end * 0.55;
            vEnd = end;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uRain;
          uniform float uLight;
          varying float vEnd;
          void main() {
            gl_FragColor = vec4(vec3(0.75, 0.82, 0.9) * (0.25 + 0.75 * uLight), uRain * 0.42 * (1.0 - vEnd * 0.7));
          }`,
      }),
    );

    // snow: 3500 soft flakes drifting sideways as they fall
    const M = 3500;
    const flakes = new Float32Array(M * 3);
    for (let i = 0; i < M * 3; i++) flakes[i] = Math.random();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(flakes, 3));
    this.snow = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `${wrap}
          void main() {
            vec3 p = fall(position, vec3(0.5, -1.7, 0.2));
            p.x += sin(uTime * 0.8 + position.y * 40.0) * 0.5;
            p.z += cos(uTime * 0.6 + position.x * 40.0) * 0.5;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(110.0 / -mv.z, 1.5, 9.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uSnow;
          uniform float uLight;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * (0.3 + 0.7 * uLight), uSnow * smoothstep(0.5, 0.15, d) * 0.9);
          }`,
      }),
    );
    for (const o of [this.rain, this.snow]) {
      o.frustumCulled = false;
      o.renderOrder = 6;
      this.root.add(o);
    }
  }

  update(dt: number, camera: THREE.Vector3, rain: number, snow: number, light: number): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCam.value.copy(camera);
    this.uniforms.uRain.value = rain;
    this.uniforms.uSnow.value = snow;
    this.uniforms.uLight.value = light;
    this.rain.visible = rain > 0.01;
    this.snow.visible = snow > 0.01;
  }
}
