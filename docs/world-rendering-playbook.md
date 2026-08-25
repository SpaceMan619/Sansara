# Sansara world rendering playbook

This file records the rules that should survive individual demos. It exists because a beautiful screenshot can hide a bad renderer, and a fast renderer can still produce a broken world.

## What the million-tree thread teaches us

SimonDev's [Three.js optimisation thread](https://x.com/iced_coffee_dev/status/2018733229818380315) uses forests as its example, but the method applies to rooms, towns, traffic, aircraft, props, particles and generated worlds.

The headline tree counts are examples from one scene, not Sansara targets. The useful part is the order of work:

1. Measure CPU and GPU time separately. A low frame rate doesn't tell us which side is late.
2. Cut draw calls before chasing tiny shader savings. Reuse geometry and materials; instance repeated meshes and batch mixed geometry where the engine supports it.
3. Reduce material changes. Atlas textures when several small materials can share one surface description.
4. Shrink what reaches the GPU. Weld duplicate vertices, simplify distant meshes, quantise vertex data and transcode textures for the runtime.
5. Stop submitting invisible objects. Frustum-cull spatial chunks, then add per-instance or occlusion culling only when measurement proves it pays for itself.
6. Change representation with distance. Keep separate instance pools for each LOD and use impostors for objects that have become silhouettes.

Instancing doesn't make geometry free; it removes repeated CPU submission. Texture compression can reduce download size while leaving decode or GPU memory expensive, so network bytes, decoded texture memory and frame time must be measured separately.

## The Sansara asset path

Keep downloaded source files untouched. Build runtime copies from them.

| Stage | What we keep | What we change |
| --- | --- | --- |
| Source | Original GLB, Blender file, textures, licence and author link | Nothing |
| High | Full silhouette, 2K textures where the source warrants them | Weld, quantise, remove unused data, KTX2 |
| Balanced | Same important silhouette | Moderate mesh simplification, 1K textures, fewer materials |
| Low | Recognisable shape and animation | Stronger simplification, 512px textures, merged materials where safe |

Repeated scenery should share geometry and materials. Split large populations into world cells so culling can reject a cell without inspecting every prop. One giant instance set saves calls but defeats local culling; thousands of separate meshes do the opposite. We need both batching and spatial boundaries.

## Procedural-world rules

Rendering, collision and water must query the same deterministic world field. If the visible terrain and physics sample different functions, aircraft float, wheels sink and resets place players below the surface.

Water only gets geometry where a river, lake or ocean exists. Never hide a world-sized plane under terrain and hope the ground always covers it. A missing triangle then becomes a flood, exactly as it did in Pale Horizon.

Every generated mesh must pass these checks before visual tuning:

- index bounds and triangle winding;
- finite positions, normals and colours;
- matching vertices along chunk seams;
- bounded neighbouring height changes at the render grid spacing;
- dry spawn and runway zones;
- recenter tests at the origin and several far coordinates;
- an above-ground view with back-face culling enabled.

