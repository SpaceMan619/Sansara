# Pipeline notes

Commands assume Blender is installed at the macOS default path and the repo root is the working
directory.

```bash
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
```

## 1. Static GLB → Mixamo-ready FBX

Mixamo does not accept GLB, so the mesh is converted with textures embedded.

```bash
$BLENDER --background --python scripts/glb_to_fbx.py -- \
  source/minimal-scifi-sikh.glb output/character.fbx
```

## 2. Rig on Mixamo (manual)

Upload `output/character.fbx`, place the auto-rigger markers (chin, wrists, elbows, knees, groin),
and pick the **No Fingers (25)** skeleton — plenty for a game avatar and cheaper to animate.

Download, all as **FBX Binary**:

- the rigged character in T-pose, **with skin**
- each animation clip **without skin** (skeleton keyframes only, a few hundred KB each instead of
  re-bundling the mesh every time)

## 3. Merge clips into one GLB

```bash
$BLENDER --background --python scripts/merge_animations.py -- \
  ~/Downloads/Walking.fbx \
  output/raw.glb \
  source/minimal-scifi-sikh.glb \
  "Walk=$HOME/Downloads/Walking.fbx" \
  "Run=$HOME/Downloads/Fast Run.fbx" \
  "Jump=$HOME/Downloads/Jump.fbx" \
  "Dance=$HOME/Downloads/Hip Hop Dancing.fbx"
```

Each clip becomes an NLA track, which the glTF exporter emits as a separate named animation. Clip
names matter — Three.js looks them up by name. The original GLB is passed in so its material can be
re-bound; FBX round-trips frequently lose textures.

## 4. Strip root motion

```bash
python3 scripts/inplace_root_motion.py output/raw.glb \
  output/minimal-scifi-sikh-animated.glb --flatten-vertical Jump Land
```

Horizontal Hips translation is flattened for every clip. `Jump` and `Land` also have their vertical
channels flattened, because the controller owns the jump arc and floor contact — leaving either
channel in place makes the character float or double-jump when animation and physics add together.

Verify:

```bash
python3 - <<'EOF'
import struct, json
d = open('output/minimal-scifi-sikh-animated.glb','rb').read()
n, _ = struct.unpack('<II', d[12:20])
g = json.loads(d[20:20+n])
print([a['name'] for a in g['animations']])
EOF
```

## Grounding a skinned character

`Box3.setFromObject` measures a `SkinnedMesh` using its **bind-pose geometry**, not the posed
result. For this rig the bind geometry is centred on the armature origin, so using that box to
place the feet lifts the model half a body height into the air.

Two things fix it:

1. Measure the posed silhouette with `applyBoneTransform` per vertex (once, at load) for scaling.
2. Each frame, find the lowest foot bone and nudge the model down so the planted foot touches the
   ground — only while grounded, since mid-air the jump arc owns the height.

## Terrain height queries

The ground query samples the same height grid the terrain mesh was built from, using the exact
triangle split `PlaneGeometry` uses, rather than re-evaluating the noise function. The rendered
surface is a linear interpolation between grid vertices, so on a crest the analytic value sits
above the visible triangle and the character hovers.

## Debugging the animation loop

Three.js re-requests the animation frame **after** the callback returns, so a single exception
inside the loop kills it permanently and the world silently freezes on its last frame. `world.html`
wraps the callback and reports failures in the HUD.

`window.__world` exposes `pos`, `vel`, `probe()` and `step()` for inspection from the console.
Note that `requestAnimationFrame` is throttled when the tab is in the background, so a stalled fps
counter does not necessarily mean the loop has crashed — `step()` drives single frames by hand.

## Matching animation speed to movement

A clip's real ground speed is its Hips travel divided by its duration — but the Hips channel is
authored in rig units, roughly 100x the mesh units, because Mixamo exports centimetres. Converting
with the *mesh* scale overestimates the clip speed by ~100x, which pins `timeScale` to its floor and
makes the run animation crawl while the body sprints.

Read the conversion factor off the rig instead, so it can't drift:

```js
hips.parent.getWorldScale(v);           // accumulated armature scale
nominal = CLIP_TRAVEL[name] * v.x / clip.duration;
```

Measured for this character: walk 1.47 u/s, run 4.86 u/s. Those become the default body speeds, so
the feet plant at playback rate 1.0.

## Animation state should follow input, not speed

Choosing the clip from measured speed means slope drag, a wall, or the first frames of acceleration
can drop below the threshold and flip the character to idle while a key is still held. Branch on the
input vector instead, and use measured speed only for `timeScale`.

## Jump timing

Mixamo's Jump clip crouches before the body leaves the ground. Its authored takeoff pose sits around
0.42 s, but waiting that long feels unresponsive, so the anticipation is time-compressed into a
0.12 s windup and the physics impulse fires on that exact boundary. The airborne portion is scaled
to the controller's calculated flight time, then the same Jump clip continues from its authored
contact frame through a short 0.24 s recovery. The unrelated `Hard Landing` clip is not blended in.

## Quaternius Universal Animation Library

The downloaded Standard pack contains 43 clips at 30 fps in both root-motion and non-root-motion
exports. Use `UAL1_Standard.glb` for Sansara: the browser controller owns translation and collision.
The pack's 65-bone Quaternius rig is not track-name compatible with the avatar's 46-bone Mixamo
rig, so clips cannot be attached directly in Three.js. A Blender retarget must first calibrate the
two rest poses and bake the result onto `mixamorig:*` bones; a semantic name map alone visibly
twists shoulders and limbs. Validate every retarget in the animation viewer before it is merged
into the production GLB.
