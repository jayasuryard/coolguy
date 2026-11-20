/**
 * Cut single-subject reference images out of the concept sheets in art/reference/target,
 * padded to a square on the sheet's own background colour, ready for image-to-3D.
 *   node tools/crop-refs.mjs
 */
import sharp from 'sharp';

const SRC = 'art/reference/target';
const OUT = 'art/reference/crops';
// [name, sheet, left, top, width, height]
const CROPS = [
  ['mara', 'residents-lineup', 0, 140, 200, 770],
  ['paz', 'residents-lineup', 190, 150, 215, 760],
  ['ione', 'residents-lineup', 398, 130, 195, 780],
  ['wren', 'residents-lineup', 780, 230, 230, 680],
  ['tolly', 'residents-lineup', 960, 100, 215, 810],
  ['passenger_a', 'residents-lineup', 1160, 160, 215, 750],
  ['passenger_b', 'residents-lineup', 1370, 270, 166, 630],
  ['collector', 'enemies-lineup', 110, 80, 290, 900],
  ['press_champion', 'enemies-lineup', 440, 150, 500, 850],
  ['crown_zero', 'enemies-lineup', 1010, 60, 450, 950],
  ['goggles', 'props-machines', 6, 6, 500, 470],
  ['amp', 'props-machines', 760, 230, 240, 250],
  ['punch', 'props-machines', 1180, 20, 340, 440],
  ['punch_clock', 'props-machines', 6, 492, 500, 526],
  ['roll_press', 'props-machines', 520, 492, 500, 526],
  ['crown_lathe', 'props-machines', 1030, 492, 500, 526],
];

for (const [name, sheet, left, top, width, height] of CROPS) {
  const img = sharp(`${SRC}/${sheet}.webp`).extract({ left, top, width, height });
  const { data, info } = await img.clone().raw().toBuffer({ resolveWithObject: true });
  const bg = { r: data[0], g: data[1], b: data[2] }; // top-left pixel = sheet background
  const side = Math.max(info.width, info.height) + 40;
  // sharp resizes before it extends, so pad in one pass and scale in a second
  const padded = await img
    .extend({
      top: Math.floor((side - info.height) / 2),
      bottom: Math.ceil((side - info.height) / 2),
      left: Math.floor((side - info.width) / 2),
      right: Math.ceil((side - info.width) / 2),
      background: bg,
    })
    .png()
    .toBuffer();
  await sharp(padded).resize(1024, 1024, { kernel: 'lanczos3' }).png().toFile(`${OUT}/${name}.png`);
}
// contact sheet for a quick look
const names = CROPS.map((c) => c[0]);
const tiles = await Promise.all(
  names.map((n) => sharp(`${OUT}/${n}.png`).resize(256, 256).toBuffer()),
);
await sharp({ create: { width: 256 * 8, height: 256 * 2, channels: 3, background: '#000' } })
  .composite(
    tiles.map((input, i) => ({ input, left: (i % 8) * 256, top: Math.floor(i / 8) * 256 })),
  )
  .jpeg()
  .toFile(`${OUT}/_contact.jpg`);
console.log(`cropped ${names.length} references → ${OUT}`);
