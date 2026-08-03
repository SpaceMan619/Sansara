"""Retarget Universal Animation Library locomotion onto Sansara's character.

Run with Blender, for example:

    blender -b --python scripts/retarget_character.py -- \
      --target output/minimal-scifi-sikh-animated.glb \
      --source /path/to/UAL1_Standard.glb \
      --output experiments/dark-snow/assets/sansara-character.glb

The source and target are kept separate until each action has been visually
copied onto the target armature. Translation is intentionally not copied from
the source: Dark Snow's controller owns world movement, so walk/run clips must
remain in place.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


MAP = {
    "pelvis": "mixamorig:Hips",
    "spine_01": "mixamorig:Spine",
    "spine_02": "mixamorig:Spine1",
    "spine_03": "mixamorig:Spine2",
    "neck_01": "mixamorig:Neck",
    "Head": "mixamorig:Head",
    "clavicle_l": "mixamorig:LeftShoulder",
    "upperarm_l": "mixamorig:LeftArm",
    "lowerarm_l": "mixamorig:LeftForeArm",
    "hand_l": "mixamorig:LeftHand",
    "clavicle_r": "mixamorig:RightShoulder",
    "upperarm_r": "mixamorig:RightArm",
    "lowerarm_r": "mixamorig:RightForeArm",
    "hand_r": "mixamorig:RightHand",
    "thigh_l": "mixamorig:LeftUpLeg",
    "calf_l": "mixamorig:LeftLeg",
    "foot_l": "mixamorig:LeftFoot",
    "ball_l": "mixamorig:LeftToeBase",
    "thigh_r": "mixamorig:RightUpLeg",
    "calf_r": "mixamorig:RightLeg",
    "foot_r": "mixamorig:RightFoot",
    "ball_r": "mixamorig:RightToeBase",
}

CORE_ACTIONS = {
    "Idle_Loop": "UAL_Idle",
    "Walk_Loop": "UAL_Walk",
    "Jog_Fwd_Loop": "UAL_Jog",
    "Sprint_Loop": "UAL_Sprint",
    "Jump_Start": "UAL_JumpStart",
    "Jump_Loop": "UAL_JumpLoop",
    "Jump_Land": "UAL_Land",
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--target", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--output", required=True)
    return p.parse_args(argv)


def import_gltf(path: Path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    after = set(bpy.context.scene.objects)
    new_objects = after - before
    armatures = [o for o in new_objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected exactly one armature in {path}, got {armatures}")
    return armatures[0], new_objects


def remove_constraints(armature):
    for bone in armature.pose.bones:
        for constraint in list(bone.constraints):
            bone.constraints.remove(constraint)


def add_rotation_constraints(source, target):
    missing = []
    for source_name, target_name in MAP.items():
        source_bone = source.pose.bones.get(source_name)
        target_bone = target.pose.bones.get(target_name)
        if not source_bone or not target_bone:
            missing.append((source_name, target_name))
            continue

        c = target_bone.constraints.new("COPY_ROTATION")
        c.name = f"UAL retarget · {source_name}"
        c.target = source
        c.subtarget = source_name
        # The two rigs have different rest-pose orientations. Copying their
        # evaluated pose-space matrices directly produces a visibly twisted
        # body; local bone rotations are the retargetable part of both rigs.
        c.target_space = "LOCAL"
        c.owner_space = "LOCAL"
        c.mix_mode = "REPLACE"
        c.influence = 1.0

    if missing:
        raise RuntimeError(f"Missing required retarget bones: {missing}")


def bake_action(scene, source, target, action, name):
    source.animation_data_create()
    source.animation_data.action = action
    target.animation_data_create()
    target.animation_data.action = None
    scene.frame_start = int(action.frame_range[0])
    scene.frame_end = int(action.frame_range[1])
    scene.frame_set(scene.frame_start)
    bpy.context.view_layer.update()

    # The active object must be the target for NLA bake to write the copied pose.
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.nla.bake(
        frame_start=scene.frame_start,
        frame_end=scene.frame_end,
        only_selected=False,
        visual_keying=True,
        clear_constraints=False,
        use_current_action=False,
        bake_types={"POSE"},
    )
    baked = target.animation_data.action
    if baked is None:
        raise RuntimeError(f"Blender did not produce a baked action for {name}")
    baked.name = name
    return baked


def push_to_nla(target, action):
    target.animation_data_create()
    track = target.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, int(action.frame_range[0]), action)
    strip.action_frame_start = action.frame_range[0]
    strip.action_frame_end = action.frame_range[1]
    strip.frame_end = action.frame_range[1]
    target.animation_data.action = None


def clear_animation_data(target):
    """Remove animations imported with the source target before baking."""
    target.animation_data_create()
    target.animation_data.action = None
    for track in list(target.animation_data.nla_tracks):
        target.animation_data.nla_tracks.remove(track)


def main():
    args = parse_args()
    target_path = Path(args.target).expanduser().resolve()
    source_path = Path(args.source).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    target, target_objects = import_gltf(target_path)
    target_action_names = {action.name for action in bpy.data.actions}
    source, source_objects = import_gltf(source_path)

    target.name = "SansaraCharacter"
    source.name = "UAL_Source"
    source_actions = {a.name: a for a in bpy.data.actions}
    missing_actions = [n for n in CORE_ACTIONS if n not in source_actions]
    if missing_actions:
        raise RuntimeError(f"Missing UAL actions: {missing_actions}")

    remove_constraints(target)
    clear_animation_data(target)
    add_rotation_constraints(source, target)

    # The original GLB actions are not part of the retargeted deliverable. They
    # remain in memory only long enough for this script to create the new set.
    baked_actions = []
    for source_name, target_name in CORE_ACTIONS.items():
        baked = bake_action(bpy.context.scene, source, target, source_actions[source_name], target_name)
        baked_actions.append((target_name, baked))

    # Keep the baked clips out of the evaluation stack while the next clip is
    # being sampled.  Once every clip is complete, put them into independent
    # NLA tracks so Babylon can discover them as AnimationGroups.
    remove_constraints(target)
    for _, baked in baked_actions:
        push_to_nla(target, baked)

    # Remove the source rig and its mannequin meshes; the output contains only
    # the user's character and its baked actions.
    for obj in source_objects:
        bpy.data.objects.remove(obj, do_unlink=True)

    baked_data = {action for _, action in baked_actions}
    for action in list(bpy.data.actions):
        if action not in baked_data and action.name not in target_action_names:
            bpy.data.actions.remove(action)

    # Blender appends `.001` while the imported target still owns an action
    # with the requested name.  The originals are gone now, so normalize the
    # names before export; consumers can select stable names across builds.
    for desired_name, action in baked_actions:
        action.name = desired_name

    # Preserve the character's original Mixamo clips as the stable, authored
    # idle/walk/run set. The Universal Animation Library clips live beside them
    # under the UAL_ prefix, so runtime can use either source without losing
    # the asset's existing motion quality.
    for name in ("Idle", "Walk", "Run", "Jump", "Land"):
        original = bpy.data.actions.get(name)
        if original is not None:
            push_to_nla(target, original)

    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1.0
    bpy.ops.object.select_all(action="DESELECT")
    # Keep only the authored character hierarchy. The source target file also
    # carries a preview cube and an icosphere; exporting those made the runtime
    # load a giant invisible test scene around the player.
    export_objects = [target, *target.children_recursive]
    for obj in list(target_objects):
        if obj not in export_objects and bpy.context.scene.objects.get(obj.name) is not None:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in export_objects:
        if bpy.context.scene.objects.get(obj.name) is not None:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = target

    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_nla_strips=True,
        export_all_influences=True,
        export_materials="EXPORT",
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"RETARGETED_CHARACTER {output_path}")
    print(f"BAKED_ACTIONS {[a.name for _, a in baked_actions]}")


if __name__ == "__main__":
    main()
