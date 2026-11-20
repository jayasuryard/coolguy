/**
 * Download the CC0 scanned PBR texture sets the city uses from Poly Haven (polyhaven.com,
 * licence CC0) and bake them for the game.
 *
 *   NODE_USE_ENV_PROXY=1 node tools/fetch-textures.mjs
 *
 * Sources land in art/source/textures/<slot>/ (git-ignored). The game gets three 1K WebP maps
 * per slot in game/public/assets/tex/: <slot>_c (colour), <slot>_n (OpenGL normal),
 * <slot>_a (R = ambient occlusion, G = roughness, B = metalness), plus tex.json with each
 * colour map's mean, so the shader can use the scan as detail under the art's own palette.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

/** slot → Poly Haven asset id */
const SETS = {
  paving: 'cobblestone_floor_04',
  stone: 'seaworn_sandstone_brick',
  plaster: 'worn_plaster_wall',
  roof: 'clay_roof_tiles_02',
  planks: 'weathered_plank_siding',
  metal: 'green_metal_rust',
  rock: 'cliff_side',
  // ground, grass and land come from Poly Haven's ground-terrain set
  sand: 'aerial_beach_01',
  grass: 'forrest_ground_01',
  earth: 'dry_ground_rocks',
};
const SIZE = 1024;
const MAPS = { c: ['Diffuse', 'diff'], n: ['nor_gl'], a: ['arm'], h: ['Displacement', 'disp'] };
/** Slots that also need a height map (for parallax depth). */
const WITH_HEIGHT = ['paving'];

mkdirSync('game/public/assets/tex', { recursive: true });
const meta = {};
for (const [slot, id] of Object.entries(SETS)) {
  const dir = `art/source/textures/${slot}`;
  mkdirSync(dir, { recursive: true });
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  for (const [suffix, keys] of Object.entries(MAPS)) {
    if (suffix === 'h' && !WITH_HEIGHT.includes(slot)) continue;
    const key = keys.find((k) => files[k]);
    const src = `${dir}/${id}_${suffix}.jpg`;
    if (!existsSync(src)) {
      const res = files[key]?.['2k'] ?? files[key]?.['1k'];
      const url = res?.jpg?.url ?? res?.png?.url;
      if (!url) throw new Error(`${id}: no ${suffix} map`);
      writeFileSync(src, Buffer.from(await (await fetch(url)).arrayBuffer()));
    }
    const out = `game/public/assets/tex/${slot}_${suffix}.webp`;
    await sharp(src)
      .resize(SIZE, SIZE)
      .webp({ quality: suffix === 'c' ? 82 : 86 })
      .toFile(out);
    if (suffix === 'c') {
      // mean colour in linear light
      const { data } = await sharp(src)
        .resize(64, 64)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 3)
        for (let k = 0; k < 3; k++) sum[k] += (data[i + k] / 255) ** 2.2;
      meta[slot] = { source: id, mean: sum.map((v) => +(v / (data.length / 3)).toFixed(4)) };
    }
  }
  console.log(`${slot}: ${id}`);
}
writeFileSync('game/public/assets/tex/tex.json', JSON.stringify(meta, null, 1) + '\n');
// the shader needs the means at compile time, so they are bundled with the code too
writeFileSync('game/src/presentation/texmeta.json', JSON.stringify(meta, null, 1) + '\n');
