// Builds the shipped F-22 derivatives from the credited Sketchfab source.
//
//   npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions \
//         meshoptimizer sharp
//   node tools/build-aircraft.mjs <src.glb> <out.glb> <base> <detail> <thresholdDb> <quality> [ratio]
//
// Shipped builds (src = dark-snow aircraft pipeline, source/original.glb):
//   low       ... 256 512  32 80 0.25
//   balanced  ... 512 1024 32 82         (no ratio: geometry untouched)
//
// Two ideas here, both aimed at spending bytes only where they show up.
//
// Textures are sized per image rather than flat across the set. A flat downscale
// wastes resolution on the airframe's smooth painted panels while still ruining
// the landing gear tread. Each texture is downscaled, scaled back up and scored
// against the original; only the ones that actually lose detail keep the bigger
// size.
//
// Geometry is decimated only for the low tier, which is what makes the tiers
// real LODs instead of the same mesh with different textures.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , SRC, DST, BASE, DETAIL, THRESH, QUALITY, RATIO] = process.argv;
const base = +BASE, detail = +DETAIL, thresh = +THRESH, quality = +QUALITY;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(dedup(), prune());

// PSNR of a base-size round trip. Low score means base cannot represent this
// texture, so it earns the larger size.
async function detailScore(buf, w, h) {
  const full = await sharp(buf).removeAlpha().raw().toBuffer();
  // Two pipelines: sharp applies only the last resize() in a chain, so the
  // round trip has to pass through a real buffer.
  const small = await sharp(buf).resize(base, base, { fit: 'fill' }).png().toBuffer();
  const trip = await sharp(small).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let se = 0;
  for (let i = 0; i < full.length; i++) { const d = full[i] - trip[i]; se += d * d; }
  const mse = se / full.length;
  return mse < 1e-9 ? 99 : 10 * Math.log10(65025 / mse);
}

let promoted = 0, total = 0;
for (const tex of doc.getRoot().listTextures()) {
  const img = tex.getImage();
  if (!img) continue;
  const meta = await sharp(img).metadata();
  if (!meta.width || meta.width < base) continue;
  total++;
  const size = (await detailScore(img, meta.width, meta.height)) < thresh ? detail : base;
  if (size === detail) promoted++;
  // Promoted textures are the high-frequency ones, which is exactly what WebP
  // spends bits on. There are few enough of them that a better quality floor
  // costs very little.
  const q = size === detail ? Math.min(96, quality + 12) : quality;
  tex.setImage(await sharp(img).resize(size, size, { fit: 'fill' }).webp({ quality: q }).toBuffer())
     .setMimeType('image/webp');
}
console.log(`textures: ${promoted}/${total} kept at ${detail}px, rest at ${base}px`);

const triangles = () => doc.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

await doc.transform(weld());
if (RATIO) {
  const before = triangles();
  await MeshoptSimplifier.ready;
  // lockBorder pins open-mesh boundaries. On a hard-surface model those borders
  // are the panel seams, and letting them drift is what makes a decimated
  // aircraft look melted.
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: +RATIO, error: 0.005, lockBorder: true }));
  console.log(`geometry: ${before.toLocaleString()} -> ${triangles().toLocaleString()} triangles`);
}
await doc.transform(quantize());
await io.write(DST, doc);
