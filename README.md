# Sansara

A running notebook of 3D / Three.js experiments — rigging, procedural worlds, character
controllers, and whatever else is worth trying next. Each experiment stays in the repo so the
progression is visible over time rather than getting overwritten.

**▶ Live: <https://spaceman619.github.io/Sansara/>** — no install, works in any browser.

To run locally instead, serve the folder (the pages fetch models, so `file://` won't work):

```bash
python3 -m http.server 8642
```

Then visit <http://localhost:8642/>.

---

## Experiments

### Liminal Rooms (`rooms.html`) — the whole thing

Six rooms, one character, one page. Two are built procedurally at load (`app/rooms/*.js`), four are
artist-made scenes that get collision inferred from their geometry. Hold **Tab** to travel.

### 01 — Dune (procedural)

A procedurally generated desert with a rigged, animated character you can walk, run and jump
around a desert village.

- **Terrain** — dunes built from an asymmetric height profile: a long windward climb and a short
  steep slipface, domain-warped so the ridge lines meander. A smoothed basin flattens the ground
  where the village sits.
- **Character** — a static GLB rigged through Mixamo, with Walk / Run / Jump / Dance clips merged
  into a single game-ready GLB.
- **Controller** — velocity based, with acceleration and friction, camera-relative input, coyote
  time, jump buffering and slope drag. Animation state is driven by *input*, not measured speed,
  so holding a key always walks even when drag or a wall has killed the velocity.
- **Animation sync** — each clip's true stride speed is derived from its Hips travel and used both
  to set the body's default speed and to scale playback, so the feet plant instead of skating. The
  Jump clip crouches for 0.33 s before leaving the ground, and the impulse waits for it.
- **Tuning panel** — hidden by default; type `dev` to fade it in. Sliders for every value the feel
  depends on (speeds, accel, gravity, jump power and windup, turn rate, camera) plus a
  **Copy to clipboard** button that emits a paste-ready `TUNE { … }` block, so a feel that works can
  be pasted straight back in as the new defaults. `Esc`, `×` or `dev` again closes it.
- **Grounding** — the planted foot is pinned to the sand every frame by measuring the lowest foot
  bone, which is what actually keeps a skinned character on the floor (see the pipeline notes).
- **Performance** — the whole scene runs in ~50 draw calls: props are drawn with `InstancedMesh`,
  there is exactly one shadow-casting light with a tight frustum that follows the player, and
  there is no post-processing. It targets a comfortable 60 fps on a fanless MacBook Air.

### 02 — Backrooms, Level 0 (`backrooms.html`)

A procedurally carved office maze with 7.5 m ceilings, walked by the same rigged character.

- **Layout** — a random walk with long straight runs, not a perfect maze: Level 0 should read as a
  badly-partitioned office floor with dead ends and rooms opening into rooms, not a puzzle.
- **Textures** — wallpaper, carpet and ceiling tiles are all drawn on a `<canvas>` at load, so the
  page pulls down nothing but Three.js itself.
- **Lighting** — emissive ceiling panels everywhere give the look for free, while a pool of seven
  real point lights follows the player so only nearby fixtures cost anything. One of them buzzes.
- **Collision** — axis-separated grid checks, so you slide along walls instead of sticking to them.

### 03 — Liminal Rooms (`rooms.html`)

Four artist-made scenes made walkable with the same rigged character, switchable in-page.

- **Baked vs lit** — pre-lit scenes are forced to unlit materials, which reproduces the artist's
  light exactly and skips lighting math entirely. Adding real lights on top of baked light gives you
  two sets of shadows and washes the result out. Because an unlit room ignores lights, ordinary
  lights can be added for the character alone — no layer masking needed.
- **Inferred collision** — none of these scenes ship collision data, so it's rasterised from the
  triangles at load: horizontal faces become floor heights, vertical faces become blockers wherever
  they cross knee-to-head height. Runtime cost is an array lookup, not a raycast against 350k
  triangles.
- **Dominant floor detection** — a histogram of surface heights picks the level covering the most
  area, and each cell takes the surface nearest it. Taking the lowest face instead puts the player
  at the bottom of the pool rather than on the deck around it.
- **Grounding in baked rooms** — a baked scene can't receive a real shadow, so a soft blob under the
  feet keeps the character from looking pasted on.

Heaviest scene runs 62 fps at 8 draw calls on 346k triangles.

### 04 — Animation viewer (`viewer.html`)

A minimal page for stepping through each animation clip on the rigged character in isolation.

---

## The rigging pipeline

The character started as a single static mesh with no skeleton. Turning it into a game-ready
animated avatar takes four steps, three of which are scripted:

| Step | Tool | Script |
| --- | --- | --- |
| 1. Convert GLB → FBX | Blender (headless) | `scripts/glb_to_fbx.py` |
| 2. Auto-rig + download clips | Mixamo (manual) | — |
| 3. Merge clips into one GLB | Blender (headless) | `scripts/merge_animations.py` |
| 4. Make clips in-place | Python (no Blender) | `scripts/inplace_root_motion.py` |

Eight clips ship today: `Idle`, `HappyIdle`, `Walk`, `Run`, `Jump`, `Land`, `Dance`, `Moonwalk`.

Step 4 exists because Mixamo clips downloaded without "In Place" carry root motion — the Walk clip
travels ~85 units forward over one cycle. The game drives horizontal position itself, so that
travel fights the controller. The script flattens the Hips' horizontal translation in the exported
GLB, where the axes are unambiguous, and keeps the vertical bob.

`scripts/assemble_houses.py` builds the village houses by snapping modular kit pieces together and
rendering a preview of each, so the results can be checked without opening Blender.

Full commands are in [docs/pipeline.md](docs/pipeline.md).

---

## Credits & licensing

- **Environment art** — [Kenney](https://kenney.nl) Fantasy Town Kit and Nature Kit, both CC0.
  Original license files are kept alongside the models in `assets/`.
- **Backrooms VR** scene by [carlcapu9](https://sketchfab.com/carlcapu9), licensed
  **CC Attribution** — used in the Liminal Rooms experiment.
- **Character mesh** — generated with [mint.gg](https://mint.gg).
- **Animation clips** — [Mixamo](https://www.mixamo.com) (Adobe).
- **Engine** — [Three.js](https://threejs.org).

Code in this repository is MIT licensed. The third-party assets keep their own licenses.
