#!/usr/bin/env python3
"""Make Mixamo clips in-place by flattening the Hips' horizontal translation.

Mixamo clips downloaded without "In Place" animate the Hips with world travel:
the Walk clip drifts ~85 units forward over its cycle, Run ~149. The game
controller drives horizontal position itself, so that travel fights the
controller (feet slide, the body drifts off the collision point). Vertical bob
is kept, since that's the character's natural gait.

In the exported GLB the Hips node's translation is expressed in the bone's rest
frame, where empirically Y is forward, X is lateral and Z is vertical. Doing
this here rather than on Blender F-Curves avoids Mixamo's rotated bone-local
axes, which don't map predictably to world axes.

Usage: inplace_root_motion.py <in.glb> <out.glb> [--flatten-vertical CLIP ...]
"""
import json
import struct
import sys

HORIZONTAL_AXES = (0, 1)   # X lateral, Y forward
VERTICAL_AXIS = 2


def load_glb(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack('<III', data[:12])
    if magic != 0x46546C67:
        raise ValueError(f"{path} is not a GLB file")
    json_len, json_type = struct.unpack('<II', data[12:20])
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8       # skip the BIN chunk header
    return gltf, bytearray(data), bin_start, json_len


def accessor_offset(gltf, index, bin_start):
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    return bin_start + view.get('byteOffset', 0) + acc.get('byteOffset', 0), acc


def flatten(path_in, path_out, flatten_vertical=()):
    gltf, data, bin_start, _ = load_glb(path_in)
    nodes = gltf['nodes']
    changed = []

    for anim in gltf.get('animations', []):
        for channel in anim['channels']:
            target = channel['target']
            if target['path'] != 'translation':
                continue
            if not nodes[target['node']].get('name', '').endswith('Hips'):
                continue

            sampler = anim['samplers'][channel['sampler']]
            offset, acc = accessor_offset(gltf, sampler['output'], bin_start)
            count = acc['count']

            axes = list(HORIZONTAL_AXES)
            if anim['name'] in flatten_vertical:
                axes.append(VERTICAL_AXIS)

            for axis in axes:
                if axis == VERTICAL_AXIS:
                    # Anchor to the clip's lowest point, not its first frame: a
                    # landing clip starts mid-air, so pinning to frame 0 leaves
                    # the whole clip suspended at fall height.
                    base = min(struct.unpack_from('<f', data, offset + f * 12 + axis * 4)[0]
                               for f in range(count))
                else:
                    base = struct.unpack_from('<f', data, offset + axis * 4)[0]
                for frame in range(count):
                    struct.pack_into('<f', data, offset + frame * 12 + axis * 4, base)

            if 'min' in acc and 'max' in acc:
                for axis in axes:
                    base = struct.unpack_from('<f', data, offset + axis * 4)[0]
                    acc['min'][axis] = acc['max'][axis] = base
            changed.append(f"{anim['name']}({'+'.join('XYZ'[a] for a in axes)})")

    # The JSON chunk may have changed length (accessor min/max), so rebuild it.
    new_json = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    new_json += b' ' * ((4 - len(new_json) % 4) % 4)
    bin_chunk = bytes(data[bin_start - 8:])
    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(new_json) + len(bin_chunk))
    out += struct.pack('<II', len(new_json), 0x4E4F534A) + new_json
    out += bin_chunk
    open(path_out, 'wb').write(out)
    print("FLATTENED:", ", ".join(changed))
    print("WROTE:", path_out)


if __name__ == '__main__':
    args = sys.argv[1:]
    vertical = []
    if '--flatten-vertical' in args:
        i = args.index('--flatten-vertical')
        vertical = args[i + 1:]
        args = args[:i]
    flatten(args[0], args[1], set(vertical))
