# Run with: blender --background --python glb_to_fbx.py -- <in.glb> <out.fbx>
# Converts a static GLB to a Mixamo-ready FBX with textures packed in.
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]

# Start from an empty scene — the default cube/camera/light would confuse Mixamo's rigger
bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.import_scene.gltf(filepath=src)

# Mixamo expects the character standing on the origin, real-world scale.
# Apply any importer-added transforms so the FBX is clean.
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Pack images so they embed in the FBX (path_mode='COPY' + embed_textures)
bpy.ops.file.pack_all()

bpy.ops.export_scene.fbx(
    filepath=dst,
    use_selection=False,
    path_mode='COPY',
    embed_textures=True,
    mesh_smooth_type='FACE',
    add_leaf_bones=False,
)
print("EXPORTED:", dst)
