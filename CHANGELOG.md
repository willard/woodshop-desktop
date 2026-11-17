# Changelog

All notable changes to Woodshop are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Board layouts: the cut list draws each board with the parts cut from it, as it does sheets.
  Where the material gives a board width, narrow parts are ripped side by side when that buys
  fewer boards (the kitchen cart's four legs now come from one board).
- Stock on hand: list the part sheets and short boards you already have, and the cut list cuts
  from them before it has you buy anything. Used pieces show in the layouts, PDF and labels.
  Leftovers worth keeping are outlined on the layouts, and Keep the leftovers adds them to the
  list once a design is cut.
- Shopping list: one list to buy for several designs, from the projects page. Shared material is
  bought once and packed together, hardware is added up, and it saves as CSV.
- Part labels: print a sticky label for every piece (name, size, material, which sheet or board),
  in cutting order, on Avery 5160 (Letter) or L7160 (A4) sheets, starting at any label of a
  partly used sheet. In the editor's ⋯ menu.
- Hardware prices: price pulls, hinges, slides, screws and edge banding once, in one list for
  every design. The estimated cost includes them, and the PDF plan and CSV show each line's cost.
- A design assistant in the editor's Assistant tab: ask for changes in plain words and it makes
  them with the same checked tools as an MCP agent. Bring your own API key for Claude or an
  OpenAI-compatible server (Settings ▸ AI agents); the key is kept in the system keychain.
  A reply that changed the design can be undone in one click.
- Settings ▸ About: the version, the licence, links to the source and privacy note, and the
  licenses of the open-source software inside the app.
- Report a problem opens the bug form with your version and system filled in.
- Working in millimetres, hardware is named the way a metric shop sells it: 64 mm butt hinges,
  75 mm casters, 4 × 40 mm wood screws, 300 mm drawer slides.
- Export parts for a CNC router as DXF (outlines, holes and dados on layers named by depth), and
  the assembled model as glTF for other 3D software.
- A first run starts with a welcome: open a sample nightstand and take a five-step tour of the
  editor (look around, select, move, the cut list, export). Run it again from Help.
- Fourteen new templates (25 in all): step stool, entry shelf with hooks, shoe rack, raised
  garden bed, sawhorse, entry bench, dining table, kitchen cart, tool tote, toy chest, wall
  cabinet, base cabinet, three-drawer dresser and media console.
- Drag hardware along its face in the 3D view. It snaps to the face's centre lines and lines up
  with matching hardware on the next drawer front or door; Alt drags freely, Esc puts it back.
- Concealed (Euro) hinges bore their 35 mm cups in the door: shown in 3D, on the shop template
  and in the plan's Drilling section.
- Warnings for a door too thin for its hinge cups and for a drawer box that doesn't leave its
  side-mount slides their clearance.

### Changed

- Sheet layouts pack tighter: when another way of fitting the pieces saves a sheet, the cut list
  uses it. Across the templates that is 39 sheets instead of 44 (the nightstand, wall cabinet,
  bookcase with doors, record stand and desk with drawers each need one fewer).
- Larger, higher-contrast text throughout; Settings is split into sections; icons replace text
  symbols; on macOS the window's own header sits beside the traffic lights, with no separate
  title bar.
- The inspector describes each cut in plain words with an icon, adds cuts from one menu, names
  rotations by what they do (tip, turn, roll), and lets you fold away the sections you don't use.
- The cut list shows what to cut first and the hardware after it, with screws and dowels folded
  into one "Fasteners" line. A sheet much bigger than the job reads as offcut, with the advice
  beside it, and the cost tile says how to add prices. Internal terms ("op", "spec") are gone from
  the screen.
- The editor has a parts list on the left: select, hide or rename any part, including one hidden
  inside the design. Edit and View are a two-way switch, the main tools have icons and labels, and
  new single keys (E, O, M, F, V, P) and a "?" list every shortcut.
- The template gallery shows a picture of every design, a short description of what it is, and
  its size and the sheets or board feet it needs.
- The projects page uses the whole window, five cards across; each card opens its project, with
  Rename, Duplicate, Save and Move to trash in a ⋯ menu. Search and sort appear once there are
  more than a dozen projects, and a new project shows a drawing until it has a picture.
- Moving between screens no longer flashes a blank window: the current screen stays up until the
  next one is ready, and a project opens already drawn.
- The 3D view looks like a shop photo rather than a diagram: soft room light and floor shadows,
  warmer wood with darker end grain, steel-looking hardware, a blue selection tint that shows on
  any wood, and the design framed to fill the view. Fit, Front, Side, Top and 3D buttons sit over
  the view.
- Concealed (Euro) hinges are drawn with their arm and mounting plate inside the cabinet; before,
  the plate stuck out through the cabinet side.
- Woodshop is now free and open-source software under GPL-3.0-or-later.

### Fixed

- Leaving a project (for Settings, or the project list) and opening it again showed the design as
  it was when first opened, not the latest edits. The edits were saved; the editor now reloads
  them, after waiting for the last save to finish.

### Security

- The bundled SQLite is updated to 3.54 (CVE-2026-119375), and `.woodshop` archives are read
  with zip 9.

## [0.1.0] — first build, not published

The first release build, for macOS (universal), Windows and Linux.

- Design furniture in 3D from parts, joints, doors, drawers and catalog hardware (hinges, slides,
  pulls, casters), or start from a template.
- A buildability linter, a cut list with sheet layouts and stock advice, and a hardware list.
- Exports: PDF plan, interactive 3D plan (HTML), cut list (CSV), shop templates (SVG), spec
  (JSON) and `.woodshop` project files.
- Inches (fractions or decimals) or millimetres, everywhere.
- Version history, notes, trash, and daily backups of the library with per-project restore.
- A local MCP server (`woodshop --mcp`) so AI agents can read and edit designs.
- Signed in-app updates from GitHub Releases.

[Unreleased]: https://github.com/willard/woodshop-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/willard/woodshop-desktop/releases/tag/v0.1.0
