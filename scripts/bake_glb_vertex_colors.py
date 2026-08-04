#!/usr/bin/env python3
"""Bake a GLB base-colour texture into COLOR_0 for deterministic web rendering."""

import argparse
import io
import json
import struct
from pathlib import Path

from PIL import Image


def aligned(data: bytes, fill: bytes = b"\0") -> bytes:
    return data + fill * ((-len(data)) % 4)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    raw = args.source.read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError("expected a binary glTF 2.0 file")

    offset = 12
    json_len, json_type = struct.unpack_from("<II", raw, offset)
    offset += 8
    doc = json.loads(raw[offset:offset + json_len])
    offset += json_len
    bin_len, bin_type = struct.unpack_from("<II", raw, offset)
    offset += 8
    blob = bytearray(raw[offset:offset + bin_len])
    if json_type != 0x4E4F534A or bin_type != 0x004E4942:
        raise ValueError("unexpected GLB chunk layout")

    primitive = doc["meshes"][0]["primitives"][0]
    uv_accessor = doc["accessors"][primitive["attributes"]["TEXCOORD_0"]]
    uv_view = doc["bufferViews"][uv_accessor["bufferView"]]
    if uv_accessor["componentType"] != 5126 or uv_accessor["type"] != "VEC2":
        raise ValueError("expected float VEC2 UVs")

    image_def = doc["images"][1]
    image_view = doc["bufferViews"][image_def["bufferView"]]
    image_start = image_view.get("byteOffset", 0)
    image_data = bytes(blob[image_start:image_start + image_view["byteLength"]])
    image = Image.open(io.BytesIO(image_data)).convert("RGBA")

    uv_start = uv_view.get("byteOffset", 0) + uv_accessor.get("byteOffset", 0)
    uv_stride = uv_view.get("byteStride", 8)
    colors = bytearray()
    for index in range(uv_accessor["count"]):
        u, v = struct.unpack_from("<ff", blob, uv_start + index * uv_stride)
        x = round(max(0.0, min(1.0, u)) * (image.width - 1))
        y = round(max(0.0, min(1.0, v)) * (image.height - 1))
        r, g, b, a = image.getpixel((x, y))
        colors.extend(struct.pack("<ffff", r / 255, g / 255, b / 255, a / 255))

    color_offset = len(aligned(bytes(blob)))
    blob = bytearray(aligned(bytes(blob)))
    blob.extend(colors)
    color_view_index = len(doc["bufferViews"])
    doc["bufferViews"].append({
        "buffer": 0,
        "byteOffset": color_offset,
        "byteLength": len(colors),
        "byteStride": 16,
        "target": 34962,
    })
    color_accessor_index = len(doc["accessors"])
    doc["accessors"].append({
        "bufferView": color_view_index,
        "componentType": 5126,
        "count": uv_accessor["count"],
        "type": "VEC4",
    })
    primitive["attributes"]["COLOR_0"] = color_accessor_index
    doc["buffers"][0]["byteLength"] = len(blob)

    json_bytes = aligned(
        json.dumps(doc, separators=(",", ":")).encode("utf-8"), b" "
    )
    bin_bytes = aligned(bytes(blob))
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    output.extend(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    output.extend(json_bytes)
    output.extend(struct.pack("<II", len(bin_bytes), 0x004E4942))
    output.extend(bin_bytes)
    args.output.write_bytes(output)


if __name__ == "__main__":
    main()
