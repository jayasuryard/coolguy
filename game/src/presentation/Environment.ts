import * as THREE from 'three';
import { AMBIENCE, NIGHT_LAMPS } from './ambience';
import { Precipitation } from './Precipitation';
import SKIES from './skymeta.json';

// Golden hour over Bellweather (Art Direction plates): peach haze at the horizon, a low amber
// sun over the sea, lilac-blue overhead with lit cloud bands.
const SUN_COLOR = new THREE.Color(0xffa45e);
/** Haze: things fade from FOG_NEAR and are gone by FOG_FAR, which is also where the world stops being drawn. */
export const FOG_NEAR = 110;
export const FOG_FAR = 760;
/** Half-width of the shadowed area: at least a street's worth, at most the whole island. */
const SHADOW_MIN = 130;
const SHADOW_MAX = 360;

/** Sky dome, fog, sun with a shadow frustum that follows Kit, image-based light, and the sea. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private readonly sunOffset = new THREE.Vector3(-62, 20, 44);
  private readonly water: THREE.Mesh;
  private readonly waterTime = { value: 0 };
  private readonly sunDir = this.sunOffset.clone().normalize();
  private shadowHalf = 0;
  /** Hour of the day, 0–24. The game opens in the golden hour. */
  hour = 17.6;
  /** Game hours per real second: a full day passes in 24 minutes. */
  hoursPerSecond = 1 / 60;
  /** In winter the wet weather falls as snow. */
  winter = false;
  weather: WeatherKind = 'clear';
  private auto = true;
  private changeIn = 3;
  private readonly now = { cloud: 0, rain: 0, snow: 0, mist: 0 };
  private readonly dome = skyDome();
  private readonly probe = new THREE.Scene();
  private readonly rainSnow = new Precipitation();
  private readonly textures = new Map<string, THREE.Texture | null>();
  private hemi!: THREE.HemisphereLight;
  private renderer: THREE.WebGLRenderer | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private baked: THREE.WebGLRenderTarget | null = null;
  private bakeIn = 0;
  private readonly tmpA = new THREE.Color();
  private readonly tmpB = new THREE.Color();
  private readonly tmpC = new THREE.Color();
  private readonly anchor = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    waterLevel: number | null,
    envelope: { width: number; depth: number },
  ) {
    // The island city is meant to be seen across the harbour, so fog only softens the distance.
    scene.fog = new THREE.Fog(
      new THREE.Color(0xf0c6a0),
      waterLevel === null ? 90 : FOG_NEAR,
      waterLevel === null ? 260 : FOG_FAR,
    );
    scene.add(new THREE.HemisphereLight(0xc3c4ee, 0xa87a58, 0.35)); // cool sky, warm stone bounce

    this.sun = new THREE.DirectionalLight(SUN_COLOR, 3.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const s = this.sun.shadow.camera;
    s.near = 1;
    s.far = 1600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.1;
    this.fitShadows(SHADOW_MIN);
    scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.dome);
    this.sky.scale.setScalar(1500);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.hemi = scene.children.find(
      (o) => (o as THREE.HemisphereLight).isHemisphereLight,
    ) as THREE.HemisphereLight;
    scene.add(this.rainSnow.root);
    scene.add(this.sky);

    // The sea.
    const all = waterLevel !== null;
    const material = new THREE.MeshStandardMaterial({
      color: 0x1d6e86,
      roughness: 0.16,
      metalness: 0.55,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          varying vec3 vSeaPos;
          uniform float uTime;
          float seaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float seaNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(seaHash(i), seaHash(i + vec2(1, 0)), f.x), mix(seaHash(i + vec2(0, 1)), seaHash(i + vec2(1, 1)), f.x), f.y);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          {
            // deeper water in patches, and broken whitecaps drifting with the swell
            vec2 q = vSeaPos.xz;
            float deep = seaNoise(q * 0.012 + 3.0);
            diffuseColor.rgb *= 0.78 + 0.4 * deep;
            float crest = seaNoise(q * vec2(0.16, 0.5) + vec2(uTime * 0.25, uTime * 0.1));
            float foam = smoothstep(0.8, 0.9, crest) * smoothstep(0.35, 0.8, seaNoise(q * 2.3 + uTime * 0.4));
            foam *= 1.0 / (1.0 + length(fwidth(q)) * 2.5);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.93), foam * 0.55);
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
          {
            // small crossing swells; fade out with distance so the horizon stays calm
            vec2 q = vSeaPos.xz;
            float fade = 1.0 / (1.0 + length(fwidth(q)) * 1.5);
            vec2 w = vec2(0.0);
            w += vec2(0.8, 0.6) * cos(dot(q, vec2(0.8, 0.6)) * 1.3 + uTime * 1.1);
            w += vec2(-0.5, 0.86) * cos(dot(q, vec2(-0.5, 0.86)) * 2.1 + uTime * 1.5) * 0.7;
            w += vec2(0.2, -0.98) * cos(dot(q, vec2(0.2, -0.98)) * 3.7 + uTime * 2.0) * 0.45;
            vec3 tilt = normalize(vec3(-w.x * 0.07 * fade, 1.0, -w.y * 0.07 * fade));
            normal = normalize((viewMatrix * vec4(tilt, 0.0)).xyz);
          }`,
        );
    };
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(all ? 9000 : envelope.width + 800, all ? 9000 : 600).rotateX(
        -Math.PI / 2,
      ),
      material,
    );
    if (all) this.water.position.set(envelope.width / 2, waterLevel, envelope.depth / 2);
    else this.water.position.set(envelope.width / 2, -0.6, envelope.depth + 300);
    this.water.receiveShadow = true;
    scene.add(this.water);
  }

  /** Remember the renderer (the sky is re-baked into ambient light as the day turns). */
  bakeLighting(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const dome = new THREE.Mesh(this.sky.geometry, this.dome);
    dome.scale.setScalar(100);
    this.probe.add(dome);
  }

  /** Kept for callers; skies now load on demand as their hour approaches. */
  loadSky(): void {
    this.applyTime(0, true);
  }

  // ---------------------------------------------------------------- clock and weather

  /** True once the sky photographs this hour needs have arrived. */
  get skyReady(): boolean {
    for (const t of this.textures.values()) if (!t) return false;
    return this.textures.size > 0;
  }

  /** Clock text for the HUD, e.g. "18:30 · Rain". */
  get label(): string {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    const w = WEATHER[this.weather].name + (this.auto ? '' : ' (held)');
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${w}`;
  }

  /** Jump the clock (hours, wraps at 24). */
  setHour(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    this.bakeIn = 0;
  }

  /** Choose the weather; `null` hands it back to the island's own changing weather. */
  setWeather(kind: WeatherKind | null, instant = false): void {
    this.auto = kind === null;
    if (kind) this.weather = kind;
    if (instant) {
      Object.assign(this.now, WEATHER[this.weather]);
      this.bakeIn = 0;
    }
  }

  /** Step to the next weather: Clear → Cloudy → Rain → Mist → Snow → (back to automatic). */
  nextWeather(): void {
    const i = this.auto ? -1 : KINDS.indexOf(this.weather);
    this.setWeather(i + 1 < KINDS.length ? KINDS[i + 1]! : null);
  }

  private fitShadows(half: number): void {
    if (Math.abs(half - this.shadowHalf) < this.shadowHalf * 0.08) return;
    this.shadowHalf = half;
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -half;
    s.right = s.top = half;
    s.updateProjectionMatrix();
  }

  private texture(name: string): THREE.Texture | null {
    let t = this.textures.get(name);
    if (t === undefined) {
      this.textures.set(name, null);
      new THREE.TextureLoader().load(
        `${import.meta.env.BASE_URL}assets/sky/${name}.webp`,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
          this.textures.set(name, tex);
          this.bakeIn = 0;
        },
      );
      t = null;
    }
    return t;
  }

  /** Advance the clock and weather, then set sun or moon, sky blend, light, haze and wetness. */
  private applyTime(dt: number, force = false): void {
    this.hour = (this.hour + dt * this.hoursPerSecond) % 24;
    const h = this.hour;

    // weather: drift towards the current kind; in automatic mode pick a new one now and then
    if (this.auto && (this.changeIn -= dt * this.hoursPerSecond) <= 0) {
      this.changeIn = 2 + Math.random() * 4;
      const roll = Math.random();
      const wet: WeatherKind = this.winter ? 'snow' : 'rain';
      this.weather = roll < 0.5 ? 'clear' : roll < 0.72 ? 'cloudy' : roll < 0.9 ? wet : 'mist';
    }
    const target = WEATHER[this.weather];
    const ease = force ? 1 : 1 - Math.exp(-dt / 6);
    const w = this.now;
    w.cloud += (target.cloud - w.cloud) * ease;
    w.rain += (target.rain - w.rain) * ease;
    w.snow += (target.snow - w.snow) * ease;
    w.mist += (target.mist - w.mist) * ease;
    // ground: rain soaks in over half a minute and dries over a few; snow settles and melts
    const wetGoal = w.rain > 0.3 ? 1 : 0;
    AMBIENCE.wet.value = THREE.MathUtils.clamp(
      AMBIENCE.wet.value + (wetGoal ? dt / 25 : -dt / 150),
      0,
      1,
    );
    const snowGoal = w.snow > 0.3 ? 1 : 0;
    AMBIENCE.snow.value = THREE.MathUtils.clamp(
      AMBIENCE.snow.value + (snowGoal ? dt / 40 : -dt / 120),
      0,
      1,
    );

    // sun: up at 06:00, down at 19:00, crossing the southern sky; the moon keeps the night
    const D2R = Math.PI / 180;
    const sunT = (h - 6) / 13;
    const sunEl = Math.sin(Math.PI * sunT) * 62;
    const moonT = ((h - 19 + 24) % 24) / 11;
    const moonEl = Math.sin(Math.PI * Math.min(moonT, 1)) * 48;
    const day = THREE.MathUtils.smoothstep(sunEl, -6, 10);
    const useSun = sunEl > -3;
    const el = Math.max(useSun ? sunEl : moonEl, useSun ? 7 : 16) * D2R;
    const az = (15 + (useSun ? sunT : moonT) * 150) * D2R;
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const up = THREE.MathUtils.smoothstep(useSun ? sunEl : moonEl, -3, 7);
    const lowSun = 1 - THREE.MathUtils.smoothstep(sunEl, 6, 38);
    if (useSun) {
      this.sun.color
        .copy(SUN_HIGH)
        .lerp(SUN_COLOR, lowSun)
        .lerp(GREY, w.cloud * 0.8);
      this.sun.intensity = 3.6 * up * (1 - 0.88 * w.cloud) * (1 - 0.5 * w.mist);
    } else {
      this.sun.color.copy(MOON);
      this.sun.intensity = 0.75 * up * (1 - 0.7 * w.cloud);
    }
    this.hemi.intensity = 0.24 + 0.14 * day + 0.2 * w.cloud * day; // never pitch black: the game stays playable
    AMBIENCE.night.value = 1 - day;
    for (const l of NIGHT_LAMPS) l.material.emissiveIntensity = l.base * (0.06 + 1.5 * (1 - day));

    // sky: blend the two photographs either side of this hour, turned to face the light
    const keys = TIMES;
    let b = keys.findIndex((k) => k.hour > h);
    if (b < 0) b = 0;
    const a = (b - 1 + keys.length) % keys.length;
    const A = keys[a]!;
    const B = keys[b]!;
    const span = (B.hour - A.hour + 24) % 24 || 24;
    const mix = ((h - A.hour + 24) % 24) / span;
    const u = this.dome.uniforms;
    const light = Math.atan2(this.sunDir.z, this.sunDir.x);
    const turn = (k: (typeof keys)[number]) => (k.sunU - 0.5) * Math.PI * 2 - light;
    const tA = this.texture(A.name);
    const tB = this.texture(B.name);
    const tC = this.texture(OVERCAST.name);
    this.texture(keys[(b + 1) % keys.length]!.name); // warm up the one after
    if (tA) u.tA!.value = tA;
    if (tB) u.tB!.value = tB;
    if (tC) u.tC!.value = tC;
    u.uMix!.value = tA && tB ? mix : tA ? 0 : 1;
    u.uRotA!.value = turn(A);
    u.uRotB!.value = turn(B);
    u.uRotC!.value = (OVERCAST.sunU - 0.5) * Math.PI * 2 - light;
    (u.uGainA!.value as THREE.Vector3).copy(gainOf(A.name));
    (u.uGainB!.value as THREE.Vector3).copy(gainOf(B.name));
    u.uCloud!.value = tC ? Math.max(w.cloud, w.mist * 0.8) : 0;
    u.uCloudGain!.value = 0.13 + 0.77 * day;

    // haze: the horizon's own colour, nearer and thicker in bad weather
    const fog = this.scene.fog as THREE.Fog;
    const hz = (k: (typeof keys)[number]) =>
      this.tmpA.setRGB(
        k.horizon[0]! / 255,
        k.horizon[1]! / 255,
        k.horizon[2]! / 255,
        THREE.SRGBColorSpace,
      );
    this.tmpB.copy(hz(A)).multiply(this.tmpC.setFromVector3(gainOf(A.name)));
    fog.color.copy(hz(B)).multiply(this.tmpC.setFromVector3(gainOf(B.name)));
    fog.color.lerpColors(this.tmpB, fog.color, mix);
    fog.color.lerp(WARM, 0.5 * lowSun * day * (1 - w.cloud));
    fog.color.lerp(this.tmpA.setScalar(0.07 + 0.55 * day), Math.max(w.cloud, w.mist) * 0.85);
    const thick = Math.max(w.mist, w.rain * 0.55, w.snow * 0.6);
    fog.near = THREE.MathUtils.lerp(FOG_NEAR, 6, thick);
    fog.far =
      THREE.MathUtils.lerp(FOG_FAR, 150, w.mist) *
      (1 - 0.45 * Math.max(w.rain, w.snow) * (1 - w.mist));
    this.scene.environmentIntensity = 0.55 + 0.4 * day;

    // ambient light and reflections follow the sky: re-bake it every so often
    if (this.renderer && this.pmrem && (this.bakeIn -= dt) <= 0) {
      this.bakeIn = 9;
      const baked = this.pmrem.fromScene(this.probe, 0, 1, 500);
      this.scene.environment = baked.texture;
      this.baked?.dispose();
      this.baked = baked;
    }
  }

  update(focus: THREE.Vector3, camera: THREE.Camera, dt = 0): void {
    this.applyTime(dt);
    // Shadows cover the whole view, not just Kit's feet: the box grows as the camera pulls
    // back, so a street, a hillside or the whole island is shaded.
    this.fitShadows(
      THREE.MathUtils.clamp(camera.position.distanceTo(focus) * 1.25, SHADOW_MIN, SHADOW_MAX),
    );
    // Move the shadow box in whole steps, so shadow edges don't crawl as Kit walks.
    const step = ((this.shadowHalf * 2) / this.sun.shadow.mapSize.x) * 8;
    this.anchor.set(Math.round(focus.x / step) * step, focus.y, Math.round(focus.z / step) * step);
    this.sun.position.copy(this.anchor).addScaledVector(this.sunDir, 700);
    this.sun.target.position.copy(this.anchor);
    this.sky.position.copy(camera.position);
    this.waterTime.value += dt;
    this.rainSnow.update(
      dt,
      camera.position,
      this.now.rain,
      this.now.snow,
      1 - AMBIENCE.night.value * 0.8,
    );
  }
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'mist' | 'snow';
const KINDS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'mist', 'snow'];
const WEATHER: Record<
  WeatherKind,
  { name: string; cloud: number; rain: number; snow: number; mist: number }
