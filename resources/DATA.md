# Contributing hardware and templates

Hardware and templates are plain JSON in this folder. Adding either needs no Rust and no
TypeScript: the app, the cut list, the PDF, the offline viewer and agents all read these files.
This page describes the formats and what a reviewer checks.

## Hardware: `hardware.json`

The file has two lists, `categories` and `items`. A new item goes next to its neighbours in the
same category.

```json
{
  "id": "pull.bar-128mm",
  "category": "pulls",
  "name": "Bar pull, 128 mm centers",
  "list": "bar pulls, 128 mm centers",
  "role": "pull",
  "description": "A plain round bar on two posts.",
  "model": { "shape": "barPull", "centers": 5.04, "length": 5.75, "diameter": 0.47, "projection": 1.3 }
}
```

| Field | Required | What it is |
|---|---|---|
| `id` | yes | `kind.size-or-variant`, lowercase with hyphens, unique. Designs refer to it, so never rename or remove one that has shipped. |
| `category` | yes | One of `pulls`, `hinges`, `slides`, `casters`, `feet`, `brackets`, `shelf`, `latches`, `lids`, `hooks`. |
| `name` | yes | One of them, as a picker shows it: `Bar pull, 128 mm centers`. |
| `list` | yes | Several of them, as the shopping list says it: `bar pulls, 128 mm centers`. Lowercase. |
| `metric` | when `name` gives an inch size | `{"name": …, "list": …}` in the size a metric shop sells: `Butt hinge 64 mm`. |
| `role` | for doors and drawers | `hinge`, `slide` or `pull`: the item can be chosen on a door or drawer for that job. |
| `placeable` | no | `false` for items that only make sense on a door or drawer (drawer slides). |
| `description` | no | One sentence on what it is for. |
| `model` | yes | `shape` and that shape's dimensions, below. |

Every dimension is in **decimal inches**, measured from the manufacturer's data sheet (say which
one in the pull request). Convert millimetres by dividing by 25.4 and keep about three decimals.

### Shapes

The 3D view draws the item from its `model`, so a new size is one row. The origin is on the
surface it is screwed to; *projection* is how far it stands out from that surface, and the
long axis runs along the item's length. A dimension left out falls back to a typical value,
but give every one you can measure. A field not listed for its shape is an error.

#### `knob`
- `diameter`: across the head.
- `projection`: from the wood to the face of the head.
- `square`: `true` for a square head.

#### `barPull`
- `centers`: between the two screw holes. This is the size pulls are sold by.
- `length`: overall, end to end.
- `diameter`: of the bar.
- `projection`: from the wood to the front of the bar.

#### `archPull`
- `centers`: between the screw holes; the arch spans them.
- `diameter`: of the handle.
- `projection`: from the wood to the top of the arch.

#### `cupPull`
- `width`, `height`: of the hood.
- `projection`: from the wood to the front of the hood.

#### `buttHinge`
- `height`: along the knuckle.
- `width`: both leaves open flat.
- `knuckle`: diameter of the barrel.

#### `pianoHinge`
- `length`: the stock length. It is cut to the edge it hangs, so this is what to buy.
- `width`: both leaves open flat.
- `knuckle`: diameter of the barrel.

#### `teeHinge`
- `length`: of the strap, from the knuckle to the tip.
- `height`: of the leaf on the frame (the crossbar of the T).
- `knuckle`: diameter of the barrel.

#### `euroHinge`
Concealed cup hinges. The door gets its cup bored from these numbers, so they must be exact.
- `cup`: cup diameter (35 mm is `1.378`).
- `cupDepth`: how deep the cup is bored.
- `boring`: from the door's hinge edge to the cup's centre.
- `overlay`: how far the door covers the cabinet side; `0` for an inset door.
- `arm`: how far the arm reaches back to its plate.

#### `slide`
Drawer slides, cut to the drawer's depth.
- `mount`: `side` (one on each side of the box) or `under` (hidden under the box).
- `height`: of the rail.
- `thickness`: of the rail. For side-mount slides this is the gap each side of the drawer box,
  and the design check uses it.

#### `caster`
- `wheel`: wheel diameter.
- `height`: from the mounting plate to the floor. This is what it adds under the piece.
- `plate`: width of the mounting plate.
- `swivel`: `true` for a swivel caster.
- `brake`: `true` for one that locks.

#### `leveler`
- `base`: diameter of the pad.
- `height`: from the surface to the floor.
- `stem`: diameter of the threaded stem; `0` for a glide with none.

#### `cornerBracket`
- `leg`: of each arm.
- `width`, `thickness`: of the steel.

#### `flatPlate`
Mending plates and shelf standards.
- `length`, `width`, `thickness`.

#### `shelfPin`
- `diameter`: of the hole it fits.
- `length`: overall; about half goes in the hole.

#### `barrelBolt`, `hasp`, `block`, `lidStay`
- `length`: along the item.
- `width`: across it.
- `projection`: from the surface.

#### `chestHandle`
- `width`, `height`: of the back plate.
- `projection`: of the bail from the surface.

#### `hook`
- `height`: of the back plate.
- `width`: across it.
- `projection`: how far the hook reaches.
- `double`: `true` for a second, shorter hook.

A new shape needs a builder in `ui/src/engine/geometry/hardwareModels.ts` and a section here,
which is a code change; open an issue first.

## Templates: `templates/`

A template is a design file. Its file name is its id (`media-console.json` is `media-console`),
in lowercase letters, digits and hyphens. To add one:

1. Build it in the app, or write it by hand following [`conventions.md`](conventions.md), and
   save the design's JSON to `templates/<id>.json`. Give it `meta.difficulty`, `meta.tags` and
   build notes in `meta.notes`.
2. Add one or two sentences for the gallery card to `template-gallery.json`: what it is, for
   someone choosing.
3. Add its expected design checks to `crates/woodshop-core/tests/fixtures/lint-expected.json`
   as `"template:<id>": []`. A finished template has no
   errors; a warning that stays needs a reason in the pull request.
4. Render its pictures with `ONLY=<id> npm run thumbnails` on a machine with a GPU, and commit
   the two `.webp` files it writes to `ui/public/templates/`.

## Review checklist

For the contributor and the reviewer of a hardware or template pull request:

- [ ] Hardware dimensions come from a linked data sheet, in decimal inches.
- [ ] The `id` is new and follows the pattern; no shipped id is renamed or removed.
- [ ] `name` and `list` read naturally ("Bar pull, 128 mm centers" / "bar pulls, 128 mm
      centers"), and an inch-named item has a `metric` pair.
- [ ] The model uses only its shape's fields, and the item looks right in the hardware browser's
      preview (Add, Hardware…).
- [ ] A template opens from the gallery, shows no design-check errors, and its cut list, PDF and
      hardware list make sense for someone building it.
- [ ] A template uses catalog hardware by id, not generic hardware text.
- [ ] Gallery text is one or two sentences; build notes stay in `meta.notes`.
- [ ] `cargo test -p woodshop-core` passes. It checks the catalog's fields and shapes, the
      gallery text, and every template against its lint entry.
- [ ] Commits are signed off (`git commit -s`).
