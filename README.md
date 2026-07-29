# Sansara

A running notebook of 3D / Three.js experiments — rigging, procedural worlds, character
controllers, and whatever else is worth trying next. Each experiment stays in the repo so the
progression is visible over time rather than getting overwritten.

**Live experiments:** open `index.html` (or serve the folder and browse to it).

```bash
python3 -m http.server 8642
```

Then visit <http://localhost:8642/>.

---

## Experiments

### 01 — Dune World (`world.html`)

A procedurally generated desert with a rigged, animated character you can walk, run and jump
around a desert village.

- **Terrain** — dunes built from an asymmetric height profile: a long windward climb and a short
  steep slipface, domain-warped so the ridge lines meander. A smoothed basin flattens the ground
  where the village sits.
- **Character** — a static GLB rigged through Mixamo, with Walk / Run / Jump / Dance clips merged
  into a single game-ready GLB.
- **Controller** — velocity based, with acceleration and friction, camera-relative input, coyote
  time, jump buffering, slope drag, and animation playback matched to real ground speed so the
  feet don't skate.
- **Grounding** — the planted foot is pinned to the sand every frame by measuring the lowest foot
  bone, which is what actually keeps a skinned character on the floor (see the pipeline notes).
- **Performance** — the whole scene runs in ~50 draw calls: props are drawn with `InstancedMesh`,
  there is exactly one shadow-casting light with a tight frustum that follows the player, and
  there is no post-processing. It targets a comfortable 60 fps on a fanless MacBook Air.

### 02 — Animation viewer (`viewer.html`)

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
- **Character mesh** — generated with [mint.gg](https://mint.gg).
- **Animation clips** — [Mixamo](https://www.mixamo.com) (Adobe).
- **Engine** — [Three.js](https://threejs.org).

Code in this repository is MIT licensed. The third-party assets keep their own licenses.
