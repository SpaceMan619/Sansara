# Sansara

Sansara is a browser-based collection of small, walkable 3D realities. It is built around a simple promise: enter a place, look around, and let the atmosphere do the talking.

**Current release: v0.4.0 — Dreamloom**

[Open the live build](https://spaceman619.github.io/Sansara/) · [Project Future](https://projectfuture.co.za)

## What is here

`rooms.html` is the main experience. Hold **Tab** to open the world selector, use **← / →** to move between cards, and release **Tab** to enter the selected room. Mouse selection works when the selector is opened with the pointer. **WASD** moves, **Shift** runs, **Space** jumps, and the mouse looks around after the scene has focus.

The selector, loading screen, and world-to-world transition share one short blue-and-white atmosphere loop. The goal is continuity: changing realities should feel like one gesture, not a page change.

### The worlds

| Place | Character | Notes |
| --- | --- | --- |
| **Dune** | Yes | Procedural desert village built from a height-profiled terrain and modular houses. |
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

The pages load models and modules, so serve the directory instead of opening files directly:

```bash
python3 -m http.server 8642
```

Then open <http://127.0.0.1:8642/>.

## Development notes

The project is intentionally plain: static HTML, ES modules, Three.js, and a small set of scene modules in `app/rooms/`. There is no build step to hide the work.

- `rooms.html` owns the shared controller, selector, loading states, dev mode, FPS tracker, and scene handoff.
- `app/rooms/dune.js` and `app/rooms/level0.js` generate procedural environments.
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

Project code is MIT licensed. Third-party assets retain their own licenses.

## Direction

Sansara is a prototype for accessible, authored spaces first. The longer-term direction is documented outside the codebase in the local **Sansaara Future Plan** folder: a design direction, a technical path toward photoreal browser scenes, and a staged roadmap for turning the demo into a world-model playground without losing its restraint.
