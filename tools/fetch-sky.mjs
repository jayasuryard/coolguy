/**
 * Download the CC0 photographed skies (Poly Haven, licence CC0) the day-night cycle blends
 * between, one per time of day plus an overcast one for bad weather.
 *
 *   NODE_USE_ENV_PROXY=1 node tools/fetch-sky.mjs
 *
 * Writes game/public/assets/sky/<name>.webp (equirectangular 2048×1024) and
 * game/src/presentation/skymeta.json: each sky's hour, where its sun or moon sits in the
 * picture, and its horizon colour (used for the haze).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

/** [name, hour it is shown at, Poly Haven id] — hour −1 marks the overcast sky. */
const SKIES = [
  ['night', 0, 'qwantani_night_puresky'],
  ['dawn', 5.6, 'qwantani_dawn_puresky'],
  ['sunrise', 6.6, 'qwantani_sunrise_puresky'],
  ['morning', 9, 'qwantani_morning_puresky'],
  ['noon', 12.5, 'qwantani_noon_puresky'],
  ['afternoon', 15.5, 'qwantani_afternoon_puresky'],
  ['golden', 18, 'kloppenheim_06_puresky'],
  ['dusk', 19.4, 'qwantani_dusk_2_puresky'],
  ['moonrise', 20.6, 'qwantani_moonrise_puresky'],
  ['overcast', -1, 'kloofendal_overcast_puresky'],
];

mkdirSync('art/source/sky', { recursive: true });
mkdirSync('game/public/assets/sky', { recursive: true });
const meta = [];
for (const [name, hour, id] of SKIES) {
  const src = `art/source/sky/${id}.jpg`;
  if (!existsSync(src)) {
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
    writeFileSync(src, Buffer.from(await (await fetch(files.tonemapped.url)).arrayBuffer()));
  }
  await sharp(src)
    .resize(2048, 1024)
    .webp({ quality: 84 })
    .toFile(`game/public/assets/sky/${name}.webp`);
  // the brightest blurred spot in the upper half is the sun (or moon)
  const W = 512;
  const H = 256;
  const { data } = await sharp(src)
    .resize(W, H)
    .blur(3)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let best = -1;
  let sun = [0.5, 0.5];
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const l = data[i] + data[i + 1] + data[i + 2];
      if (l > best) {
        best = l;
        sun = [(x + 0.5) / W, 1 - (y + 0.5) / H];
      }
    }
  }
  const row = Math.round(H * 0.47);
  const sum = [0, 0, 0];
  for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) sum[k] += data[(row * W + x) * 3 + k];
  meta.push({
    name,
    hour,
    source: id,
    sunU: +sun[0].toFixed(4),
    horizon: sum.map((v) => Math.round(v / W)),
  });
  console.log(name, id);
}
writeFileSync('game/src/presentation/skymeta.json', JSON.stringify(meta, null, 1) + '\n');
