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
import tempfile

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, DST = argv[0], argv[1]
PRESET = argv[2] if len(argv) > 2 else "pool"
SAMPLES = int(os.environ.get("BAKE_SAMPLES", "512"))
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


def pool_fixture_lights():
    """Match the two actual ceiling panels in the source room.

    The old preset estimated a few enormous lights from the room bounds. That
    made the walls muddy and flattened the whole room. These positions come
    from the two emissive islands in Material.008, so the bounce now starts
    where the reference image says the light exists.
    """
    # A slightly cool daylight rather than saturated cyan.  The old colour
    # clipped the directly-lit tiles into turquoise while the rest of the
    # room remained almost black.
    panel_color = (0.78, 0.94, 1.0)
    for i, x in enumerate((-0.613, 9.273)):
        area_light(
            f"ceiling_panel_{i}",
            (x, 0.0, 8.49),
            (3.15, 3.35),
            525.0,
            panel_color,
            rot=(math.pi, 0, 0),
        )

    # The room is a sealed mesh, so World illumination cannot reach its
    # interior.  These broad, invisible ceiling sources provide the soft
    # cloudy base light visible in the reference while the smaller fixture
    # lights above remain the brighter directional accents.  Splitting the
    # room in two avoids the flat, centre-hot look of one enormous emitter.
    for i, x in enumerate((-7.27, 9.25)):
        area_light(
            f"cloud_fill_{i}",
            (x, 0.0, 8.20),
            (14.5, 11.5),
            600.0,
            (0.86, 0.94, 1.0),
            rot=(math.pi, 0, 0),
        )


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

    if preset == "pool":
        pool_fixture_lights()
        # Broad cloudy fill keeps the room airy and gives the path tracer a
        # clean baseline; the panels still provide the visible direction.
        world_strength, world_col = 0.27, (0.65, 0.75, 0.82)
    else:
        # Generic fallback for scenes whose emissive objects are individual
        # fixtures rather than several panels joined into one mesh.
        placed = 0
        for obj in emissive_meshes():
            c = obj.matrix_world.translation
            area_light(f"fixture_{placed}", (c.x, c.y, min(c.z, top) - 0.05),
                       (2.0, 2.0), 45.0, (1.0, 0.94, 0.80),
                       rot=(math.pi, 0, 0))
            placed += 1
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
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01
    scene.cycles.adaptive_min_samples = min(32, SAMPLES)
    # Bright indirect paths were the source of most of the cyan fireflies in
    # the pool bake.  These limits preserve the soft falloff without letting
    # a few extreme samples dominate a texel.
    scene.cycles.sample_clamp_direct = 4.0
    scene.cycles.sample_clamp_indirect = 2.0
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


