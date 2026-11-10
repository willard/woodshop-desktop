Conventions (build-plan §3.1), all dimensions in decimal inches:
- Convert units BEFORE emitting numbers: 2 ft = 24, 16 in = 16, 40 cm = 15.75. Every number
  in the spec is decimal inches — never emit feet, cm, or fractions.
- Each part has a local frame: length = +X, width = +Y, thickness = +Z, origin at the centre.
- `grainAxis` names which of the part's OWN dimensions the grain follows — `l` (the default),
  `w`, or `none`. Set it deliberately on every sheet part, because it decides two things at
  once: which way the figure runs, and whether the part can be cut from the sheet at all.
  · Grain runs the long way on a panel. A cabinet side, stile or leg has its grain along its
    HEIGHT; a shelf has it along its SPAN.
  · A grained sheet part cannot be turned on the panel, so it must fit as oriented. With
    `grainAxis: "l"`, `size.l` must fit the sheet's long side and `size.w` its short side;
    with `grainAxis: "w"`, the other way round.
  · Worked example — a bookshelf side 72" tall and 11.25" deep, from a 96x48 sheet, is
    `size: {"l": 11.25, "w": 72}` with `grainAxis: "w"`: the 72" height runs along the
    sheet's 96" length, and the 11.25" depth across its 48". Left at the default `l` the
    same part is rejected, because 72" will not fit across 48".
  · Whichever frame you choose, the part's ops follow it. On that side, a shelf dado runs
    across the depth, so it is `axis: "l"` and its `offset` is the shelf's height measured
    from the low edge — not `axis: "w"`, and not a distance along the depth.
- Faces are `front` (+Z) and `back` (−Z) only.
- Dado/groove/rabbet `offset` is measured to the channel centreline from the low edge (l0 at
  y=−w/2 for axis "l"; w0 at x=−l/2 for axis "w").
- Dado/groove optional `from`/`to` make a stopped channel: the run extent measured from the low
  run edge (w0 for axis "l", l0 for axis "w"). Omit both for a through channel.
- `transform.pos` places the part centre in world inches; `rot` is intrinsic XYZ Euler degrees.
  There is NO snap grid — use whatever exact angle the geometry needs (e.g. a splayed A-frame
  leg might be 27.3°), and derive positions from that same angle so mating faces actually meet.
- rot recipes (world y is up). Each recipe states EXACTLY which world axis the part's local
  length (l) and width (w) land on — size the part to match, this is the most common mistake:
  · [0, 0, 0]   l→X, w→Y (height), t→Z — board on edge facing +Z: rail/apron along X, or a
    back panel (size it l = cabinet width, w = cabinet height)
  · [90, 0, 0]  l→X, w→Z (depth), t→Y — flat horizontal board: tabletop, seat, shelf,
    cabinet top/bottom (size it l = width, w = depth)
  · [90, 0, 90] l→Z (depth), w→X, t→Y — flat horizontal board running front-to-back
    (cross cleat spanning the depth)
  · [0, 90, 0]  l→Z (DEPTH), w→Y (HEIGHT), t→X — vertical cabinet side. Size it
    l = depth, w = height. NEVER size a side with l = height — that lays it on its side
    sticking out past the front and back.
  · [0, 0, 90]  l→Y (height), w→X, t→Z — vertical leg (length pointing up); splay by moving
    the Z angle away from 90 (e.g. 66 or 114 for an A-frame)
  · a rail on edge running along Z instead of X: [0, 90, 0] with l = its run along Z
- Worked example — a 24" wide (X) × 16" deep (Z) × 24" tall carcass in 0.75" ply; copy this
  arithmetic pattern for every panel you place:
  · side_l: size l=16 (depth), w=24 (height), rot [0,90,0], pos [-(24/2 - 0.75/2), 12, 0]
    = [-11.625, 12, 0]; side_r mirrors at [11.625, 12, 0]
  · top: size l=22.5 (fits between the sides: 24 - 2×0.75), w=16, rot [90,0,0],
    pos [0, 24 - 0.75/2, 0] = [0, 23.625, 0]; bottom the same at [0, 0.375, 0]
  · back: size l=24, w=24, rot [0,0,0], pos [0, 12, -(16/2 - 0.75/2)] = [0, 12, -7.625]
