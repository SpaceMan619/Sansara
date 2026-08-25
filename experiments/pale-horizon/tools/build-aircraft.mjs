// Builds the shipped F-22 derivatives from the credited Sketchfab source.
//
//   npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions sharp
//   node tools/build-aircraft.mjs <source.glb> <out.glb> <baseSize> <detailSize> <thresholdDb> <webpQuality>
//
// Shipped builds (source: dark-snow aircraft pipeline, source/original.glb):
//   low       ... 256 512 32 80
//   balanced  ... 512 1024 32 82
//
// Texture size is picked per image instead of flat across the set. A flat
// downscale wastes bytes on the airframe's smooth painted panels while still
// destroying the landing gear tread. Measuring each texture first spends the
// budget only where it buys something.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';

const [,, SRC, DST, BASE_S, DETAIL_S, THRESH_DB, QUALITY] = process.argv;
const base = +BASE_S, detail = +DETAIL_S, thresh = +THRESH_DB, quality = +QUALITY;

// ALL_EXTENSIONS or KHR_materials_specular/transmission get silently dropped,
// which would change how the airframe reads.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(dedup(), prune());

// PSNR between the full-res image and a base-res round trip. Low score means the
// texture carries detail that `base` cannot represent, so it earns the bigger size.
async function detailScore(buf, w, h) {
  const full = await sharp(buf).removeAlpha().raw().toBuffer();
  // Two separate pipelines: sharp applies only the last resize() in a chain,
  // so downscale-then-upscale has to round trip through a real buffer.
  const small = await sharp(buf).resize(base, base, { fit: 'fill' }).png().toBuffer();
  const trip = await sharp(small).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let se = 0;
  for (let i = 0; i < full.length; i++) { const d = full[i] - trip[i]; se += d * d; }
  const mse = se / full.length;
  return mse < 1e-9 ? 99 : 10 * Math.log10(255 * 255 / mse);
}

let promoted = 0, total = 0;
for (const tex of doc.getRoot().listTextures()) {
  const img = tex.getImage(); if (!img) continue;
  const meta = await sharp(img).metadata();
  if (!meta.width || meta.width < base) continue;
  total++;
  const score = await detailScore(img, meta.width, meta.height);
  const size = score < thresh ? detail : base;
  if (size === detail) promoted++;
  console.log(`  tex ${total}: ${meta.width}px score=${score.toFixed(1)} dB -> ${size}px`);
  // Promoted textures are the high-frequency ones, which is exactly what WebP
  // spends bits on. Giving them a better quality floor costs very little here
  // because there are only a handful of them.
  const q = size === detail ? Math.min(96, quality + 12) : quality;
  const out = await sharp(img).resize(size, size, { fit: 'fill' }).webp({ quality: q }).toBuffer();
  tex.setImage(out).setMimeType('image/webp');
}
console.log(`${promoted}/${total} textures kept at ${detail}px, rest at ${base}px`);
await doc.transform(weld(), quantize());
await io.write(DST, doc);
