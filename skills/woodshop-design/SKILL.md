---
name: woodshop-design
description: Design a piece of furniture in Woodshop through its MCP server (racks, carts, cabinets, shelves, benches), placing parts, joinery, hardware and props until the design checks as buildable. Use when asked to design, build, model or change a woodworking piece in Woodshop, or when the woodshop MCP tools (start_design, add_parts, check_design, ...) are available.
---

# Designing furniture in Woodshop

Woodshop stores a design as a parametric spec: parts, materials, joinery and hardware, in
**decimal inches**. You never write geometry. You call MCP tools; Woodshop validates every call
against its schema and a buildability linter, stores the result, and keeps the previous draft as
a version the person can step back to. The app shows your changes as you make them.

## 0. Setup

The app binary is the MCP server. Point it at a scratch library unless the person has said to
work in their real one:

```bash
claude mcp add woodshop -e WOODSHOP_DATA_DIR=/tmp/woodshop-scratch -- /Applications/Woodshop.app/Contents/MacOS/woodshop --mcp
```

A development checkout uses `target/debug/woodshop --mcp` instead (build it with
`cargo build -p woodshop`). Settings ▸ AI agents (MCP) in the app shows the exact command.

## 1. Read the contract first

Call `get_conventions` before anything else, every session. It is the rulebook the linter judges
you by: the part frame, the rotation recipes, where each op measures from, and the connection and
fastening rules. For one op in full, call it with `{"op": "dado"}` (or `rabbet`, `curve`, ...).
Guessing op shapes against the validator wastes far more calls than reading this once.

Facts to keep in your head:

- **Units.** Every number is decimal inches. Convert first: 40 cm = 15.75, 2 ft = 24. No
  fractions, no feet.
- **World.** Y is up, +Z is the front of the piece, +X is to the right.
- **Part frame.** Length = local +X, width = local +Y, thickness = local +Z, origin at the
  part's centre. `transform.pos` is the centre in world inches; `rot` is intrinsic XYZ degrees.
- **Rotation recipes** (from the conventions; size the part to match the recipe):
  - `[90, 0, 0]` flat board (top, shelf, bottom): l = width (X), w = depth (Z).
  - `[0, 90, 0]` cabinet side: l = DEPTH (Z), w = HEIGHT (Y). Never l = height.
  - `[0, 0, 0]` board on edge facing front (apron, back panel): l = width, w = height.
  - `[0, 0, 90]` upright leg: l = height.
- **Grain.** Set `grainAxis` on every sheet part. A grained part cannot turn on the sheet, so it
  has to fit as oriented (a 72" side from a 96 × 48 sheet is `l: 11.25, w: 72, grainAxis: "w"`).
- **Locked parts.** `"locked": true` in `get_design` means the person adjusted it by hand. Do
  not move, resize, re-cut, re-material, rename or delete it; ask them to unlock it instead.

## 2. Start

- `start_from_template` with no arguments lists the templates. Start from the closest one when
  it fits; it is already placed, joined and fastened.
- `quick_build` makes a shelf unit, open box, table or 2x4 frame from a few sizes, already
  buildable.
- `start_design` makes a blank piece (one base board) to author from scratch.
- To change an existing design: `list_projects`, then `get_design` with its id.

## 3. Build

1. **Plan on paper first.** Write down every part with its size, its rot recipe and its centre
   position, derived from the overall width × depth × height. Do the arithmetic explicitly (the
   conventions have a worked carcass example); mating faces must actually meet.
2. **Materials.** `add_material` for each stock (sheet or board). `set_material_thickness` for
   what the stock really measures (23/32" plywood); it resizes the dados the parts sit in.
3. **Parts in batches.** `add_parts` lands several parts, their ops and the joints between them
   in one call. Prefer it to one-at-a-time `add_part` / `add_op` / `add_joint`.
4. **Changes.** `edit_parts` changes several parts at once and is validated only at the end; it
   is the only way to re-orient a design. `move_part`, `resize_part`, `rename_part`,
   `set_part_material` change one part. `update_op` replaces an op in place (delete + add drops
   the joints that pointed at it). `mirror_parts` makes the other-hand copy.
5. **Doors and drawers** are movables: `add_movable` / `update_movable`, with their hinges,
   slides and pulls chosen there and placed for you.
6. **Other hardware** (casters, pulls on fixed panels, brackets, latches, lid stays):
   `list_hardware` to find a real item, then `add_hardware` on a side of a part. Hardware never
   cuts the part; it is counted in the hardware list.
7. **Props**, things the piece holds that are not built (totes on a rack, paint cans on a
   shelf): `add_prop` with a catalog item (`list_hardware` category `props`), a `shape`
   (`box`, `round`, `tote`, sized in inches), or a `model` the design already has. `pos` is the
   world position of the middle of the prop's bottom. Props are never in the cut list, cost or
   size, and the checks do not test their fit, so work it out from the world boxes of the parts
   they sit on. Agents cannot import 3D files; the person does that in the app (see the
   `woodshop-prop-model` skill for making the file).

Mid-build states may be unbuildable. A part not yet touching another comes back with an advisory
naming what to connect; that is expected while you work.

## 4. Check what you built

- `explain_part` gives a part's world bounding box and which world axis its length, width and
  thickness landed on. Use it whenever you are unsure of a placement, before building on it.
- `render_drawing` with `view` `front`, `side` or `top` draws the whole piece with its overall
  sizes. Look at all three: this catches a part in the wrong place or a hinge on the wrong edge.
- `render_preview` draws one part full-size as a shop template, with its holes and channels.
- `check_design` reports whether the piece is buildable, every linter issue, and the assembled
  overall width × depth × height.
- `get_cut_list` (with `detail: "summary"` for the short form) gives parts, stock to buy, cost
  and assembly order.

## 5. Done means

- `check_design` says buildable, with no errors.
- Its overall size matches what was asked, within 1/16".
- The three `render_drawing` views look like the piece described.
- Every part has a sensible name ("Left Side", not "Part 7") and every sheet part a deliberate
  `grainAxis`.
- You tell the person what you built, its overall size, and anything you assumed (stock
  thickness, joinery, hardware).

## Common mistakes

- A cabinet side sized l = height: it lies on its side and sticks out front and back.
- Positions worked out for 3/4" stock when the material is 23/32": derive from the material.
- Dado offsets measured to the channel's edge; they go to its centreline, from the low edge.
- Deleting and re-adding an op instead of `update_op`, which silently drops its joints.
- Putting a prop in `hardware`, or hardware in `props`.
- Reporting a size from your plan instead of from `check_design`.
