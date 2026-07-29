# Run with: blender --background --python assemble_houses.py
# Assembles complete house GLBs from Kenney Fantasy Town Kit modules (CC0)
# and renders a preview PNG for visual verification.
import bpy, os, math

KIT = os.path.expanduser("~/sikh-avatar/assets/fantasy-town/Models/GLB format/")
OUT = os.path.expanduser("~/sikh-avatar/assets/houses/")
os.makedirs(OUT, exist_ok=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def place(name, x, y, rot_deg=0, z=0):
    """Import a kit piece at grid position. Kit is Y-up in glTF; Blender import is Z-up.
    x,y are grid cells (1 unit), z is storey height (1 unit). rot about vertical axis."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=KIT + name + ".glb")
    new = [o for o in set(bpy.data.objects) - before if o.parent is None]
    for o in new:
        o.location = (x, y, z)
        o.rotation_mode = 'XYZ'
        o.rotation_euler = (0, 0, math.radians(rot_deg))
    return new

# Wall pieces sit on the +X edge of their cell (x: 0.4..0.5).
# rot 0=east edge, 90=north, 180=west, 270=south.

def house_stone_1x2():
    """One cell wide (x), two cells long (y), gable roof."""
    for y in (0, 1):
        place("wall", 0, y, 0)            # east side
        place("wall", 0, y, 180)          # west side
    place("wall-door", 0, 0, 270)         # south end: door
    place("wall-window-shutters", 0, 1, 90)  # north end: window
    place("roof-gable", 0, 0, 270, 1)
    place("roof-gable", 0, 1, 90, 1)

def house_wood_2story():
    for y in (0, 1):
        place("wall-wood", 0, y, 0)
        place("wall-wood", 0, y, 180)
        place("wall-wood-window-shutters", 0, y, 0, 1)
        place("wall-wood-window-shutters", 0, y, 180, 1)
    place("wall-wood-door", 0, 0, 270)
    place("wall-wood-window-round", 0, 1, 90)
    place("wall-wood", 0, 0, 270, 1)
    place("wall-wood", 0, 1, 90, 1)
    place("roof-gable", 0, 0, 270, 2)
    place("roof-gable", 0, 1, 90, 2)

def house_hut_1x1():
    place("wall", 0, 0, 0)
    place("wall-door", 0, 0, 270)
    place("wall-window-small", 0, 0, 90)
    place("wall-window-small", 0, 0, 180)
    place("roof-point", 0, 0, 0, 1)

def export(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=OUT + name + ".glb", export_format='GLB')

def render_preview(name, cam_dist=5.5):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (cam_dist, -cam_dist, cam_dist * 0.75)
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    scene.camera = cam
    sun_data = bpy.data.lights.new("sun", type='SUN')
    sun_data.energy = 3
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(45), math.radians(20), 0)
    scene.collection.objects.link(sun)
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 480
    scene.render.resolution_y = 480
    scene.render.filepath = OUT + name + "_preview.png"
    bpy.ops.render.render(write_still=True)
    # remove camera + sun so they don't pollute the export
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(sun, do_unlink=True)

for fn, name in [(house_stone_1x2, "house-stone"),
                 (house_wood_2story, "house-wood-tall"),
                 (house_hut_1x1, "house-hut")]:
    reset()
    fn()
    render_preview(name)
    export(name)
    print("BUILT:", name)
