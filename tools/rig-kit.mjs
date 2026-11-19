/**
 * Rig Kit Vale's Hunyuan 3D export in code (no Blender needed).
 *
 *   node tools/rig-kit.mjs [in=art/source/kit_hunyuan.glb] [out=art/source/kit_rigged.glb]
 *
 * 1. Bakes the node transform so the mesh is Y-up, feet at y=0, facing +Z.
 * 2. Fits a 21-joint humanoid skeleton to measured A-pose landmarks.
 * 3. Skins every vertex with region-aware weights (arms never pull the torso, legs stay separate).
 * 4. Authors looping Idle, Walk, Run and Play clips (names matched by KitAnimator in the game).
 * Then `npm run assets` optimizes the result into game/public/assets/models/kit.glb.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three';

const [, , IN = 'art/source/kit_hunyuan.glb', OUT = 'art/source/kit_rigged.glb'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const meshNode = root.listNodes().find((n) => n.getMesh());
const prim = meshNode.getMesh().listPrimitives()[0];

// ---------------------------------------------------------------- 1. bake transform
const world = new Matrix4().fromArray(meshNode.getWorldMatrix());
const normalM = new Matrix3().getNormalMatrix(world);
const posA = prim.getAttribute('POSITION');
const nrmA = prim.getAttribute('NORMAL');
const N = posA.getCount();
const P = new Float32Array(N * 3);
const NR = new Float32Array(N * 3);
const v = new Vector3();
for (let i = 0; i < N; i++) {
  v.fromArray(posA.getElement(i, []))
    .applyMatrix4(world)
    .toArray(P, i * 3);
  if (nrmA)
    v.fromArray(nrmA.getElement(i, []))
      .applyMatrix3(normalM)
      .normalize()
      .toArray(NR, i * 3);
}
let minY = Infinity;
let maxY = -Infinity;
for (let i = 0; i < N; i++) {
  minY = Math.min(minY, P[i * 3 + 1]);
  maxY = Math.max(maxY, P[i * 3 + 1]);
}
const H = maxY - minY;
for (let i = 0; i < N; i++) P[i * 3 + 1] -= minY; // feet at 0
prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer));
if (nrmA)
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(NR).setBuffer(buffer));
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
// Keep the mesh node at the scene root (glTF ignores transforms of skinned-mesh ancestors).
for (const n of root.listNodes()) if (n.listChildren().includes(meshNode)) n.removeChild(meshNode);

// ---------------------------------------------------------------- 2. skeleton (fractions of height)
const h = (f) => f * H;
const J = {}; // name -> { parent, pos(model space), node }
const joint = (name, parent, x, y, z = 0) =>
  (J[name] = { name, parent, pos: new Vector3(x * H, h(y), z * H) });
joint('Hips', null, 0, 0.46);
joint('Spine', 'Hips', 0, 0.56);
joint('Chest', 'Spine', 0, 0.69);
joint('Neck', 'Chest', 0, 0.84);
joint('Head', 'Neck', 0, 0.9);
for (const [side, s] of [
  ['L', 1],
  ['R', -1],
]) {
  joint(`${side}_Shoulder`, 'Chest', s * 0.05, 0.78);
  joint(`${side}_UpperArm`, `${side}_Shoulder`, s * 0.13, 0.767, -0.009);
  joint(`${side}_LowerArm`, `${side}_UpperArm`, s * 0.173, 0.607, -0.009);
  joint(`${side}_Hand`, `${side}_LowerArm`, s * 0.204, 0.468);
  joint(`${side}_UpLeg`, 'Hips', s * 0.065, 0.433);
  joint(`${side}_Leg`, `${side}_UpLeg`, s * 0.082, 0.247);
  joint(`${side}_Foot`, `${side}_Leg`, s * 0.087, 0.061, -0.013);
  joint(`${side}_Toe`, `${side}_Foot`, s * 0.091, 0.017, 0.078);
}
const names = Object.keys(J);
// bone tips (for distance-to-segment): child joint, or an extension for leaves
const tipOf = (name) => {
  const child = names.find(
    (n) => J[n].parent === name && !n.endsWith('Shoulder') && !n.endsWith('UpLeg'),
  );
  if (child) return J[child].pos;
  const extra = {
    Head: [0, 1.0, 0],
    L_Hand: [0.21, 0.4, 0],
    R_Hand: [-0.21, 0.4, 0],
    L_Toe: [0.091, 0.017, 0.11],
    R_Toe: [-0.091, 0.017, 0.11],
  }[name];
  return extra ? new Vector3(extra[0] * H, h(extra[1]), extra[2] * H) : J[name].pos;
};
for (const name of names) {
  const j = J[name];
  const parentPos = j.parent ? J[j.parent].pos : new Vector3();
  j.node = doc.createNode(name).setTranslation(j.pos.clone().sub(parentPos).toArray());
}
for (const name of names) if (J[name].parent) J[J[name].parent].node.addChild(J[name].node);
const scene = root.listScenes()[0];
scene.addChild(meshNode);
scene.addChild(J.Hips.node);

// ---------------------------------------------------------------- 3. skin weights
const segDist = (p, a, b) => {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
};
const idx = Object.fromEntries(names.map((n, i) => [n, i]));
const fy = (y) => y / H;
const JOINTS = new Uint16Array(N * 4);
const WEIGHTS = new Float32Array(N * 4);
const p = new Vector3();
for (let i = 0; i < N; i++) {
  p.fromArray(P, i * 3);
  const y = fy(p.y);
  const ax = Math.abs(p.x) / H;
  const side = p.x >= 0 ? 'L' : 'R';
  let cands;
  if (y < 0.39) cands = [`${side}_UpLeg`, `${side}_Leg`, `${side}_Foot`, `${side}_Toe`];
  else if (y < 0.5 && ax < 0.115) cands = ['Hips', 'L_UpLeg', 'R_UpLeg', 'Spine'];
  else if (ax > 0.118 && y < 0.67) cands = [`${side}_UpperArm`, `${side}_LowerArm`, `${side}_Hand`];
  else if (ax > 0.08 && y >= 0.67 && y < 0.83)
    cands = ['Chest', `${side}_Shoulder`, `${side}_UpperArm`];
  else if (y >= 0.83) cands = ['Neck', 'Head', 'Chest'];
  else cands = ['Hips', 'Spine', 'Chest'];
  const scored = cands
    .map((n) => ({ n, w: 1 / Math.pow(segDist(p, J[n].pos, tipOf(n)) / H + 0.01, 4) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 4);
  const total = scored.reduce((s, c) => s + c.w, 0);
  scored.forEach((c, k) => {
    JOINTS[i * 4 + k] = idx[c.n];
    WEIGHTS[i * 4 + k] = c.w / total;
  });
}
prim.setAttribute(
  'JOINTS_0',
  doc.createAccessor().setType('VEC4').setArray(JOINTS).setBuffer(buffer),
);
prim.setAttribute(
  'WEIGHTS_0',
  doc.createAccessor().setType('VEC4').setArray(WEIGHTS).setBuffer(buffer),
);
const ibm = new Float32Array(names.length * 16);
names.forEach((n, i) =>
  new Matrix4().makeTranslation(J[n].pos.clone().negate()).toArray(ibm, i * 16),
);
const skin = doc
  .createSkin('KitSkin')
  .setSkeleton(J.Hips.node)
  .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
names.forEach((n) => skin.addJoint(J[n].node));
meshNode.setSkin(skin);
meshNode.setName('Kit');

// ---------------------------------------------------------------- 4. clips
const q = (x = 0, y = 0, z = 0) =>
  new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')).toArray();
const ARMS_IN = 0.12; // bring A-pose arms closer to the body
const clips = {
  Idle: {
    period: 3,
    pose: (t) => {
      const b = Math.sin(t * 2 * Math.PI);
      return {
        Chest: q(0.02 * b),
        Head: q(-0.02 * b, 0.05 * Math.sin(t * 2 * Math.PI + 1)),
        Hips: q(0, 0, 0.015 * b),
        Spine: q(0, 0, -0.015 * b),
        L_UpperArm: q(0, 0, -ARMS_IN - 0.02 * b),
        R_UpperArm: q(0, 0, ARMS_IN + 0.02 * b),
        L_LowerArm: q(-0.12),
        R_LowerArm: q(-0.12),
        $hips: [0, 0.004 * b, 0],
      };
    },
  },
  Walk: { period: 1.0, pose: (t) => gait(t, 0.42, 0.65, 0.32, -0.25, 0.012, 0.03) },
  Run: { period: 0.66, pose: (t) => gait(t, 0.75, 1.15, 0.65, -1.2, 0.03, 0.16) },
  Play: {
    period: 0.625, // one beat at 96 bpm
    pose: (t) => {
      const s = Math.sin(t * 2 * Math.PI);
      return {
        Chest: q(0.04 + 0.02 * s),
        Head: q(0.06 * Math.abs(s)),
        Spine: q(0.02),
        L_UpperArm: q(-0.75, 0, -0.35),
        L_LowerArm: q(-1.25, 0.4, 0),
        L_Hand: q(0, 0, 0.3),
        R_UpperArm: q(-0.35, 0, 0.18),
        R_LowerArm: q(-1.0 + 0.28 * s),
        R_Hand: q(0.2 * s),
        L_UpLeg: q(0, 0, 0.04),
        R_UpLeg: q(0, 0, -0.04),
        $hips: [0, -0.006 + 0.006 * Math.abs(s), 0],
      };
    },
  },
};
function gait(t, thigh, knee, arm, elbow, bob, lean) {
  const w = t * 2 * Math.PI;
  const l = Math.sin(w);
  const r = -l;
  const kneeL = 0.06 + knee * Math.max(0, -Math.cos(w));
  const kneeR = 0.06 + knee * Math.max(0, Math.cos(w));
  return {
    L_UpLeg: q(-thigh * l),
    R_UpLeg: q(-thigh * r),
    L_Leg: q(kneeL),
    R_Leg: q(kneeR),
    L_Foot: q(-0.25 * kneeL + 0.15 * l),
    R_Foot: q(-0.25 * kneeR + 0.15 * r),
    L_UpperArm: q(arm * l, 0, -ARMS_IN),
    R_UpperArm: q(arm * r, 0, ARMS_IN),
    L_LowerArm: q(elbow),
    R_LowerArm: q(elbow),
    Hips: q(0, 0.08 * l),
    Spine: q(lean, -0.1 * l),
    Chest: q(0, -0.04 * l),
    Head: q(-lean * 0.6, 0.06 * l),
    $hips: [0, bob * Math.cos(2 * w), 0],
  };
}
const SAMPLES = 24;
for (const [name, clip] of Object.entries(clips)) {
  const anim = doc.createAnimation(name);
  const times = new Float32Array(SAMPLES + 1).map((_, k) => (k / SAMPLES) * clip.period);
  const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
  const poses = [...times].map((tt, k) => clip.pose(k / SAMPLES));
  const animated = new Set(poses.flatMap((ps) => Object.keys(ps)));
  for (const bone of animated) {
    if (bone === '$hips') {
      const out = new Float32Array((SAMPLES + 1) * 3);
      poses.forEach((ps, k) => {
        const [dx, dy, dz] = ps.$hips;
        out.set([J.Hips.pos.x + dx * H, J.Hips.pos.y + dy * H, J.Hips.pos.z + dz * H], k * 3);
      });
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setInterpolation('LINEAR')
        .setOutput(doc.createAccessor().setType('VEC3').setArray(out).setBuffer(buffer));
      anim
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(J.Hips.node)
            .setTargetPath('translation')
            .setSampler(sampler),
        );
      continue;
    }
    const out = new Float32Array((SAMPLES + 1) * 4);
    poses.forEach((ps, k) => out.set(ps[bone] ?? [0, 0, 0, 1], k * 4));
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setInterpolation('LINEAR')
      .setOutput(doc.createAccessor().setType('VEC4').setArray(out).setBuffer(buffer));
    anim
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(J[bone].node)
          .setTargetPath('rotation')
          .setSampler(sampler),
      );
  }
}

await io.write(OUT, doc);
console.log(
  `rigged ${N} vertices, ${names.length} joints, clips: ${Object.keys(clips).join(', ')} → ${OUT}`,
);
