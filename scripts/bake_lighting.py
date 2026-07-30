# Bake path-traced lighting into a scene's textures with Cycles.
#
# Run with:
#   blender --background --python scripts/bake_lighting.py -- <in.glb> <out.glb> [preset]
#
# Why bake at all: a real-time light in three.js knows nothing about light
# bouncing off the floor onto the wall. That missing bounce is most of what
# separates "lit" from "real". Cycles is an actual path tracer, so running it
# offline and storing the result gives true global illumination — soft
# shadows, colour bleeding, contact darkening — at zero runtime cost. The
# scenes that already look best in this project are exactly the ones somebody
# else baked this way.
#
# The result is baked into base colour and the room is then rendered unlit,
# which is both the closest reproduction of the bake and the cheapest possible
# draw.
import bpy
import os
import sys
import math

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, DST = argv[0], argv[1]
PRESET = argv[2] if len(argv) > 2 else "pool"
SAMPLES = int(os.environ.get("BAKE_SAMPLES", "160"))
BAKE_RES = int(os.environ.get("BAKE_RES", "1024"))


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def area_light(name, loc, size, energy, color, rot=(0, 0, 0)):
    """Rectangular emitter. Area lights are what give soft, believable
    falloff — a point light bakes hard-edged shadows that read as CG."""
    data = bpy.data.lights.new(name, type='AREA')
    data.shape = 'RECTANGLE'
    data.size, data.size_y = size
    data.energy = energy
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    obj.rotation_euler = rot
    bpy.context.collection.objects.link(obj)
    return obj


def emissive_meshes():
    """Downloaded scenes ship no lights — they were stripped or already baked.
    But an emissive material marks where the artist put a fixture, so the
    glowing quads themselves tell us where to place lights."""
    found = []
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                is_emit = node.type == 'EMISSION'
                strong = (node.type == 'BSDF_PRINCIPLED'
                          and 'Emission Strength' in node.inputs
                          and node.inputs['Emission Strength'].default_value > 0.01)
                if is_emit or strong:
                    found.append(obj)
                    break
    return found


def light_the_scene(preset):
    """Low, moody ambience: a couple of dim overheads plus a cool bounce, so
    the room reads as abandoned rather than operational."""
    scene_min = [1e9] * 3
    scene_max = [-1e9] * 3
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
            wc = obj.matrix_world @ __import__('mathutils').Vector(corner)
            for i in range(3):
                scene_min[i] = min(scene_min[i], wc[i])
                scene_max[i] = max(scene_max[i], wc[i])
    cx = (scene_min[0] + scene_max[0]) / 2
    cy = (scene_min[1] + scene_max[1]) / 2
    top = scene_max[2]
    span = max(scene_max[0] - scene_min[0], scene_max[1] - scene_min[1])

    # Emissive geometry marks real fixtures; light those first.
    placed = 0
    for obj in emissive_meshes():
        c = obj.matrix_world.translation
        area_light(f"fixture_{placed}", (c.x, c.y, min(c.z, top) - 0.05),
                   (2.0, 2.0), 45.0, (1.0, 0.94, 0.80),
                   rot=(math.pi, 0, 0))
        placed += 1

    if preset == "pool":
        # Two dim overheads, deliberately off-centre so the room isn't evenly
        # lit — the unevenness is what makes it feel abandoned.
        area_light("key", (cx - span * 0.18, cy, top - 0.35),
                   (span * 0.34, span * 0.34), 620.0, (0.88, 0.93, 1.0),
                   rot=(math.pi, 0, 0))
        area_light("fill", (cx + span * 0.26, cy + span * 0.12, top - 0.35),
                   (span * 0.26, span * 0.26), 330.0, (0.82, 0.89, 1.0),
                   rot=(math.pi, 0, 0))
        # A weak upward glow from the water, which is the one thing in a pool
        # room that would actually still be lit.
        area_light("water", (cx, cy, scene_min[2] + 0.4),
                   (span * 0.5, span * 0.35), 150.0, (0.42, 0.74, 0.94))
        world_strength, world_col = 0.16, (0.34, 0.42, 0.50)
    else:
        area_light("key", (cx, cy, top - 0.4),
                   (span * 0.4, span * 0.4), 300.0, (1.0, 0.95, 0.85),
                   rot=(math.pi, 0, 0))
        world_strength, world_col = 0.05, (0.5, 0.5, 0.5)

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (*world_col, 1.0)
    bg.inputs[1].default_value = world_strength
    bpy.context.scene.world = world


def setup_cycles():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    # Metal on Apple silicon; falls back to CPU wherever it isn't available.
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        scene.cycles.device = 'GPU'
        print("BAKE: using GPU (Metal)")
    except Exception as exc:
        scene.cycles.device = 'CPU'
        print("BAKE: using CPU —", exc)


def prepare_for_bake(obj):
    """Give the mesh a second, non-overlapping UV set and a fresh image to
    bake into. The original UVs usually tile, and a tiling layout cannot hold
    per-location lighting — two walls sharing UV space would share shadows."""
    mesh = obj.data
    if len(mesh.uv_layers) < 2:
        mesh.uv_layers.new(name='bake')
    mesh.uv_layers.active = mesh.uv_layers['bake'] if 'bake' in mesh.uv_layers else mesh.uv_layers[-1]

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    img = bpy.data.images.new(f"bake_{obj.name}", BAKE_RES, BAKE_RES)
    for slot in obj.material_slots:
        mat = slot.material
        if not mat:
            continue
        mat.use_nodes = True
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = img
        node.select = True
        mat.node_tree.nodes.active = node
        uvnode = mat.node_tree.nodes.new('ShaderNodeUVMap')
        uvnode.uv_map = 'bake'
        mat.node_tree.links.new(uvnode.outputs[0], node.inputs[0])
    return img


def wire_baked_image(obj, img):
    """Point base colour at the baked result. The scene then renders unlit in
    three.js, which reproduces the bake exactly and costs no lighting math."""
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        tex = next((n for n in nodes if n.type == 'TEX_IMAGE' and n.image == img), None)
        if not tex:
            continue
        for link in list(links):
            if link.to_node == bsdf and link.to_socket.name == 'Base Color':
                links.remove(link)
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        for name in ('Metallic', 'Specular IOR Level'):
            if name in bsdf.inputs:
                bsdf.inputs[name].default_value = 0.0
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = 1.0


def main():
    clear()
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    print(f"BAKE: {len(meshes)} meshes from {os.path.basename(SRC)}")

    light_the_scene(PRESET)
    setup_cycles()

    scene = bpy.context.scene
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.margin = 8

    images = {}
    for i, obj in enumerate(meshes):
        if not obj.data.polygons:
            continue
        print(f"BAKE: [{i+1}/{len(meshes)}] {obj.name}")
        images[obj.name] = prepare_for_bake(obj)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.object.bake(type='COMBINED', use_clear=True)
        except RuntimeError as exc:
            print(f"BAKE: skipped {obj.name} — {exc}")
            continue
        wire_baked_image(obj, images[obj.name])

    # Lights must not survive into the export; the light is in the texture now.
    for obj in [o for o in bpy.data.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.export_scene.gltf(
        filepath=DST, export_format='GLB',
        export_image_format='JPEG', export_jpeg_quality=82,
        export_yup=True,
    )
    print("BAKED:", DST)


main()
