# Sansara

Sansara is a browser-based collection of small, walkable 3D realities. It is built around a simple promise: enter a place, look around, and let the atmosphere do the talking.

**Current release: v0.5.1 — Dark Snow**

[Open the live build](https://spaceman619.github.io/Sansara/) · [Project Future](https://projectfuture.co.za)

## What is here

`rooms.html` is the main experience. Hold **Tab** to open the world selector, use **← / →** to move between cards, and release **Tab** to enter the selected room. Mouse selection works when the selector is opened with the pointer. **WASD** moves, **Shift** runs, **Space** jumps, and the mouse looks around after the scene has focus. In Dark Snow, hold **Space** or the right mouse button to accelerate into snow-surf mode; **F1** opens its complete renderer settings.

The selector, loading screen, and world-to-world transition share one short blue-and-white atmosphere loop. The goal is continuity: changing realities should feel like one gesture, not a page change.

### The worlds

| Place | Character | Notes |
| --- | --- | --- |
| **Dune** | Yes | Procedural desert village built from a height-profiled terrain and modular houses. |
| **Dark Snow** | Yes | The Babylon/WebGPU reality-lab fork: procedural terrain, a low sun, cascaded shadows, atmospheric LUTs, deformation, and a complete settings console. |
| **Level 0** | Yes | Procedural yellow office maze with generated materials and localised lights. |
| **The Lobby** | Yes | Artist-made baked scene with inferred floor and wall collision. |
| **The Room** | Yes | Afternoon liminal room; available in the local build. |
| **The Pool** | Yes | Cycles-baked pool room rendered mostly unlit so the bounce lighting survives. |
| **The Hill** | Yes | Dreamcore landscape with live atmospheric lighting. |

`rooms.html` hides locally restricted scenes from the hosted build while keeping them available for local development.

`viewer.html` is the animation test bench. It loads the same avatar and exposes the current clips without the world controller around them.

## Why the project feels the way it does

- **Quiet interface:** one clear action, short copy, and transitions that do not compete with the worlds.
- **Soft reality:** pale glass, blue-white motion, serif and script typography, and restrained contrast create a dreamlike threshold.
- **Immediate movement:** acceleration, deceleration, jump anticipation, landing hold, camera follow, and animation playback are tuned together rather than as separate sliders.
- **Accessible 3D:** the experience stays on the web so the first step is a link, not an engine install.

## Run it locally

The entire experience—including Dark Snow—runs from one static server:

```bash
npm start
```

Then open <http://127.0.0.1:8642/>.

## Development notes

The project remains mostly plain static HTML, ES modules, Three.js, and a small set of scene modules in `app/rooms/`. Dark Snow's Babylon/WebGPU source is compiled into the same deployable site with one command: `npm run build`.

- `rooms.html` owns the shared controller, selector, loading states, dev mode, FPS tracker, and scene handoff.
- `app/rooms/dune.js` and `app/rooms/level0.js` generate procedural environments.
- `experiments/dark-snow/` is the complete MIT-licensed Snowflow fork used by the Dark Snow selector card. Its built entrypoint includes the WebGPU renderer, settings overlay, performance graph, post chain, character, terrain deformation, and spells.
- `scripts/bake_lighting.py` bakes Cycles lighting into scene textures for rooms that need a fixed atmosphere.
- `scripts/inplace_root_motion.py` removes unwanted horizontal root travel from animation exports.
- `scripts/assemble_houses.py` builds the Dune village from modular pieces.
- `docs/pipeline.md` records the asset and rigging pipeline.

Type **dev** in a room to open the development panel. It exposes movement, camera, lighting, fog, exposure, asset quality, and character scale. The panel is deliberately absent from normal play.

## Animation

The current avatar includes `Idle`, `HappyIdle`, `Walk`, `Run`, `Jump`, `Land`, `Dance`, and `Moonwalk`. Grounding offsets are sampled from skinned vertices, jump and land inherit the calibrated grounded offset, and animation rate follows authored stride data where available.

The next locomotion pass will use the **Universal Animation Library** from [Quaternius](https://quaternius.itch.io/universal-animation-library). Its CC0 license makes it suitable for personal, educational, and commercial work; the project will keep the source credit visible in the asset notes.

## Credits and licensing

- Environment kits: [Kenney](https://kenney.nl), CC0.
- Backrooms VR: [carlcapu9](https://sketchfab.com/carlcapu9), CC Attribution.
- VR Liminal Room: [abhayexe](https://sketchfab.com/3d-models/vr-liminal-room-baked-826fc238e9d443c9b801e35cc831ff14), Sketchfab Standard.
- Pool room: [gatgat](https://sketchfab.com/3d-models/liminal-pool-room-13ab767a3b8d409a8a3cf31fff76d62b), CC Attribution.
- Dreamcore landscape: [CatLoveCheese](https://sketchfab.com/3d-models/dreamcore-liminal-space-875b0005014d4b42bf1e9b2ff53ed4c4), CC Attribution.
- Character mesh: [mint.gg](https://mint.gg).
- Current animation clips: [Mixamo](https://www.mixamo.com).
- Upcoming animation library: [Quaternius](https://quaternius.itch.io/universal-animation-library), CC0; special thanks to [Gonzalo Furnier](https://x.com/Gonzalo_Anim).
- Landing atmosphere video: [Gasendra Jr.](https://www.youtube.com/watch?v=e1AHGiHaeJc).
- Procedural rendering reference: [Snowflow Demo](https://github.com/Noniv/snowflow_demo) by Noniv, MIT licensed. Dune 2.0 ports its material, atmosphere, and persistent-deformation ideas into Sansara’s Three.js runtime; the source remains an independent WebGPU/Babylon reference.

Project code is MIT licensed. Third-party assets retain their own licenses.

## Direction

Sansara is a prototype for accessible, authored spaces first. The longer-term direction is documented outside the codebase in the local **Sansaara Future Plan** folder: a design direction, a technical path toward photoreal browser scenes, and a staged roadmap for turning the demo into a world-model playground without losing its restraint.

## Branch study: futures, game types, and experiments

### Futures already visible in this branch

- **Renderer future:** `dune2` is now framed as **Dark Snow**, with the branch checkpoint aiming to replace the legacy Three.js handoff with the forked Babylon/WebGPU Snowflow path (`PAUSE_CHECKPOINT.md`).
- **Animation future:** the next locomotion pass is planned around Quaternius Universal Animation Library clips (`README.md` Animation section, `docs/pipeline.md`).
- **Pipeline future:** this branch keeps both authored-scene workflows (baked GLB rooms) and procedural generation, so future work can evolve either path without rewriting the selector architecture (`rooms.html`).

### Game types currently supported

- **Procedural exploration:** `dune` and `level0` are generated rooms (`app/rooms/dune.js`, `app/rooms/level0.js`).
- **Authored liminal scenes:** lobby/room/pool/hill are asset-driven worlds with room-level tuning (`rooms.html` `ROOMS` entries).
- **Renderer lab world:** `dark snow` (`dune2`) is used as a rendering and atmosphere experiment track.

### Experiments you can add next with minimal friction

- Add a new **procedural room module** and register it in `ROOMS`.
- Add a new **GLB-authored room** with baked/unlit or live-lit flags and tuning values.
- Ship rough prototypes as **local-only cards** first (`local: true`) before exposing them in hosted builds.
- Add another **external renderer experiment** using the existing room handoff pattern used by `dune2`.