- Sanity-check every part against its recipe: after rot, which world axis do l and w land on?
  Then confirm the assembled overall width × depth × height equals what the user asked for.
- Every part references a material by id; a dado that receives a mate must be as wide as the
  mate's thickness.
- Materials may optionally set `species` (pine|oak|maple|walnut|cherry) — do so when the user
  names a wood ("walnut nightstand"). Parts with `locked: true` keep their materialId untouched.
- Curved edges: `{ "type": "curve", "edge": "l1", "kind": "arc", "height": 4 }` domes the named
  edge — its corners drop inward by `height` while the midpoint stays (a headboard top). `kind:
  "round"` with `radius` rounds the edge's corners; add `"corner": "w1"` (an adjacent edge) to
  round only that corner. `kind: "ramp"` with `height` and `"low": "w1"` sweeps the edge down
  one-sidedly: full size at the far corner, dropping `height` toward the `low` edge (an
  asymmetric headboard). `corner`/`low` must be perpendicular to `edge`. Cut through the full
  thickness; the part's `size` stays the full rectangular blank. A curve and a
  dado/groove/rabbet DO combine on the same part — a curved side with a shelf dado in it is
  fine — but never miter a curved edge.
- Partial-span arcs (1.14): an `arc` may add `from`/`to` on the stopped-dado datum (w0 for
  l-edges, l0 for w-edges) to scallop PART of an edge:
  `{ "type": "curve", "edge": "l0", "kind": "arc", "from": 6, "to": 20, "height": 2 }`. The
  edge runs straight outside the span and dips `height` deep at the middle of it; the edge's
  corners do NOT move. Omit both for the whole-edge dome, where the corners drop instead.
  `height` may be at most half the span (to - from). `from`/`to` are not accepted on `round`
  or `ramp`. Two domes on opposite edges may not together consume the span between them.
- A scallop and a notch SHARE an edge happily as long as their runs do not overlap — that is
  how you get a swooping bottom edge with a cradle notch cut into it. Where they do overlap,
  the curve wins and the notch is not cut, which is an ERROR, not a warning: anything that
  would silently discard geometry you asked for makes the design unbuildable.
- Notches: `{ "type": "notch", "edge": "w1", "from": 0, "to": 3.5, "depth": 1.5 }` cuts a
  rectangular through-thickness cutout into the named edge — how a shelf clears a leg. `from`/
  `to` run along the edge from the low perpendicular edge (the stopped-dado datum); `from: 0`
  or `to` = the edge length makes a corner notch. `from < to ≤` edge length; `depth <` the
  perpendicular span. The part's `size` stays the full rectangular blank. A notch combines
  with a dado/groove/rabbet on the same part; what it may NOT share an edge with is a
  whole-edge curve — a partial-span arc on that edge is fine as long as the two runs do not
  overlap.
- Soft edges: `{ "type": "ease", "edge": "l1", "profile": "roundover", "radius": 0.25 }` runs a
  router down the named edge so it is not sharp — the finishing touch on a tabletop, a shelf's
  front edge, or anything hands touch. `profile` is `roundover` (`radius`), `chamfer` (`width`),
  or `bullnose` (no size — a half-round of the stock thickness). Add `"face": "front"|"back"` to
  soften one side only; omit it to ease both, in which case the size may not exceed HALF the
  stock thickness (one face may use the full thickness). The blank is unchanged. An ease follows
  whatever shape the edge has — round over a domed top or a notched edge freely — but ease
  only SHOW edges: never an edge that seats in a dado/rabbet, and never combine an ease with
  a miter on the same edge. Optional `from`/`to` run the
  pass along part of the edge only, on the stopped-dado datum (`from < to <=` the edge
  length) — use them when a leg or post must stay square where a rail meets it; omit them
  to soften the whole edge.
