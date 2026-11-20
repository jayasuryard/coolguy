import * as THREE from 'three';
import { AMBIENCE } from './ambience';
import TEX_META from './texmeta.json';

/** Scanned texture set(s) per material: [slot, metres per tile]. See tools/fetch-textures.mjs. */
type Slot = keyof typeof TEX_META;
const SCANS: Partial<Record<number, Array<[Slot, number]>>> = {
  1: [
    ['paving', 2.2],
    ['grass', 3.2],
    ['earth', 3.6],
  ],
  2: [['stone', 2.2]],
  3: [['plaster', 5.5]],
  4: [['roof', 1.5]],
  5: [['planks', 1.4]],
  6: [['rock', 6]],
  7: [['metal', 1.3]],
  9: [['sand', 2.5]],
  10: [['planks', 2]],
  11: [['plaster', 5.5]],
};
/** How strongly each material takes the scan's colour variation and its relief (0–1). */
const STRENGTH: Partial<Record<number, [number, number]>> = {
  1: [1, 1],
  2: [0.75, 1],
  3: [0.3, 0.45],
  4: [0.8, 1],
  5: [0.8, 1],
  6: [0.9, 1],
  7: [0.55, 0.7],
  9: [0.6, 0.8],
  10: [0.8, 1],
  11: [0.3, 0.45],
};

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
/** One of a slot's maps: c = colour, n = normal (OpenGL), a = AO / roughness / metalness. */
function scan(slot: Slot, map: 'c' | 'n' | 'a' | 'h'): THREE.Texture {
  const key = `${slot}_${map}`;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(`${import.meta.env.BASE_URL}assets/tex/${key}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (map === 'c') t.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, t);
  }
  return t;
}

/** True once every scanned texture asked for so far has arrived. */
export function scansReady(): boolean {
  for (const t of cache.values()) if (!t.image) return false;
  return true;
}

/**
 * Procedural surface detail for the city's flat vertex-coloured materials: paving setts, ashlar
 * courses, mottled plaster, roof tiles, plank grain. Computed in world space in the shader, so
 * the Blender export needs no UVs or textures and every wall gets joints at a real-world scale.
 */
const KINDS = {
  M_terrain: 1,
  M_stone: 2,
  M_plaster: 3,
  M_roof: 4,
  M_wood: 5,
  M_rock: 6,
  M_painted: 7,
  M_flora: 8,
  M_sand: 9,
  M_planks: 10,
  M_facade: 11,
} as const;

const VERT_DECL = /* glsl */ `
varying vec3 vSurfPos;
varying vec3 vSurfNrm;
#if SURF_KIND == 11
attribute vec4 surfUv; // metres along the wall, metres above its base, wall width, wall height
varying vec4 vSurfUv;
#endif
`;
const VERT_BODY = /* glsl */ `
#ifdef USE_INSTANCING
vSurfPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vSurfNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
vSurfPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSurfNrm = normalize(mat3(modelMatrix) * objectNormal);
#endif
#if SURF_KIND == 11
vSurfUv = surfUv;
#endif
`;

const FRAG_DECL = /* glsl */ `
varying vec3 vSurfPos;
varying vec3 vSurfNrm;
#if SURF_KIND == 11
varying vec4 vSurfUv;
#endif
#ifdef SURF_TEX
uniform sampler2D tAc;
uniform sampler2D tAn;
uniform sampler2D tAa;
uniform vec3 uMeanA;
uniform vec3 uTexScale; // metres per tile for set A, B, C
uniform vec2 uTexAmt;   // strength of the scan's colour variation, and of its relief
#if SURF_KIND == 1
uniform sampler2D tBc;
uniform sampler2D tBn;
uniform sampler2D tBa;
uniform vec3 uMeanB;
uniform sampler2D tCc;
uniform sampler2D tCn;
uniform sampler2D tCa;
uniform vec3 uMeanC;
uniform sampler2D tAh;    // paving height (white = top of a stone)
const float PAVE_DEPTH = 0.075; // metres from the stone tops down to the joints
#endif
vec3 surfN = vec3(0.0);   // world-space normal from the scan (zero = none)
float surfTexR = -1.0;    // scanned roughness (negative = keep the material's)
// Triplanar sampling: three projections blended by how much the surface faces each axis.
vec4 sTri(sampler2D t, vec3 q, vec3 w) {
  return texture2D(t, q.zy) * w.x + texture2D(t, q.xz) * w.y + texture2D(t, q.xy) * w.z;
}
// Triplanar normal map, whiteout blend, result in world space.
vec3 sTriN(sampler2D t, vec3 q, vec3 n, vec3 w) {
  vec3 tx = texture2D(t, q.zy).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(t, q.xz).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(t, q.xy).xyz * 2.0 - 1.0;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
#endif
uniform float uWet;
uniform float uSnow;
uniform float uNight;
float surfWet = 0.0;
float surfSnow = 0.0;
float surfRough = 0.0;
float surfH = 0.0;   // relief in metres, turned into a normal after shading inputs are set
float sEdge = 0.0;   // metres to the nearest joint (set by sJoints)
float sLod = 1.0;
vec3 surfGlow = vec3(0.0);

float sHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float sFbm(vec3 p) {
  return sNoise(p) * 0.55 + sNoise(p * 2.3 + 7.1) * 0.3 + sNoise(p * 5.1 + 3.7) * 0.15;
}
// Running-bond joints. Returns x = mortar (0..1), y = per-stone random, both faded with distance.
vec2 sJoints(vec2 uv, vec2 size, float seed) {
  vec2 q = uv / size;
  float row = floor(q.y);
  q.x += 0.5 * mod(row, 2.0) + sHash(vec3(row, seed, 1.0)) * 0.3;
  vec2 f = fract(q);
  vec2 id = floor(q);
  float edge = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
  float lod = clamp(1.0 - length(fwidth(uv)) / (min(size.x, size.y) * 0.9), 0.0, 1.0);
  sEdge = edge;
  sLod = lod;
  float mortar = (1.0 - smoothstep(0.006, 0.028, edge)) * lod;
  return vec2(mortar, mix(0.5, sHash(vec3(id, seed)), lod));
}
`;

const FRAG_BODY = /* glsl */ `
{
  vec3 p = vSurfPos;
  vec3 n = normalize(vSurfNrm);
  float flatness = smoothstep(0.72, 0.94, n.y);
  // horizontal coordinate along a wall
  float u = abs(n.x) > abs(n.z) ? p.z : p.x;
  float wide = sFbm(p * 0.11);          // metres-scale weathering
  float fine = sFbm(p * 2.6);           // grain
  vec3 c = diffuseColor.rgb;
  vec3 base = c;

  #if SURF_KIND == 1 // terrain: paving setts on the flats, bare ground and grass elsewhere
    float grass = smoothstep(0.02, 0.1, c.g - max(c.r, c.b));
    vec2 j = sJoints(p.xz, vec2(0.62, 0.36), 3.0);
    float paved = flatness * (1.0 - grass);
    c *= mix(1.0, 0.82 + 0.3 * j.y, paved);
    c *= mix(1.0, 0.58, j.x * paved);
    c *= 0.86 + 0.28 * wide;
    c *= mix(0.9 + 0.2 * fine, 1.0, paved * 0.6);
    c = mix(c, c * vec3(0.9, 1.06, 0.8), grass * (0.3 + 0.7 * fine));
    surfRough = -0.22 * paved * (1.0 - j.x) * (0.4 + 0.6 * wide);
    // each sett is a low dome; bare ground is just rough
    surfH = paved * sLod * smoothstep(0.0, 0.07, sEdge) * 0.022 + fine * 0.006;
  #elif SURF_KIND == 2 // dressed stone: ashlar courses on walls, flags on top
    vec2 jw = sJoints(vec2(u, p.y), vec2(0.86, 0.4), 5.0);
    vec2 jf = sJoints(p.xz, vec2(0.7, 0.7), 9.0);
    vec2 j = mix(jw, jf, flatness);
    c *= 0.84 + 0.3 * j.y;
    c *= mix(1.0, 0.6, j.x);
    c *= 0.84 + 0.3 * wide;
    c *= 0.93 + 0.14 * fine;
    surfRough = -0.1 * (1.0 - j.x) * wide;
    surfH = (1.0 - j.x) * 0.02 * sLod + fine * 0.007 + wide * 0.01;
  #elif SURF_KIND == 3 // lime plaster: mottled, sun-bleached, streaked under the eaves
    float streak = sNoise(vec3(u * 2.2, p.y * 0.18, 4.0));
    c *= 0.86 + 0.24 * wide;
    c *= 0.95 + 0.1 * fine;
    c *= 1.0 - 0.12 * smoothstep(0.55, 0.9, streak) * (1.0 - flatness);
    float patchy = smoothstep(0.66, 0.74, sFbm(p * 0.55 + 11.0));
    c = mix(c, c * vec3(1.1, 1.06, 0.98) + 0.03, patchy * 0.45);
    surfH = fine * 0.005 - patchy * 0.004;
  #elif SURF_KIND == 4 // terracotta tiles in rows
    vec2 j = sJoints(vec2(u, p.y * 1.6), vec2(0.26, 0.2), 13.0);
    c *= 0.78 + 0.4 * j.y;
    c *= mix(1.0, 0.55, j.x);
    c *= 0.86 + 0.26 * wide;
    // barrel tiles: a half-round across each one, stepped down each course
    surfH = (abs(sin(u / 0.26 * 3.14159)) * 0.035 + fract(p.y * 1.6 / 0.2) * 0.02) * sLod;
  #elif SURF_KIND == 5 // planks
    float plank = sJoints(vec2(u, p.y * 0.2), vec2(0.19, 2.0), 17.0).x;
    float grain = sNoise(vec3(u * 3.0, p.y * 26.0, p.z * 3.0));
    c *= 0.82 + 0.32 * grain;
    c *= mix(1.0, 0.6, plank);
    c *= 0.9 + 0.2 * wide;
    surfH = grain * 0.004 - plank * 0.012;
  #elif SURF_KIND == 6 // sea rock
    float crag = sFbm(p * 0.6);
    c *= 0.72 + 0.5 * crag;
    c *= 0.9 + 0.2 * fine;
    c = mix(c, c * vec3(0.8, 0.86, 0.7), smoothstep(0.55, 0.8, sFbm(p * 0.23 + 4.0)) * 0.5);
    surfH = crag * 0.22 + fine * 0.04;
  #elif SURF_KIND == 7 // painted iron: worn, chipped to primer
    c *= 0.92 + 0.14 * fine;
    float chip = smoothstep(0.7, 0.78, sFbm(p * 3.4 + 5.0));
    c = mix(c, vec3(0.42, 0.25, 0.16), chip * 0.55);
    surfRough = 0.25 * chip;
  #elif SURF_KIND == 9 // beach sand: wind ripples, dark and glossy where the sea wets it
    c *= 0.9 + 0.14 * sNoise(vec3(p.x * 0.5, 0.0, p.z * 2.6));
    c *= 0.93 + 0.12 * wide;
    float wet = 1.0 - smoothstep(-1.9, -0.5, p.y);
    c *= mix(1.0, 0.62, wet);
    surfRough = -0.55 * wet;
    surfH = sNoise(vec3(p.x * 0.5, 0.0, p.z * 2.6)) * 0.012;
  #elif SURF_KIND == 10 // decking: long boards with gaps
    vec2 jd = sJoints(vec2(p.x + p.z, p.x - p.z) * 0.7071, vec2(0.21, 3.0), 21.0);
    float boardGrain = sNoise(vec3((p.x - p.z) * 5.0, p.y, (p.x + p.z) * 0.6));
    c *= 0.8 + 0.3 * jd.y;
    c *= 0.88 + 0.2 * boardGrain;
    c *= mix(1.0, 0.45, jd.x * flatness);
    c *= 0.9 + 0.18 * wide;
    surfH = -jd.x * 0.014 * flatness + boardGrain * 0.003;
  #elif SURF_KIND == 11 // townhouse facade: plaster with rows of shuttered windows and shopfronts
    c *= 0.88 + 0.2 * wide;
    c *= 0.95 + 0.1 * fine;
    float faceW = vSurfUv.z;
    if (faceW > 2.0 && abs(n.y) < 0.3) {
      const float BAY = 2.9;
      const float STOREY = 3.3;
      float bays = floor(faceW / BAY);
      float margin = (faceW - bays * BAY) * 0.5;
      float bx = (vSurfUv.x - margin) / BAY;
      float storey = floor(vSurfUv.y / STOREY);
      float storeys = floor((vSurfUv.w - 0.2) / STOREY);
      // a darker plinth and a string course under each storey
      c *= mix(1.0, 0.8, 1.0 - smoothstep(0.35, 0.5, vSurfUv.y));
      float course = 1.0 - smoothstep(0.0, 0.07, abs(fract(vSurfUv.y / STOREY + 0.5) - 0.5) * STOREY);
      c = mix(c, c * 1.12 + 0.03, course * step(1.0, storey + 0.5) * 0.7);
      if (bx > 0.0 && bx < bays && storey < storeys) {
        vec2 q = vec2(fract(bx) * BAY, fract(vSurfUv.y / STOREY) * STOREY);
        vec3 id = vec3(floor(bx), storey, floor(faceW * 7.0) + floor(p.x * 0.13 + p.z * 0.17));
        float rnd = sHash(id);
        bool ground = storey < 0.5;
        vec2 lo = ground ? vec2(0.55, 0.0) : vec2(0.85, 0.85);
        vec2 hi = ground ? vec2(2.35, 2.55) : vec2(2.05, 2.55);
        vec2 dIn = min(q - lo, hi - q);
        float inside = step(0.0, min(dIn.x, dIn.y));
        float frame = inside * (1.0 - step(0.09, min(dIn.x, dIn.y)));
        float lod = clamp(1.0 - length(fwidth(vSurfUv.xy)) * 0.9, 0.0, 1.0);
        if (inside > 0.5) {
          vec3 glass = vec3(0.06, 0.1, 0.12);
          vec3 shutter = mix(vec3(0.2, 0.36, 0.3), vec3(0.3, 0.42, 0.55), step(0.5, sHash(id.zzz)));
          float louvre = 0.82 + 0.18 * step(0.5, fract(q.y * 9.0));
          bool shut = !ground && rnd < 0.28;
          bool lit = !shut && rnd > 0.7;
          vec3 pane = shut ? shutter * louvre : glass;
          // glazing bars
          float bars = 1.0 - step(0.035, abs(q.x - (lo.x + hi.x) * 0.5)) * step(0.03, abs(q.y - mix(lo.y, hi.y, 0.62)));
          pane = mix(pane, vec3(0.85, 0.8, 0.7), (shut ? 0.0 : bars * 0.6));
          pane = mix(pane, vec3(0.9, 0.86, 0.78), frame);
          c = mix(c, pane, lod);
          surfH = -0.06 * lod * (1.0 - frame);
          if (lit) surfGlow = vec3(1.0, 0.7, 0.36) * (0.5 + 0.9 * sHash(id + 3.0)) * (1.0 - frame) * (1.0 - bars * 0.6) * lod;
          surfRough = shut ? 0.0 : -0.6 * lod * (1.0 - frame);
        } else {
          // sill shadow under each window
          float sill = step(lo.x - 0.1, q.x) * step(q.x, hi.x + 0.1) * (1.0 - smoothstep(0.0, 0.35, lo.y - q.y)) * step(q.y, lo.y);
          c *= 1.0 - 0.22 * sill * lod;
        }
      }
    }
  #else // foliage
    c *= 0.74 + 0.5 * sFbm(p * 1.7);
    c = mix(c, c * vec3(1.15, 1.05, 0.7), smoothstep(0.55, 0.9, fine) * 0.35);
    // leaf clusters: small bright tufts over dark gaps
    float leaf = sNoise(p * 6.5);
    c *= 0.72 + 0.5 * leaf;
    surfH = leaf * 0.09;
  #endif
  #ifdef SURF_TEX
  {
    // The scan supplies the grain, dirt and relief; the art's own colour stays the palette.
    vec3 w3 = pow(abs(n), vec3(4.0));
    w3 /= w3.x + w3.y + w3.z;
    #if SURF_KIND == 4
      // roof tiles run down each slope, whichever way it faces
      float sl = length(n.xz);
      vec2 ruv = (sl > 0.08 ? vec2(dot(p.xz, vec2(-n.z, n.x) / sl), p.y / sl) : p.xz) / uTexScale.x;
      vec3 tc = texture2D(tAc, ruv).rgb;
      vec3 ta = texture2D(tAa, ruv).rgb;
      surfH = dot(tc, vec3(0.333)) * 0.06;
    #else
      vec3 q = p / uTexScale.x;
      #if SURF_KIND == 1
        // Parallax occlusion: march the view ray down through the paving's height field so
        // the stones stand proud of their joints and hide each other at grazing angles.
        float stoneH = 1.0;
        {
          vec3 toEye = cameraPosition - p;
          float eyeDist = length(toEye);
          float strength = paved * (1.0 - smoothstep(18.0, 42.0, eyeDist));
          if (strength > 0.01) {
            vec3 V = toEye / eyeDist;
            float lod = log2(max(length(dFdx(p.xz)), length(dFdy(p.xz))) / uTexScale.x * 1024.0);
            const int STEPS = 20;
            vec2 shift = -V.xz / max(V.y, 0.22) * (PAVE_DEPTH * strength) / uTexScale.x; // uv at full depth
            vec2 uv = q.xz;
            vec2 stepUv = shift / float(STEPS);
            float layer = 1.0 / float(STEPS);
            float depth = 0.0;
            float here = 1.0 - textureLod(tAh, uv, lod).r;
            float before = here;
            for (int i = 0; i < STEPS; i++) {
              if (depth >= here) break;
              before = here - depth;
              uv += stepUv;
              depth += layer;
              here = 1.0 - textureLod(tAh, uv, lod).r;
            }
            // refine between the last two samples
            float after = depth - here;
            float t = after / max(after + before, 1e-4);
            uv -= stepUv * t;
            q.xz = uv;
            stoneH = textureLod(tAh, uv, lod).r;
          } else {
            stoneH = texture2D(tAh, q.xz).r;
          }
        }
      #endif
      vec3 tc = sTri(tAc, q, w3).rgb;
      vec3 ta = sTri(tAa, q, w3).rgb;
      surfN = sTriN(tAn, q, n, w3);
    #endif
    vec3 detail = clamp(tc / uMeanA, 0.0, 2.4);
    surfN = mix(n, surfN, uTexAmt.y) * step(0.1, dot(surfN, surfN));
    #if SURF_KIND == 1
      vec3 qb = p / uTexScale.y;
      vec3 tb = sTri(tBc, qb, w3).rgb;
      detail = mix(detail, clamp(tb / uMeanB, 0.0, 2.4), grass);
      ta = mix(ta, sTri(tBa, qb, w3).rgb, grass);
      surfN = normalize(mix(surfN, sTriN(tBn, qb, n, w3), grass));
      // unpaved, ungrassed ground (banks, slopes, paths): bare earth
      float bare = (1.0 - paved) * (1.0 - grass);
      vec3 qc = p / uTexScale.z;
      vec3 te = sTri(tCc, qc, w3).rgb;
      detail = mix(detail, clamp(te / uMeanC, 0.0, 2.4), bare);
      ta = mix(ta, sTri(tCa, qc, w3).rgb, bare);
      surfN = normalize(mix(surfN, sTriN(tCn, qc, n, w3), bare));
    #endif
    detail = mix(vec3(1.0), detail, uTexAmt.x);
    ta.r = mix(1.0, ta.r, uTexAmt.y);
    #if SURF_KIND == 11
      float pane = step(surfH, -0.01); // window glass and shutters keep their own look
      c *= mix(detail, vec3(1.0), pane);
      c *= mix(1.0, ta.r, 0.85 * (1.0 - pane));
      surfTexR = mix(ta.g, -1.0, pane);
      surfN *= 1.0 - pane;
    #else
      c = base * detail * (0.86 + 0.28 * wide);
      #if SURF_KIND == 1
        // natural ground takes its colour from the scan itself, not just its grain
        c = mix(c, tb * 1.25 * (0.8 + 0.4 * wide), 0.6 * grass);
        c = mix(c, te * 1.2 * (0.85 + 0.3 * wide), 0.55 * bare);
      #endif
      c *= mix(1.0, ta.r, 0.85);
      surfTexR = ta.g;
      #if SURF_KIND == 1
        // Worn street stone, after rain: rounded faces polished by feet, deep dark joints with
        // moss, and water lying in the low places, mirror-flat, so the evening sun runs along it.
        float joint = 1.0 - smoothstep(0.18, 0.55, stoneH);
        float damp = smoothstep(0.25, 0.7, sFbm(p * 0.09 + 2.0));
        vec3 stone = c * mix(vec3(0.6, 0.52, 0.46), vec3(0.4, 0.34, 0.32), damp);
        stone *= 1.0 - 0.62 * joint;
        float moss = joint * smoothstep(0.38, 0.66, sFbm(p * 0.55 + 9.0)) * (1.0 - damp * 0.6);
        stone = mix(stone, vec3(0.14, 0.19, 0.06), moss * 0.8);
        // standing water: fills up to a level that rises in the damp patches
        float level = mix(0.04, 0.42, damp) + uWet * 0.3;
        float water = (1.0 - smoothstep(level - 0.06, level + 0.02, stoneH)) * paved;
        stone = mix(stone, stone * vec3(0.5, 0.52, 0.56), water);
        c = mix(c, stone, paved);
        surfTexR = mix(surfTexR, mix(0.46, 0.22, damp) + 0.3 * joint, paved);
        surfTexR = mix(surfTexR, 0.035, water);
        surfN = normalize(mix(surfN, n, water * 0.94));
      #endif
      #if SURF_KIND != 4
        surfH = 0.0;
      #endif
      surfRough = 0.0;
    #endif
    #if SURF_KIND == 9
      float soak = 1.0 - smoothstep(-1.9, -0.5, p.y);
      c *= mix(1.0, 0.62, soak);
      surfRough = -0.5 * soak;
    #endif
  }
  #endif
  {
    // weather on every surface: rain darkens and slicks what faces the sky, snow settles on it
    float sky = smoothstep(0.25, 0.8, n.y);
    surfSnow = uSnow * sky * smoothstep(0.75 - uSnow * 0.75, 1.05 - uSnow * 0.6, sFbm(p * 0.3) + 0.35);
    surfWet = uWet * (0.35 + 0.65 * sky) * (1.0 - surfSnow);
    c *= mix(1.0, 0.68, surfWet);
    c = mix(c, vec3(0.84, 0.88, 0.95) * (0.9 + 0.1 * fine), surfSnow);
    surfH *= 1.0 - surfSnow;
    #ifdef SURF_TEX
      surfN = mix(surfN, n * step(0.1, dot(surfN, surfN)), surfSnow * 0.85);
    #endif
  }
  diffuseColor.rgb = c;
}
`;

/** Add world-space detail to one of the city's named materials (no-op for unknown names). */
export function applySurface(material: THREE.Material): void {
  const kind = KINDS[material.name as keyof typeof KINDS];
  if (!kind) return;
  const scans = SCANS[kind];
  material.defines = {
    ...(material.defines ?? {}),
    SURF_KIND: kind,
    ...(scans ? { SURF_TEX: '' } : {}),
  };
  // start fetching the scans now (during the loading screen), not on the first drawn frame
  for (const [slot] of scans ?? []) for (const map of ['c', 'n', 'a'] as const) scan(slot, map);
  if (kind === 1) scan('paving', 'h');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = AMBIENCE.wet;
    shader.uniforms.uSnow = AMBIENCE.snow;
    shader.uniforms.uNight = AMBIENCE.night;
    if (scans) {
      const [a, b, c] = scans;
      const u = shader.uniforms;
      u.tAc = { value: scan(a![0], 'c') };
      u.tAn = { value: scan(a![0], 'n') };
      u.tAa = { value: scan(a![0], 'a') };
      u.uMeanA = { value: new THREE.Vector3(...TEX_META[a![0]].mean) };
      u.uTexScale = { value: new THREE.Vector3(a![1], b?.[1] ?? 1, c?.[1] ?? 1) };
      u.uTexAmt = { value: new THREE.Vector2(...(STRENGTH[kind] ?? [0.7, 1])) };
      if (b) {
        u.tBc = { value: scan(b[0], 'c') };
        u.tBn = { value: scan(b[0], 'n') };
        u.tBa = { value: scan(b[0], 'a') };
        u.uMeanB = { value: new THREE.Vector3(...TEX_META[b[0]].mean) };
      }
      if (kind === 1) u.tAh = { value: scan('paving', 'h') };
      if (c) {
        u.tCc = { value: scan(c[0], 'c') };
        u.tCn = { value: scan(c[0], 'n') };
        u.tCa = { value: scan(c[0], 'a') };
        u.uMeanC = { value: new THREE.Vector3(...TEX_META[c[0]].mean) };
      }
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_BODY}`)
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        #ifdef SURF_TEX
        if (dot(surfN, surfN) > 0.1) normal = normalize(mat3(viewMatrix) * surfN) * faceDirection;
        #endif
        {
          // height → normal (Mikkelsen): works on any surface without tangents or UVs
          vec2 dH = vec2(dFdx(surfH), dFdy(surfH));
          vec3 sx = dFdx(-vViewPosition);
          vec3 sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal);
          vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
          normal = normalize(abs(det) * normal - grad);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += surfGlow * (0.1 + 1.7 * uNight);',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
#ifdef SURF_TEX
if (surfTexR >= 0.0) roughnessFactor = surfTexR;
#endif
roughnessFactor = clamp(roughnessFactor + surfRough, 0.05, 1.0);
roughnessFactor = mix(mix(roughnessFactor, 0.1, surfWet * 0.8), 0.8, surfSnow);`,
      );
  };
  material.customProgramCacheKey = () => `surface-${kind}`;
  material.needsUpdate = true;
}
