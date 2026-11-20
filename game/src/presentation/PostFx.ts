import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Final grade, in display space: gentle filmic contrast, warm highlights, cool shadows, vignette. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.03 },
    contrast: { value: 0.97 },
    vignette: { value: 0.2 },
    lens: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    uniform float lens;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      // split tone: teal-blue into the shadows, amber into the highlights
      c += mix(vec3(-0.004, 0.002, 0.016), vec3(0.03, 0.012, -0.022), smoothstep(0.15, 0.85, l));
      // goggles: the timetable drains to a cold verdigris plate, edges swim
      vec3 plate = vec3(l) * vec3(0.62, 0.98, 0.92) + vec3(0.0, 0.02, 0.04);
      c = mix(c, plate, lens * 0.62);
      c += lens * 0.035 * sin(vUv.y * 900.0);
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.25, 0.95, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/** Bloom + grade chain. Lamps, the low sun on water and beat-lit eyes glow; the frame is graded. */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly ao: GTAOPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // contact shading: corners, eaves, doorways and where things meet the ground
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.blendIntensity = 0.85;
    this.ao.updateGtaoMaterial({
      radius: 0.9,
      distanceExponent: 1.4,
      thickness: 1.2,
      scale: 1.25,
      samples: 12,
    });
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.14, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  /** 0 = naked eye, 1 = looking through Mara's goggles. */
  get lens(): number {
    return this.grade.uniforms.lens!.value as number;
  }
  set lens(v: number) {
    this.grade.uniforms.lens!.value = v;
  }

  /** Contact shading on or off (the first thing dropped on a struggling machine). */
  set contactShading(on: boolean) {
    this.ao.enabled = on;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }
}
