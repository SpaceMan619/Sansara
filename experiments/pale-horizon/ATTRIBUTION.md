# Aircraft attribution

“F-22 Raptor Free” by NLM, downloaded from Sketchfab:
https://sketchfab.com/3d-models/f22-raptor-free-2a64abf0866a405c865466c7642ca689

License: Creative Commons Attribution 4.0 International (CC BY 4.0)
https://creativecommons.org/licenses/by/4.0/

CC BY 4.0 permits modification, so the shipped files are derivatives of the
original, not the original itself. Both were produced from the unmodified
Sketchfab GLB (SHA-256
`7e2e7b06d4ef474cee47ad6d92f7f8bd0e6375ba0b265a5f95d08842a1050ed5`) by
re-encoding the 2048x2048 PNG texture set to WebP, welding vertices and applying
`KHR_mesh_quantization`. The low tier is additionally decimated; the balanced
tier keeps the source geometry intact.

Texture resolution is chosen per image rather than flat across the set. Each one
is downscaled, scaled back up and compared against the original; textures that
lose real detail (mostly landing gear tread, which is dense high-frequency
pattern) keep the larger size, and the flat painted airframe panels take the
smaller one.

The low tier's mesh is decimated from 86,558 to 29,488 triangles with
meshoptimizer, borders locked so panel seams hold their shape. All 84 meshes
survive; none were dropped or collapsed away.

Both are reproducible via `tools/build-aircraft.mjs` — see its header for the
exact arguments used for each tier.

- `public/models/f22-low.glb` — 256px textures (512px where detail warrants), decimated mesh
  SHA-256: `dc23977072a8f31feeb8252c906bc8515ea0fabe8d048b7aa164cc88a815a8fc`
- `public/models/f22-balanced.glb` — 512px textures, 1024px where detail warrants it
  SHA-256: `ec7925217aecb350955a2a9443db96eee7d32d356ca0a7bf50c0457da779cc54`