def denoise_bake_image(img):
    """Run OpenImageDenoise over a baked image through Blender's compositor.

    ``scene.cycles.use_denoising`` only applies to ordinary renders; Blender
    does not denoise the pixels written by ``bpy.ops.object.bake``.  Blender
    5.x exposes the compositor root as ``Scene.compositing_node_group`` and
    uses a Group Output node in place of the former Composite node.  A tiny
    temporary scene evaluates Image -> Denoise -> Group Output and writes a
    half-float EXR, avoiding both view-transform changes and an 8-bit round
    trip before the final glTF export.
    """
    width, height = img.size
    if not width or not height:
        return

    denoise_scene = bpy.data.scenes.new(f"denoise_{img.name}")
    camera_data = bpy.data.cameras.new(f"denoise_camera_{img.name}")
    camera = bpy.data.objects.new(camera_data.name, camera_data)
    denoise_scene.collection.objects.link(camera)
    denoise_scene.camera = camera
    denoise_scene.render.engine = 'BLENDER_EEVEE'
    denoise_scene.render.resolution_x = width
    denoise_scene.render.resolution_y = height
    denoise_scene.render.resolution_percentage = 100
    denoise_scene.render.image_settings.file_format = 'OPEN_EXR'
    denoise_scene.render.image_settings.color_mode = 'RGBA'
    denoise_scene.render.image_settings.color_depth = '16'
    denoise_scene.render.image_settings.exr_codec = 'ZIP'

    tree = bpy.data.node_groups.new(f"denoise_nodes_{img.name}", 'CompositorNodeTree')
    denoise_scene.compositing_node_group = tree
    # Required in Blender 5.2 to enable the assigned compositor graph.  The
    # property is deprecated for 6.0 but remains the supported 5.x switch.
    denoise_scene.use_nodes = True
    source = tree.nodes.new('CompositorNodeImage')
    source.image = img
    denoise = tree.nodes.new('CompositorNodeDenoise')
    denoise.inputs['HDR'].default_value = False
    denoise.inputs['Prefilter'].default_value = 'None'
    denoise.inputs['Quality'].default_value = 'High'
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    output = tree.nodes.new('NodeGroupOutput')
    tree.links.new(source.outputs['Image'], denoise.inputs['Image'])
    tree.links.new(denoise.outputs['Image'], output.inputs['Image'])

    with tempfile.NamedTemporaryFile(
            prefix='sansara_bake_denoise_', suffix='.exr', delete=False) as temp_file:
        temp_path = temp_file.name
    denoise_scene.render.filepath = temp_path
    try:
        bpy.ops.render.render(write_still=True, scene=denoise_scene.name)
        denoised = bpy.data.images.load(temp_path, check_existing=False)
        try:
            # Pixel arrays are scene-linear, as is the EXR, so this copy does
            # not apply AgX or otherwise alter the baked colour values.
            img.pixels[:] = denoised.pixels[:]
            img.update()
        finally:
            bpy.data.images.remove(denoised)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        bpy.data.scenes.remove(denoise_scene)
        bpy.data.objects.remove(camera)
        bpy.data.cameras.remove(camera_data)
        bpy.data.node_groups.remove(tree)


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
    # Blender 5.2's glTF exporter uses AUTO to preserve a source image's
    # format.  Mark generated lightmaps as PNG so AUTO embeds lossless data.
    img.file_format = 'PNG'
    for slot in obj.material_slots:
        mat = slot.material
        if not mat:
            continue
        # Imported rooms commonly share one material between several meshes.
        # Each mesh has its own lightmap, so sharing the material makes every
        # object display whichever image happened to bake last. That was the
        # main cause of the broken, near-black pool bake.
        mat = mat.copy()
        mat.name = f"{mat.name.split('.')[0]}_{obj.name}_baked"
        slot.material = mat
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

    # Water and the ceiling emitters need their live PBR/emissive materials.
    # Baking them to diffuse base colour destroys the dark reflections and
    # cyan glow that define the reference image.
    live_pool_materials = {'Material.005', 'Material.008'}
    images = {}
    for i, obj in enumerate(meshes):
        if not obj.data.polygons:
            continue
        original_materials = {slot.material.name for slot in obj.material_slots if slot.material}
        if PRESET == 'pool' and original_materials & live_pool_materials:
            print(f"BAKE: live material kept on {obj.name}: {sorted(original_materials)}")
            continue
        print(f"BAKE: [{i+1}/{len(meshes)}] {obj.name}")
        images[obj.name] = prepare_for_bake(obj)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            # Diffuse direct + indirect is stable from every camera angle.
            # Gloss and emission remain live on the two skipped materials.
            bpy.ops.object.bake(type='DIFFUSE', use_clear=True)
        except RuntimeError as exc:
            print(f"BAKE: skipped {obj.name} — {exc}")
            continue
        print(f"BAKE: denoising {obj.name}")
        denoise_bake_image(images[obj.name])
        wire_baked_image(obj, images[obj.name])

    # Lights must not survive into the export; the light is in the texture now.
    for obj in [o for o in bpy.data.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.export_scene.gltf(
        filepath=DST, export_format='GLB',
        # Preserve the denoised gradients and avoid JPEG ringing around UV
        # island borders.  The images are embedded in the GLB.
        export_image_format='AUTO',
        export_yup=True,
    )
    print("BAKED:", DST)


main()