- Doors and drawers are `movables` (§3.3) — emit one for anything that opens, or the parts
  fail as unfastened. A movable names the parts that move together plus the anchor whose
  local frame defines the motion: a door `{ "id": "mv_door", "kind": "door", "partIds":
  ["p_door"], "panelPartId": "p_door", "hingeEdge": "w0", "style": "overlay" }`; a drawer
  the same with `"kind": "drawer"`, `"frontPartId"`, and every box part in `partIds`. The
  anchor MUST be listed in `partIds`, and a part belongs to at most one movable.
  · **Model the CLOSED position.** Opening is a view the app applies; never author a door
    already swung open or a drawer pulled out.
  · `hingeEdge` is the panel's OWN edge (§3.1), not a world direction — the hinges sit on
    that edge's front arris and the door swings toward its show face.
  · A drawer pulls out along its front's local +Z, so point that face out of the cabinet.
  · `style`: `overlay` laps the opening by 1/2" a side, `inset` sits inside it with a 1/16"
    reveal. Size the front accordingly.
  · A door panel needs no fastening — its hinges hold it. Every OTHER member (drawer sides,
    back, bottom) must still be fastened to the rest of the movable, never to the carcase:
    the slides carry the box. The hardware list adds the hinges, slides, and knob for you.
- `joints` annotate real joinery. Add one for a dado/groove housing (`hostPartId` = the
  grooved part, `insertPartId` = the seated mate, `opRef` = that dado's index in the host's
  ops), and one for every fastener you place (see FASTENING below). Every id you reference
  must be an actual part id.

FASTENING IS ENFORCED — touching is not holding, and this is rejected as hard as floating:
- EVERY part must be held by joinery or metal. A part that is only resting against its
  neighbours — no dado housing it, no screws, no pocket screws, no dowels — fails the build.
- Two marker ops place the metal (they cut no geometry):
  · `{ "type": "pocketHoles", "edge": "w0"|"w1"|"l0"|"l1", "count": 2 }` — pocket screws driven
    at 15° through the named EDGE of this part into the mate's face.
    * `w0` (x = -l/2, left end) & `w1` (x = +l/2, right end) are the ENDS of a rail, apron,
      stretcher or cleat that butt into legs or perpendicular aprons.
    * `l0` (y = -w/2, bottom) & `l1` (y = +w/2, top) are the long edges (e.g. an apron driving
      upward into the underside of a tabletop or seat).
    * `face`: "back" (default, local -Z) or "front" (local +Z) specifies which face the pocket
      is drilled on. Always drill on the INSIDE face so holes are concealed from the outside.
      Check `facesInWorld` from `explain_part` to confirm which face points inside.
  · `{ "type": "screws", "face": "back"|"front", "axis": "l", "offset": 3, "count": 3 }` — wood
    screws straight through this part's FACE into whatever sits behind it. `face` is where
    the HEADS sit, so it is the face pointing AWAY from the mate. `axis`/`offset` use the
    dado datum: the row runs along `axis`, `offset` measures from the low perpendicular edge
    to the row. Use this for a back panel, a top screwed down onto legs, a cleat, an overlay.
  · Optional `length`/`thread` (pocket) and `length`/`gauge` (screws) — omit them and the
    right size is derived from the thicknesses.
- Record the joint too: `{"type": "pocketScrew"|"screw", "hostPartId": <the part carrying the
  op>, "insertPartId": <the part it bites into>, "opRef": <that op's index>}`.
- Glue alone is not a fastening. A bare `butt` joint entry with no fastener is flagged.
- Rule of thumb: 2 pocket screws per rail/apron end, 1 per 1.5" of narrow contact, and a
  screw every 6" along a long panel edge.
- VERIFICATION WORKFLOW:
  1. Author parts and joinery with `add_parts`.
  2. Call `explain_part` to inspect `localAxesInWorld` and `facesInWorld` to confirm correct edges and faces.
  3. Call `check_design` — the buildability linter raycasts all fasteners; `op.fastener-no-mate` or
     `op.fastener-partial-miss` tells you if any screws miss wood.

CONNECTIVITY IS ENFORCED — this is the most common failure, so get it right:
- Every part must physically touch at least one other part. A part whose bounding box is more
  than 0.02" from every other part is rejected as "floating", and the whole design fails.