For truly large flight worlds, use nested regular grids rather than one dense plane. NVIDIA's [geometry clipmap method](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry) keeps fine geometry near the camera, hollow coarse rings farther away and morphs transition bands so levels don't crack. Fixed reusable blocks also keep vertex indices small and make frustum culling cheap. Three.js has an official [procedural WebGPU terrain example](https://threejs.org/examples/webgpu_tsl_procedural_terrain.html) worth using as a visual and implementation reference; the same world-field rules apply if a demo remains on Babylon.

Water rendering comes after water placement works. Reflection, refraction, normals and foam can't rescue a lake that appears under a runway. Three.js's official [WaterMesh](https://threejs.org/docs/pages/WaterMesh.html) is a useful reference for the surface pass, not for deciding where the water belongs.

## What WorldClaw adds

[Hunyuan3D WorldClaw](https://tencent-hunyuan.github.io/Hunyuan3D-WorldClaw/) treats a world as a plan before it treats it as a mesh. Its planning agent describes regions, adjacency, scale, terrain, water, materials and object density; later passes generate a continuous terrain field, add local detail and inspect renders for bad placement. The [paper](https://arxiv.org/html/2608.05248) calls out the same failures we keep meeting in browser worlds: abrupt transitions, floating objects, penetration, bad support surfaces and scale errors.

Adopt these parts:

- Write a compact world specification before building. Pale Horizon would define a runway basin, river corridor, mountain belt, coast and distant plateau, including allowed slope and height ranges.
- Store semantic masks beside the height field. Water, material choice, roads, prop scattering, collision and spawn checks should agree on what each coordinate means.
- Spend geometry where the player can inspect it. Airports, villages, shorelines and landmarks get local detail; distant terrain stays continuous and cheap.
- Use fixed diagnostic views and keep revising until they pass. Opening runway, low flight, mountain pass, shoreline, underside, depth, normals and slope heatmap should all be checked.

WorldClaw doesn't provide a browser runtime. Its published workflow depends on Blender, several hosted models and four NVIDIA H20 GPUs; it doesn't supply terrain streaming, controls, LOD code, collision or atmosphere. The [official repository](https://github.com/Tencent-Hunyuan/Hunyuan3D-WorldClaw) currently has no released implementation or software licence, so it is a design reference rather than something Sansara can fork.

## Finding flyable worlds

Search for the terrain system and asset traits, not just “3D world.” Useful queries:

- `photoreal mountain valley open world environment pack PBR LOD`
- `coastal archipelago flight environment glTF GLB`
- `game ready aerial terrain pack real world scale`
- `open world canyon environment 16 bit heightmap splat maps`
- `photogrammetry cliffs rocks vegetation environment pack`
- `Three.js infinite procedural terrain quadtree MIT`
- `WebGL terrain clipmap flight simulator`
- `CesiumJS aircraft World Terrain demo`

Prefer GLB/glTF for assembled browser assets. For large procedural terrain, a 16-bit PNG or RAW heightmap plus splat maps and tileable PBR materials is often better than one giant mesh. Keep KTX2 textures, LOD meshes, collision meshes and real-world scale on the asset checklist.

[Sketchfab](https://sketchfab.com/) works well when **Downloadable** and **CC0/CC BY** filters are set. [Fab](https://www.fab.com/) has larger environment packs, but each listing needs a licence and source-file check. [Poly Haven](https://polyhaven.com/) supplies CC0 HDRIs, rocks and surface materials rather than complete worlds. If the target is real Earth rather than a fictional place, [Cesium World Terrain](https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/) already solves global terrain tiling and runtime LOD.

For code references, search GitHub with `license:mit` or `license:apache-2.0` plus `threejs`, `flight-simulator`, `quadtree`, `clipmap` or `procedural-terrain`. [ThreeFlightSimulator](https://github.com/PierreEVEN/ThreeFlightSimulator) is a relevant MIT example with infinite procedural terrain, a quadtree, atmospheric scattering and foliage impostors.

Skip giant merged cinematic scenes when we need landing collision. Unreal-only Nanite packages without source meshes are a bad fit for the browser, and Gaussian-splat scenes aren't suitable when an aircraft must touch a precise runway or terrain surface.

## A world earns its selector card

A new world stays in the lab until it passes four gates:

- **Identity:** one sentence explains what the player does and why this place belongs in Sansara.
- **Correctness:** no holes, detached asset parts, broken collisions, stuck controls or contradictory UI.
- **Frame:** record load time, CPU frame time, GPU frame time, draw calls, triangles and decoded texture memory on the target Mac and Safari build.
- **Exit:** Tab returns to the shared selector, settings reset works and the world can recover from a crash or bad spawn.

Photorealism comes after those gates. Dark Snow works because its light, atmosphere, terrain response and camera agree with one another; copying only its sun shader won't make another world feel equally convincing.

## Current stop rule

After the Pale Horizon repair, don't add another public world until the landing page, selector, Dark Snow and Pale Horizon each have recorded budgets and a short browser acceptance run. New ideas can live under `experiments/` without appearing in the main selector.
