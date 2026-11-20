/**
 * Download CC0 prop models from Poly Haven (polyhaven.com, licence CC0), fit them to real size
 * and bake them as kit pieces the world file can place (`KIT_prop_*`).
 *
 *   NODE_USE_ENV_PROXY=1 node tools/fetch-props.mjs
 *
 * Sources: art/source/props/<id>/ (git-ignored). Output: game/public/assets/models/prop_<name>.glb
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** name → [Poly Haven id, height in metres, texture size, simplify ratio (1 = keep all)] */
const PROPS = {
  barrel: ['wine_barrel_01', 0.95, 512, 0.5],
  crate: ['wooden_crate_02', 0.52, 512, 1],
  chest: ['wooden_crate_01', 0.56, 512, 1],
  lamp: ['street_lamp_01', 4.3, 512, 0.35],
  bench: ['painted_wooden_bench', 0.98, 512, 1],
  pot: ['planter_pot_clay', 0.6, 512, 1],
  planter: ['planter_box_01', 0.55, 512, 1],
  boombox: ['boombox', 0.47, 1024, 1],
  guitar: ['Ukulele_01', 0.95, 1024, 1],
};

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
for (const [name, [id, height, tex, ratio]] of Object.entries(PROPS)) {
  const dir = `art/source/props/${id}`;
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const gltf = files.gltf['1k'].gltf;
  const main = `${dir}/${id}.gltf`;
  const wanted = {
    [`${id}.gltf`]: gltf.url,
    ...Object.fromEntries(Object.entries(gltf.include).map(([p, f]) => [p, f.url])),
  };
  for (const [path, url] of Object.entries(wanted)) {
    const dest = `${dir}/${path}`;
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }
  const fitted = `${dir}/fitted.glb`;
  run('node', [
    'tools/fit-model.mjs',
    main,
    fitted,
    '--name',
    `KIT_prop_${name}`,
    '--height',
    String(height),
  ]);
  const out = `game/public/assets/models/prop_${name}.glb`;
  run('npx', [
    'gltf-transform',
    'optimize',
    fitted,
    out,
    '--texture-compress',
    'webp',
    '--texture-size',
    String(tex),
    '--compress',
    'meshopt',
    '--flatten',
    'false',
    '--join',
    'true',
    ...(ratio < 1
      ? ['--simplify', 'true', '--simplify-ratio', String(ratio), '--simplify-error', '0.01']
      : ['--simplify', 'false']),
  ]);
  console.log(`${name}: ${id} → ${out}`);
}