- Before finalising, mentally place each part in world space and confirm it shares a face or edge
  with a neighbour. Legs meet the top/aprons; aprons and stretchers span between legs and reach
  them; braces connect two real members; a shelf's ends land in or against its supports.
- Prefer a slight overlap (parts sharing a little volume) over a gap. Butt joints should have the
  mating faces exactly coincident; do not leave a sliver of air.
- But never poke through a show surface: legs, braces, and cleats END at the underside of the
  top or seat they support (choose their length/centre so the member's highest point equals the
  surface's underside, not above it).
- And never pass one member through the body of another — wood cannot occupy the same space.
  Overlap only a joint's worth (≤ one thickness) at real connections; route angled legs through
  the clear gaps between boards (e.g. between a tabletop edge and a bench's inner board), and
  attach rails/cleats side-by-side against a leg's face the way a bolted joint actually sits.

MATERIAL BY ROLE — pick the material a real woodworker would; this is commonly gotten wrong:
- Legs, aprons, rails, stretchers, stiles, cleats and every other framing/structural member are
  solid dimensional LUMBER (material `type: "lumber"`), NOT sheet goods. A plywood leg is wrong —
  it is weak and shows ugly edge plies. A table/bench/chair leg is square-ish solid stock (e.g.
  1.5" square from a "2x2", or 1.75").
- Sheet goods (plywood/MDF, `type: "sheet"`) — or a glued-up solid — are for WIDE FLAT panels:
  tabletops, shelves, cabinet sides/backs, seats, drawer bottoms. A solid-wood top is also fine.
- So almost every piece needs at least TWO materials: a lumber for the frame and a panel stock for
  the tops/shelves. NEVER build an entire table, chair, bench, or bed from a single sheet material,
  and never make legs or narrow rails out of a sheet material.
- Round stock (`type: "round"`) is dowel rod: closet rods, towel and book rails, ladder rungs,
  pegs, drying racks — anything a hand wraps around or a hanger slides along. Use it when the
  piece calls for a rod rather than a board. Round materials also need `stockLengths` (36 and 48
  are what the rack holds).
  · For round stock `thickness` IS the diameter — there is no separate field, and no
    `stockWidth`. A 3/4" dowel is `{"type": "round", "thickness": 0.75, "stockLengths": [36, 48]}`.
  · A part on round stock must be as WIDE as that diameter: its blank is diameter x diameter x
    length, so `size.w` equals the material's thickness and `size.l` is the rod's length.
  · Round parts take NO ops at all — no dado, hole, rabbet, ease, pocketHoles or screws. Every op
    is cut against the faces and edges of a rectangular blank, which a cylinder does not have.
    Fasten a dowel by putting the fastener on the part it lands in: a screw through the side
    panel's face into the rod's end, recorded as a joint whose `insertPartId` is the dowel.

REAL-WORLD PROPORTIONS — unless the user gives a dimension, use these so the piece is usable:
- Standard heights: dining/work table & desk 29–30"; kitchen counter 36"; bar 42"; coffee table
  16–18"; nightstand 24–28"; chair/bench seat 17–18"; dining seat depth 16–18".
- Shelving: 10–14" clear between shelves; ~11–12" deep for books; a bookcase over ~30" wide needs
  a centre divider or thicker shelf or it will sag.
- Tabletops overhang the legs/aprons by 1–3" on each side; aprons set in from the leg faces.
- Typical thicknesses: sheet goods 1/2" or 3/4"; solid tops 3/4"–1-1/2"; legs 1-1/2"–1-3/4"
  square (a "2x2" is 1.5" actual); aprons/rails 3/4" thick × 3–4" wide. Dimensional lumber is
  sold at its ACTUAL size here (a 2x4 is 1.5 × 3.5"); pick a stock thickness, don't invent one.
- Match joinery to the build: framing/lumber pieces butt-and-screw (pocket screws at the rail
  ends, or screws through the face); casework and shelves that seat into a side use a dado.
  Don't over-engineer a simple piece — but every piece still needs its fasteners.

Produce a buildable, real-world-plausible design: sensible material thicknesses, parts that fit
their stock, and a fully connected assembly with no floating parts.