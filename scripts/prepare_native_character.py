"""Prepare the existing Mixamo-rigged Sikh character for browser playback.

This intentionally does not retarget or alter any animation. It removes the
preview geometry carried by the source GLB, keeps the authored armature and
native clips, and exports a clean runtime asset for Dark Snow.

Run with Blender:

    blender -b --python scripts/prepare_native_character.py -- \
      --input output/minimal-scifi-sikh-animated.glb \
      --output experiments/dark-snow/public/sansara-character-native.glb
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


KEEP_ACTIONS = {"Idle", "Walk", "Run", "Jump", "Land", "HappyIdle", "Dance", "Moonwalk"}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(argv)


def main():
    args = parse_args()
    source = Path(args.input).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {[obj.name for obj in armatures]}")
    armature = armatures[0]
    authored = {armature, *armature.children_recursive}

    # The source file contains an unrelated preview icosphere. It polluted the
    # hierarchy bounds in Babylon and made correct sole grounding impossible.
    for obj in list(bpy.context.scene.objects):
        if obj not in authored:
            bpy.data.objects.remove(obj, do_unlink=True)

    missing = sorted(KEEP_ACTIONS.difference(action.name for action in bpy.data.actions))
    if missing:
        raise RuntimeError(f"Missing native actions: {missing}")

    for action in list(bpy.data.actions):
        if action.name not in KEEP_ACTIONS:
            bpy.data.actions.remove(action)

    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1.0
    bpy.ops.object.select_all(action="DESELECT")
    for obj in authored:
        if bpy.context.scene.objects.get(obj.name) is not None:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = armature

    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_nla_strips=True,
        # The eight native clips are already represented by NLA tracks. Asking
        # Blender for "extra" animation owners pulls the source preview sphere
        # back into an otherwise selected-only export.
        export_extra_animations=False,
        export_all_influences=True,
        export_materials="EXPORT",
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"NATIVE_CHARACTER {output}")
    print(f"ACTIONS {sorted(action.name for action in bpy.data.actions)}")


if __name__ == "__main__":
    main()
