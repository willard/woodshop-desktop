---
name: woodshop-prop-model
description: Make a 3D model file (GLB or STL) of a real object, such as a storage tote, tool box, cooler or appliance, sized to the real thing and ready for Woodshop's Import a 3D model, so it can be shown with a piece of furniture. Use when asked to build, model, export or prepare a 3D model, GLB or STL for Woodshop, or a prop that the built-in shapes cannot show.
---

# Making a model to show with a Woodshop piece

Woodshop can show things a piece holds (totes on a rack, a mower under a bench) as props. A
prop is a catalog item, a simple shape, or an **imported model**: a GLB or STL file the person
imports in the app. This skill is about making that file. Placing it in a design is the
`woodshop-design` skill.

## 0. Do you need a file at all?

Woodshop already draws these without any file, through `add_prop` with a `shape`:

- `{kind: "box", l, w, h}`: a box or crate; with `open: true`, an open bin.
- `{kind: "round", d, h}`: a can; with `top`, a tapered pail; with `open: true`, no lid.
- `{kind: "tote", l, w, h}`: a storage tote with a rim and a lid.

Each takes a body `color` and a lid `accent`. If one of those is close enough, use it and stop.
Make a file only when the object's look matters to the client and no shape is close: an odd
shape, a branded product, an appliance.

## 1. Get the real size

Use the maker's published dimensions or a tape measure, never a guess from a photo. Write down,
in inches: overall length, depth and height; and any size that decides the fit on the piece
(a tote's rim width and the depth below the rim, a bin's footprint). The file has to be this
size; Woodshop only scales it if the person types a length during import.

## 2. What Woodshop accepts

These are the import rules (from `ui/src/engine/importedModels.ts`):

| Rule | Detail |
|---|---|
| Format | GLB (binary glTF 2.0) or STL (binary or ASCII). Not .gltf, OBJ, FBX, USDZ, 3MF. |
| One file | A GLB must embed everything. A `uri` to a texture or `.bin` beside it is refused. |
| Compression | No Draco (refused). Meshopt compression is fine. |
| Size | 12 MB at most after Woodshop re-saves it. Aim for under 2 MB. |
| Triangles | Over 400,000 slows the view and the video. Aim for 5,000 to 50,000. |
| Units | A GLB is read as metres (glTF's unit). An STL is read as millimetres. The person can change this, but don't make them. |
| Up | A GLB should be Y up (glTF's rule). An STL is taken as Z up and stood up on import. |
| Origin | Anywhere. Woodshop centres the model on its footprint and stands it on its bottom. |
| Facing | Put the object's length along X and its front facing +Z, so it needs no turning. |
| Colour | A GLB keeps its materials and textures. An STL has none, so it takes one colour chosen at import. Prefer GLB. |

## 3. Build it

Model only what shows from a metre away: the outline, the rim, the lid, handles, a recess or
two. No hidden insides, no screw threads, no text geometry. Give each visible part its own
material colour (a GLB's `baseColorFactor`), roughly matched to the real thing.

**Blender** (by hand, or scripted with `blender --background --python make.py`). Work in metres
with the default Z up; the exporter converts to Y up. Apply scale and rotation before exporting:

```python
import bpy
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.export_scene.gltf(
    filepath="/path/to/tote.glb",
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_draco_mesh_compression_enable=False,
)
```

**Python with trimesh** (in a virtual environment: `pip install trimesh`). Build in metres with
Y up, from boxes and cylinders:

```python
import trimesh
from trimesh.visual.material import PBRMaterial

IN = 0.0254  # metres per inch

def part(mesh, rgba):
    mesh.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(baseColorFactor=rgba))
    return mesh

body = part(trimesh.creation.box(extents=[24 * IN, 11 * IN, 15 * IN]), [29, 29, 31, 255])
body.apply_translation([0, 5.5 * IN, 0])  # Y up: stand it on y = 0
lid = part(trimesh.creation.box(extents=[28 * IN, 1.25 * IN, 19 * IN]), [242, 194, 48, 255])
lid.apply_translation([0, 11.625 * IN, 0])  # on top of the body
trimesh.Scene([body, lid]).export("tote.glb")
```

Sizes here are placeholders: use the ones from step 1. In trimesh, `extents` are X, Y, Z, so
the height is the middle number.

**From a model site.** A downloaded model works only if its licence lets the person share it:
the 3D plan they send their client carries the model. Note the page and the licence (for
example CC BY 4.0) for the import form. Re-export it to meet the rules in step 2 if needed.

## 4. Check it

Run the checker beside this file. It applies Woodshop's import rules and prints the size as
Woodshop will first show it:

```bash
python3 skills/woodshop-prop-model/scripts/check_model.py tote.glb
python3 skills/woodshop-prop-model/scripts/check_model.py bin.stl --unit in
```

It exits 1 with Woodshop's own message if the file would be refused. Compare its size line with
step 1: length, depth and height should each match within about 1/4". If they are 39 or 25 times
off, the unit is wrong; if two of them are swapped, the up or the facing is wrong.

## 5. Hand it over

Agents cannot import a file; the person does, in the app:

1. Open the design, then Add ▸ Things to show… ▸ Import a 3D model (GLB, STL)…
2. Choose the file. Check the size it shows; use Stand it up or Turn if it lies wrong.
3. Give it a name, where it is from and its licence, then Import.

Tell the person the file's path, its size in inches, its triangle count, and where it came from
or that you made it. Once it is imported, `get_design` lists it under `models`, and an agent can
place more copies with `add_prop` and `model` set to its id.

## Done means

- The checker says OK, and its size matches the real object.
- The file is under 2 MB and under 50,000 triangles, or you said why not.
- Its colours are the real object's, roughly.
- The person has the path, the size, and the source and licence (or "made by me").
