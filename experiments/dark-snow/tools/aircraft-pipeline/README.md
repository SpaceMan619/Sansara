# Sansara aircraft ingestion

This local tool keeps official downloads untouched and converts glTF aircraft into three GLB runtime tiers. It accepts an exact path to either an official GLB or an official ZIP. A ZIP may contain a GLB, or a `.gltf` scene with external `.bin` buffers and texture files.

## Setup and read-only check

```sh
cd /Users/pegasus/sikh-avatar/experiments/dark-snow/tools/aircraft-pipeline
npm ci
npm run dry-run -- --input /Users/pegasus/Downloads/f22_raptor_free.glb
```

The dry run prints the chosen input and checks Node, glTF-Transform, Sharp (installed through glTF-Transform), and `unzip`. It creates no asset directories. If a ZIP contains several `.glb` or `.gltf` scenes, add `--entry path/in/archive/scene.gltf`; the tool refuses to guess.

## Ingest NLM's F22

```sh
npm run ingest -- \
  --input /Users/pegasus/Downloads/f22_raptor_free.glb \
  --slug nlm-f22-raptor \
  --metadata ./presets/nlm-f22.json

npm run validate -- \
  --manifest ../../public/vehicles/aircraft/nlm-f22-raptor/manifest.json
```

The source copy keeps the input bytes and SHA-256. The tool writes into a temporary sibling directory and renames it only after all tiers pass inspection; it refuses to overwrite an existing aircraft directory.

Texture resizing uses glTF-Transform 4.4.2 and Sharp. High caps texture width and height at 2048 px, balanced at 1024, and low at 512. Smaller textures remain unchanged. The pass deliberately avoids geometry compression, mesh joining, pruning, quantization, or WebP/KTX2 conversion because those choices can alter part topology or add browser decoder requirements. KTX-Software (`toktx`) and Blender aren't required for this pipeline.

`manifest.json` records output URLs and hashes, actual texture dimensions, animation targets, named nodes, required extensions, and a structural fingerprint. Validation reloads every GLB with glTF-Transform, checks hashes and texture ceilings, then confirms that hierarchy, names, skin counts, animation channels, material texture bindings, and extension requirements still match the source.

NLM's preset starts at `pending-package-inspection`. A successful ingest records `package-inspected` in the copied provenance and manifest; the preset stays pending so it never claims that some future download has already passed inspection. The pipeline doesn't infer control-surface names from aircraft terminology.
