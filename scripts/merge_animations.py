# Run with: blender --background --python merge_animations.py -- <rigged_tpose.fbx> <out.glb> <orig.glb> Idle=idle.fbx Walk=walk.fbx ...
# Imports the Mixamo-rigged character, appends each clip FBX as a named action,
# re-binds the original GLB material (FBX round-trips often lose textures),
# and exports one game-ready GLB.
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
rigged, out_glb, orig_glb = argv[0], argv[1], argv[2]
clips = dict(a.split("=", 1) for a in argv[3:])

def action_fcurves(action):
    """Yield (container, fcurve) pairs across Blender's action APIs.

    Blender 4.4+ moved F-Curves into layers > strips > channelbags ("slotted
    actions"); older versions expose action.fcurves directly.
    """
    if hasattr(action, 'fcurves') and len(getattr(action, 'fcurves', [])):
        for fc in list(action.fcurves):
            yield action.fcurves, fc
        return
    for layer in getattr(action, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            for bag in getattr(strip, 'channelbags', []):
                for fc in list(bag.fcurves):
                    yield bag.fcurves, fc


def strip_root_motion(action):
    """Make a Mixamo clip in-place.

    Clips downloaded without "In Place" animate the Hips with world translation.
    The game drives horizontal position and gravity itself, so that translation
    fights the controller and leaves the character hovering. Drop the Hips X/Z
    channels entirely and rebase Y to the clip's first frame, keeping the
    natural vertical bob relative to the bind pose.
    """
    for container, fc in action_fcurves(action):
        if fc.data_path.endswith('.location') and 'Hips' in fc.data_path:
            if fc.array_index in (0, 1):          # Blender X/Y == horizontal for Mixamo's Z-up import
                container.remove(fc)
            else:                                  # Z == vertical: keep bob, remove offset
                if not fc.keyframe_points:
                    continue
                base = fc.keyframe_points[0].co[1]
                for kp in fc.keyframe_points:
                    kp.co[1] -= base
                    kp.handle_left[1] -= base
                    kp.handle_right[1] -= base
                fc.update()

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=rigged, ignore_leaf_bones=True)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# Drop the action the base FBX bakes in — we only ship the named clips
arm.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

for clip_name, path in clips.items():
    before = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path, ignore_leaf_bones=True)
    new_actions = set(bpy.data.actions) - before
    # The clip FBX brings its own armature; steal its action, delete its objects
    imported = [o for o in bpy.context.selected_objects]
    action = max(new_actions, key=lambda a: a.frame_range[1]) if new_actions else None
    if action is None:
        raise RuntimeError(f"No action found in {path}")
    action.name = clip_name
    # Push onto the main armature as an NLA strip so the glTF exporter emits it as a clip
    if arm.animation_data is None:
        arm.animation_data_create()
    track = arm.animation_data.nla_tracks.new()
    track.name = clip_name
    track.strips.new(clip_name, int(action.frame_range[0]), action)
    for o in imported:
        bpy.data.objects.remove(o, do_unlink=True)

# Re-bind original textures: import the source GLB, copy its material over
before_mats = set(bpy.data.materials)
before_objs = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=orig_glb)
orig_mats = [m for m in bpy.data.materials if m not in before_mats]
for o in set(bpy.data.objects) - before_objs:
    bpy.data.objects.remove(o, do_unlink=True)
if orig_mats:
    for m in meshes:
        m.data.materials.clear()
        m.data.materials.append(orig_mats[0])

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_animations=True,
    export_nla_strips=True,
    export_skins=True,
    export_yup=True,
)
print("EXPORTED:", out_glb)