> = {
  clear: { name: 'Clear', cloud: 0, rain: 0, snow: 0, mist: 0 },
  cloudy: { name: 'Cloudy', cloud: 0.9, rain: 0, snow: 0, mist: 0 },
  rain: { name: 'Rain', cloud: 1, rain: 1, snow: 0, mist: 0.1 },
  mist: { name: 'Mist', cloud: 0.5, rain: 0, snow: 0, mist: 1 },
  snow: { name: 'Snow', cloud: 1, rain: 0, snow: 1, mist: 0.15 },
};
const TIMES = SKIES.filter((k) => k.hour >= 0).sort((a, b) => a.hour - b.hour);
const OVERCAST = SKIES.find((k) => k.hour < 0)!;
const SUN_HIGH = new THREE.Color(0xfff2df);
const MOON = new THREE.Color(0x9db8ff);
const GREY = new THREE.Color(0xcfd6e0);
const WARM = new THREE.Color(0xf2b48a);
/** The night photographs are exposed far brighter than a night feels; pull them down and cool them. */
const GAINS: Record<string, THREE.Vector3> = {
  night: new THREE.Vector3(0.1, 0.14, 0.24),
  moonrise: new THREE.Vector3(0.12, 0.17, 0.3),
  dusk: new THREE.Vector3(0.62, 0.58, 0.72),
  dawn: new THREE.Vector3(0.7, 0.72, 0.85),
};
const ONE = new THREE.Vector3(1, 1, 1);
const gainOf = (name: string): THREE.Vector3 => GAINS[name] ?? ONE;

