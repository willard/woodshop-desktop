#!/usr/bin/env python3
"""Check a GLB or STL file against what Woodshop's Import a 3D model accepts.

    python3 check_model.py tote.glb
    python3 check_model.py bin.stl --unit mm

Prints the format, the triangle count and the size as Woodshop will first show it (length X,
depth Z, height Y, in inches), then any problem. Exits 1 if Woodshop would refuse the file.
Standard library only. The rules mirror `ui/src/engine/importedModels.ts`.
"""
import argparse
import json
import math
import struct
import sys

MODEL_MAX_BYTES = 12_000_000  # the library's limit, after Woodshop re-saves the model
HEAVY_TRIANGLES = 400_000  # above this the view and the video slow down
INCHES = {"m": 1 / 0.0254, "cm": 1 / 2.54, "mm": 1 / 25.4, "in": 1.0}


def fail(message):
    print(f"REFUSED: {message}")
    sys.exit(1)


# ---- GLB -------------------------------------------------------------------------------------


def glb_json(data):
    if len(data) < 20 or struct.unpack_from("<I", data, 4)[0] != 2:
        fail("This is not a glTF 2.0 GLB file.")
    length, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A or 20 + length > len(data):
        fail("This GLB file is damaged: it has no glTF description.")
    try:
        return json.loads(data[20 : 20 + length].decode("utf-8"))
    except ValueError:
        fail("This GLB file is damaged: its glTF description is not JSON.")


def mat_mul(a, b):
    return [sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4)) for r in range(4) for c in range(4)]


def node_matrix(node):
    """A node's local matrix, row-major."""
    if "matrix" in node:
        m = node["matrix"]  # glTF stores column-major
        return [m[c * 4 + r] for r in range(4) for c in range(4)]
    tx, ty, tz = node.get("translation", [0, 0, 0])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    rot = [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ]
    return [
        rot[0] * sx, rot[1] * sy, rot[2] * sz, tx,
        rot[3] * sx, rot[4] * sy, rot[5] * sz, ty,
        rot[6] * sx, rot[7] * sy, rot[8] * sz, tz,
        0, 0, 0, 1,
    ]


def check_glb(data):
    doc = glb_json(data)
    outside = [
        e for e in doc.get("buffers", []) + doc.get("images", [])
        if "uri" in e and not e["uri"].startswith("data:")
    ]
    if outside:
        fail(
            "This model points to other files (textures or data beside it). "
            "Export it again as one GLB with everything embedded."
        )
    if "KHR_draco_mesh_compression" in doc.get("extensionsRequired", []):
        fail("This model is compressed with Draco, which Woodshop cannot read. Export it without Draco.")

    accessors = doc.get("accessors", [])
    nodes = doc.get("nodes", [])
    meshes = doc.get("meshes", [])
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    triangles = 0

    def visit(index, parent):
        nonlocal triangles
        node = nodes[index]
        world = mat_mul(parent, node_matrix(node))
        if "mesh" in node:
            for prim in meshes[node["mesh"]].get("primitives", []):
                if prim.get("mode", 4) != 4:
                    continue  # points and lines draw nothing solid
                pos = accessors[prim["attributes"]["POSITION"]]
                count = accessors[prim["indices"]]["count"] if "indices" in prim else pos["count"]
                triangles += count // 3
                a, b = pos.get("min"), pos.get("max")
                if a is None or b is None:
                    continue
                for corner in [(x, y, z) for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])]:
                    p = [sum(world[r * 4 + c] * (list(corner) + [1])[c] for c in range(4)) for r in range(3)]
                    for i in range(3):
                        lo[i], hi[i] = min(lo[i], p[i]), max(hi[i], p[i])
        for child in node.get("children", []):
            visit(child, world)

    identity = [1 if r == c else 0 for r in range(4) for c in range(4)]
    scenes = doc.get("scenes", [])
    roots = scenes[doc.get("scene", 0)]["nodes"] if scenes else range(len(nodes))
    for root in roots:
        visit(root, identity)
    if triangles == 0:
        fail("This GLB file has nothing to draw in it.")
    # Length X, depth Z, height Y, as Woodshop measures a model standing up.
    size = [hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]] if lo[0] != math.inf else None
    return triangles, size, "m", "Y up (glTF's own convention)"


# ---- STL -------------------------------------------------------------------------------------


def check_stl(data):
    lo, hi = [math.inf] * 3, [-math.inf] * 3

    def take(x, y, z):
        for i, v in enumerate((x, y, z)):
            lo[i], hi[i] = min(lo[i], v), max(hi[i], v)

    binary = len(data) >= 84 and 84 + 50 * struct.unpack_from("<I", data, 80)[0] == len(data)
    if binary:
        triangles = struct.unpack_from("<I", data, 80)[0]
        for t in range(triangles):
            values = struct.unpack_from("<12f", data, 84 + 50 * t)
            for v in range(3):
                take(*values[3 + v * 3 : 6 + v * 3])
    else:
        vertices = 0
        for line in data.decode("utf-8", "replace").splitlines():
            parts = line.split()
            if len(parts) == 4 and parts[0] == "vertex":
                take(*map(float, parts[1:]))
                vertices += 1
        triangles = vertices // 3
    if triangles == 0:
        fail("This STL file has nothing to draw in it.")
    # STL is usually Z up: Woodshop stands it up, so its Y becomes depth and its Z height.
    size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
    return triangles, size, "mm", "Z up (Woodshop stands it up for you)"


# ---- main ------------------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--unit", choices=INCHES, help="the unit the file's numbers are in (default: m for GLB, mm for STL)")
    args = ap.parse_args()
    data = open(args.file, "rb").read()

    if data[:4] == b"glTF":
        fmt, (triangles, size, unit, up) = "GLB", check_glb(data)
    elif args.file.lower().endswith(".stl"):
        fmt, (triangles, size, unit, up) = "STL", check_stl(data)
    else:
        fail("Woodshop imports GLB and STL files.")
    unit = args.unit or unit

    print(f"Format:    {fmt}, {up}")
    print(f"Triangles: {triangles:,}")
    print(f"File:      {len(data) / 1e6:.1f} MB")
    if size is not None:
        l, w, h = (v * INCHES[unit] for v in size)
        print(f"Size:      {l:.2f} long (X) x {w:.2f} deep (Z) x {h:.2f} tall (Y) inches, reading it as {unit}")
    if triangles > HEAVY_TRIANGLES:
        print(f"WARNING: more than {HEAVY_TRIANGLES:,} triangles; the view and the video will be slow.")
    if len(data) > MODEL_MAX_BYTES:
        print("WARNING: over 12 MB. Woodshop re-saves the model and refuses it if it is still over 12 MB.")
    print("OK: Woodshop can import this file. Check the size above against the real object.")


if __name__ == "__main__":
    main()