/** The sky: two photographs cross-faded by the hour, an overcast one laid over them by weather. */
function skyDome(): THREE.ShaderMaterial {
  const blank = new THREE.DataTexture(new Uint8Array([150, 160, 180, 255]), 1, 1);
  blank.needsUpdate = true;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      tA: { value: blank },
      tB: { value: blank },
      tC: { value: blank },
      uMix: { value: 0 },
      uCloud: { value: 0 },
      uRotA: { value: 0 },
      uRotB: { value: 0 },
      uRotC: { value: 0 },
      uGainA: { value: new THREE.Vector3(1, 1, 1) },
      uGainB: { value: new THREE.Vector3(1, 1, 1) },
      uCloudGain: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tA;
      uniform sampler2D tB;
      uniform sampler2D tC;
      uniform float uMix;
      uniform float uCloud;
      uniform float uRotA;
      uniform float uRotB;
      uniform float uRotC;
      uniform vec3 uGainA;
      uniform vec3 uGainB;
      uniform float uCloudGain;
      varying vec3 vDir;
      vec3 look(sampler2D t, vec3 d, float rot) {
        float u = (atan(d.z, d.x) + rot) / 6.2831853 + 0.5;
        float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
        return texture2D(t, vec2(u, v)).rgb;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(look(tA, d, uRotA) * uGainA, look(tB, d, uRotB) * uGainB, uMix);
        col = mix(col, look(tC, d, uRotC) * uCloudGain, uCloud);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
