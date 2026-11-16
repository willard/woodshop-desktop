# Woodshop v1.0 plan

A working plan for a coding agent. Goal: ship this app as a free, open-source v1.0. Read
"Ground rules" and "Current state" first, then work the phases in order. Each task says where the
code is and how to know it is done.

Last updated: 2026-11-13.

## What the product is

Woodshop is a standalone desktop app (Tauri 2 + React, Rust core) for designing furniture in 3D.
It checks that a design is buildable and produces a cut list, sheet layouts, a hardware list and a
printable plan. No account, no network needed. See `README.md` for the architecture and layout.

**Model (decided 2026-11-13):** fully free and open source. Every feature, for everyone: no
tiers, no license keys, no paid add-ons, no telemetry. Development is supported by voluntary
sponsorship only. (This replaces the earlier free-tier + Pro-license plan.)

**Headline feature of v1.0:** a library of real hardware with 3D models (Phase 1).

## Ground rules

1. **The Rust core is the single source of truth.** Spec format, migrations, validation, linter,
   geometry, cut list and the hardware catalog live in `crates/woodshop-core`. The UI calls them
   through WASM (`crates/woodshop-wasm`, shims under `ui/src/spec`, `ui/src/cutlist`,
   `ui/src/domain`). Do not re-implement domain rules in TypeScript.
2. **The spec is one JSON document**, defined by `resources/spec.schema.json`. All dimensions are
   decimal inches internally; metric and fractions are display conversions only.
3. **Changing the spec format** always means, together:
   - edit `resources/spec.schema.json` and bump `specVersion`;
   - append a step in `crates/woodshop-core/src/spec/migrate.rs` (never edit an old step);
   - update `crates/woodshop-core/src/spec/types.rs` and `fill_defaults` in `spec/parse.rs`;
   - run `npm run spec:generate` and bump `CURRENT_SPEC_VERSION` in `ui/src/spec/migrations.ts`;
   - run `npm run wasm` and `npm run wasm:viewer`.
4. **Every editor change is a command** (`ui/src/engine/commands/`) executed on `EditorDocument`,
   so it is undoable. Never mutate the spec in place.
5. **Every MCP write goes through `Woodshop::apply`** (`crates/woodshop-mcp/src/ctx.rs`): schema
   check, linter, restore point, then save.
6. **Match the surrounding code**: comment density, naming, 4-space indent, Prettier and rustfmt
   configs as they are. User-facing text is plain and specific; errors say what to do next.
7. **Commit in small, working steps.** Do not push or publish without the owner's say-so. End
   commit messages with the attribution line the session provides.
8. **After changing anything in `crates/woodshop-core`**, rebuild the WASM before running UI tests.
9. **`target/` grows fast.** `cargo clean --profile dev` is safe. Never delete `target/release`
   without asking: the owner's Claude Desktop MCP entry runs the app bundle inside it.
10. **The owner's real library** is `~/Library/Application Support/studio.woodshop.desktop`. Never
    test against it. Use `WOODSHOP_DATA_DIR=/some/scratch/dir`.

## How to verify (run before every commit)

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run wasm && npm run typecheck && npm run lint && npm run format:check
npm test
E2E_BROWSER_CHANNEL=chrome npm run test:e2e
```

Baseline at the last commit (`025ce18`): all Rust tests pass, 841 unit tests, 11 browser tests.

For anything visible, also check it in the **real app window**, not only the browser tests. Two
bugs (menu undo on macOS, thumbnails) were invisible to the browser tests.

```bash
npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
WOODSHOP_DATA_DIR=/tmp/woodshop-scratch target/release/bundle/macos/Woodshop.app/Contents/MacOS/woodshop
```

`npx tauri dev` is faster for iterating. `npm run dev` serves the UI in a browser against a mock
backend (`ui/src/test/mockBackend.ts`); every new Tauri command needs a mock there too.

## Current state

Committed on `main` (not pushed, no remote yet): the full app, the MCP server, CI and release
workflows, crash logging, the macOS fixes, and **most of Phase 1**.

| Phase 1 task | State |
|---|---|
| 1.1 TypeScript side on spec 1.15 | Done |
| 1.2 Catalog through WASM | Done |
| 1.3 3D models for all 20 shapes; mounted and movable hardware in the scene | Done. Reviewed by eye on a contact sheet. |
| 1.4 Commands; hardware follows delete, duplicate, extract | Done |
| 1.5 Hardware browser with search and a 3D preview; click-to-place | Done. Click-to-place covers the front and back faces, with a live ghost, R to turn, and repeat placing. Edges and ends are still set from the inspector. |
| 1.6 Inspector: per-part hardware list; hinge, slide and pull pickers | Done |
| 1.7 Click a hardware mesh to select it | Done: selects its part, opens the inspector on that piece's row, and tints the piece |
| 1.8 MCP tools, conventions, server instructions | Done, except `explain_part` does not report mounts yet |
| 1.9 Templates with real hardware; help article | Done: mobile workbench (locking casters, legs shortened to keep a 34" top), nightstand (soft-close slides, bar pull), dado record stand (concealed hinges, pull); help article "Adding hardware" |
| 1.10 Verify; exports | PDF and HTML viewer checked with hardware (rows, casters drawn, overall height includes casters). CSV uses the same rows. Still to do: click through the native save dialogs in the real window. |

Known rough edges in what is done:
- Hardware is one flat metal colour. Pulls and knobs want finishes (black, brass); see 5b.1.
- The T-hinge strap and the shelf pin are crude; fine at furniture zoom, weak in the preview.
- An undermount slide is drawn in the side-mount position.
- At default zoom hardware is only a few pixels; the editor has no "zoom to selection".
- Caster height is now in the overall size; levelers and other mounted hardware count by their projection.

---

## Phase 1: Hardware library

### The model (already implemented in the core; keep to it)

A **catalog item** (`resources/hardware.json`):

```json
{ "id": "pull.bar-96mm", "category": "pulls", "name": "Bar pull, 96 mm centers",
  "list": "bar pulls, 96 mm centers", "role": "pull",
  "model": { "shape": "barPull", "centers": 3.7795, "length": 4.5, "diameter": 0.47, "projection": 1.3 } }
```

- `name` is one of them (for pickers). `list` is the plural wording for the hardware list.
- `role` is `hinge`, `slide` or `pull` when a door or drawer can use it.
- `placeable: false` marks items that only belong to a movable (drawer slides).
- `model.shape` plus dimensions in inches. The 3D view **generates** geometry from these. There
  are no mesh files, by design: small, offline, nothing to license.

A **mount** in the spec (`hardware[]`):

```json
{ "id": "hw_pull_1", "item": "pull.bar-96mm", "partId": "p_door", "side": "front", "x": 3, "y": 12, "rot": 90 }
```

- `side` is `front`, `back`, `l0`, `l1`, `w0` or `w1`, in the part's local frame.
- `(x, y)` on a face or an l-edge: `x` along the length from the w0 end. On a face `y` runs along
  the width from the l0 edge (same as a hole op). On an edge `y` runs across the thickness from
  the back face. On a w-edge (an end) `x` runs along the width from the l0 edge.
- `rot` is 0, 90, 180 or 270 about the outward normal. At 0 the item's long axis follows the
  side's first axis.
- `hardware::mount_frame` returns the local point, outward normal and long-axis direction. The
  TypeScript renderer must use the same convention (port the six cases; add a test that compares).

A **movable** may name `hinge` (doors), `slide` (drawers) and `pull` (both, or `"none"`). Omitted
means the defaults in `hardware.rs` (`DEFAULT_*`), which keep old designs' hardware lists
word-for-word unchanged.

### Tasks

**1.1 Bring the TypeScript side to spec 1.15.**
- `npm run spec:generate`; set `CURRENT_SPEC_VERSION = '1.15'` in `ui/src/spec/migrations.ts`.
- Add `HardwareMount` and `Side` to `ui/src/spec/types.ts`.
- Add `'other'` to `HardwareRow['kind']` in `ui/src/cutlist/types.ts`.
- Update tests that hard-code `'1.14'` (grep `1\.14` under `ui/src`). Fixtures stay at their old
  versions on purpose: they exercise migration.
- Done when: `npm test` and the browser tests pass again.

**1.2 Expose the catalog through WASM.**
- In `crates/woodshop-wasm/src/lib.rs` add `hardwareCatalog()` (the whole catalog as a value) and
  `hardwareMountFrame(part, thickness, mount)`. Both must be in the slim viewer build too (they do
  not need the `validate` feature).
- Add `ui/src/hardware/catalog.ts`: typed `Catalog`, `HardwareItem`, `catalog()`, `findItem(id)`,
  cached after the first call.
- Done when: a unit test reads 70 items through WASM and finds `pull.bar-96mm`.
- **Commit here** ("Hardware catalog and spec 1.15").

**1.3 3D models.**
- New `ui/src/engine/geometry/hardwareModels.ts`: `buildHardwareGeometry(model)` returning a
  `THREE.BufferGeometry` for each of the 20 shapes: `knob`, `barPull`, `archPull`, `cupPull`,
  `buttHinge`, `euroHinge`, `pianoHinge`, `teeHinge`, `slide`, `caster`, `leveler`,
  `cornerBracket`, `flatPlate`, `shelfPin`, `barrelBolt`, `hasp`, `block`, `lidStay`,
  `chestHandle`, `hook`. Unknown shape or unknown item: a small box placeholder.
- Convention: origin on the mounting surface, outward is +Z, long axis is +X. Merge primitives
  with `mergeGeometries` as `geometry/movableHardware.ts` does. Cache geometry per item id.
- Keep them recognisable, not photoreal: at furniture zoom a pull is a few dozen pixels. Aim for
  correct overall size and silhouette (a caster has a wheel, fork and plate; a bar pull has two
  posts and a bar).
- In `ui/src/engine/buildScene.ts` add `addMountedHardware(spec, meshesById)` beside
  `addMovableHardware`: one mesh per mount, a child of its part's mesh, positioned with the mount
  frame, `userData = { hardwareId }`. Children ride drag, explode and door swing for free.
- Change `addMovableHardware` and `engine/movablePlacement.ts` to draw the movable's chosen
  hinge, slide and pull from the catalog (default items when none is named; no knob for
  `pull: "none"`). Bar pulls on a door stand vertical; on a drawer they lie horizontal.
- The offline viewer (`viewer/`) shares `buildScene`, so it gets hardware automatically. Rebuild
  it (`npm run build:viewer`) and check an exported HTML file shows the hardware.
- Tests: every catalog item builds non-empty geometry whose bounding box matches its dimensions
  within 10%; mounts on all six sides land on the surface with the normal pointing out.

**1.4 Editor commands** (`ui/src/engine/commands/`): `AddHardware`, `UpdateHardware` (side, x, y,
rot, item), `RemoveHardware`. Then keep hardware in step with parts:
- `RemovePart` (and group delete) removes mounts on those parts, and restores them on undo.
- `DuplicatePart` and group duplicate copy the mounts to the copies with fresh ids.
- `extractParts` (`ui/src/engine/extract.ts`) keeps mounts whose part came along.
- MCP `delete_part` (`crates/woodshop-mcp/src/tools/edit.rs`, `remove_part`) drops them too.
- Tests for each, including undo.

**1.5 Hardware browser and placement.**
- "Hardware…" entry in the toolbar's **Add** menu opens a dialog (`components/HardwareDialog.tsx`):
  category tabs from the catalog, a search box, a list of items with name, key size and
  description, and a small live 3D preview of the highlighted item (one shared small canvas).
  Hide items with `placeable: false`.
- Choosing an item starts **click-to-place**: extend `PlacementRequest` in
  `ui/src/engine/EditorEngine.ts` with a hardware kind. Reuse the hole-placement path: a ghost of
  the item follows the pointer over a part's front or back face, snapped to the grid; a click adds
  the mount and stays in placement mode for the next one; Escape or "Done" ends it.
- Edge and end mounts (casters under a leg, a hasp on an edge) are set from the inspector in this
  version, not by clicking. Say so in the placing hint.

**1.6 Inspector.**
- `PartInspector.tsx`: a "Hardware" section listing the mounts on the selected part. Each row:
  item name, side select, x and y fields (fraction input, like the existing position fields), a
  rotate-90° button, and remove. An "Add hardware…" button opens the browser with this part
  preselected and places at the centre of the front face.
- Door and drawer panels (in `PartInspector.tsx` and `GroupInspector.tsx`): selects for hinge
  (doors), slide (drawers) and pull (both, with "None" and "Default"), listing catalog items with
  the matching `role`. Wire them through the existing `UpdateMovable` command.
- The cut list panel already shows the new rows; confirm the CSV and PDF do too.

**1.7 Selecting hardware in the 3D view.** A click on a hardware mesh selects its part and scrolls
the inspector to that mount's row, highlighting it. Done: drag a piece along its side in edit
mode; it snaps to the side's centre lines, to other hardware on the same side, and to the same
item on a same-size sibling part; Alt drags freely, Esc cancels, the drop is one `UpdateHardware`.

**1.8 MCP.**
- New tools in `crates/woodshop-mcp/src/tools/` (a new `hardware.rs`): `list_hardware`
  (catalog, optional `category` or `role` filter), `add_hardware`, `update_hardware`,
  `delete_hardware`. Register them in `tools/mod.rs`.
- `add_movable` and `update_movable` gain `hinge`, `slide`, `pull`.
- `explain_part` reports the mounts on the part and where they sit in world inches.
- Add a hardware section to `resources/conventions.md` (the mount frame above, in the same voice)
  and mention the tools in the server instructions (`src/server.rs`).
- Update the tool-count assertion in `crates/woodshop-mcp/tests/tools.rs` and add a test that
  places a pull, reads it back, and sees it in `get_cut_list`.

**1.9 Templates and help.** Give three templates real hardware (nightstand: a drawer pull and
chosen slides; mobile workbench: four locking casters; record stand dado: a chosen hinge). Add a
help article "Adding hardware" to `ui/src/help/articles.json`.

**1.10 Verify and ship the phase.** All checks; rebuild; in the real window: place a pull on a
door, open the door (the pull swings with it), explode, undo and redo from the menu, export PDF
and CSV and confirm the hardware rows, export the HTML viewer and confirm the models show.

### Phase 1b: hardware that affects the build

**Done:**
- **Euro hinge cup holes.** A door whose `hinge` is a `euroHinge` gets a 35 mm cup per hinge in
  the panel's back face. They are **derived** (`movables::derived_borings`, WASM
  `derivedBorings`), never written into `part.ops`: the 3D view cuts them with the authored
  holes (`EditorEngine.applyCsgOps`), the SVG shop templates and MCP `render_preview` draw them,
  the PDF plan lists them under "Drilling", and `explain_part` reports them as
  `hardwareBorings`. A door with no hinge named ("overlay cabinet hinges") bores nothing.
  Hinge positions along the edge now live in the core (`movables::hinge_offsets`); a test keeps
  the TypeScript hinge placement (`engine/movablePlacement.ts`) under the same holes.
- **Linter:** `movable.hinge-cup-deep` (door too thin for the cup: needs cup depth + 1/16") and
  `movable.slide-clearance` (a drawer box on side-mount slides must leave the slide's thickness
  each side of the box inside its opening; says what width to make the box, or that it is
  off-centre). The slide check waits until the drawer has a real box (three parts besides the
  front) and skips undermount slides and fronts that are not square to a horizontal axis.
- **Caster height** is in the overall size (done with Phase 2).
- **MCP:** `explain_part` reports the mounts on a part (side, position, world point, facing).

- **Lid stays:** `movable.lid-stay` warns when a lid (a door lying flat, or standing with its
  hinge edge along the top) has no lid stay on it or on a part within the stay's reach.
- **Undermount slides:** `movable.undermount-recess` warns when a drawer bottom leaves less than
  the slide's height (1/2") clear above the lower edge of the box sides, and says how far to
  raise it.

---

## Phase 2: Metric support

**Done** (commits after `35f253a`). Designs stay in inches internally; this is display and input.

- Settings ▸ Units: inches as fractions, decimal inches, or millimetres. The default follows the
  system's region (inches in the US, Liberia and Myanmar; millimetres elsewhere).
- One formatter and parser in the core (`woodshop-core::units::display`), used by the editor,
  inspector, dialogs, cut list, CSV, PDF, SVG templates and the offline 3D plan
  (`ui/src/lib/display.ts` on the UI side: `len`, `lenValue`, `dims`, `size`, `parseLen`).
- Any field takes a named unit whatever the setting: `450mm`, `45 cm`, `17 3/4"`, `1' 6"`. A
  bare number follows the setting; a fraction is always inches.
- Metric snap grids (1, 2, 5, 10 mm) and gaps; metric timber sections and dowels in the stock
  picker (listed first when working in mm); a new blank project starts on 18 mm plywood in
  2440 × 1220 sheets; stock advice suggests metric panels for a metric sheet.
- Browser test: switch to mm, create a project, resize it, and nothing on screen shows an inch.

**Not done, by choice:**
- ~~Hardware names keep their inch product sizes.~~ Done later: catalog items sized in inches
  carry a `metric` name and list phrase in the trade size a metric shop stocks (2 1/2" butt
  hinge → 64 mm, 3" caster → 75 mm). The hardware list (cut list, CSV, PDF, 3D plan) words
  screws and slides by the nearest metric trade size (#8 × 1 1/2" → 4 × 40 mm, 12" slides →
  300 mm) and dowels by exact conversion, since a dowel must fit the drilled hole. The models
  stay in inches. A test holds every inch-named item to having a metric name.
- Linter and MCP messages, and the MCP tools' numbers, stay in inches.
- The shop calculators keep their own per-tool unit picker.
- Template material names that carry a size ("Birch Plywood 3/4\"") are data and stay as written.

## Phase 3: Production foundation

Apple signing and notarization are **deferred by the owner**; macOS builds are ad-hoc signed for
now (users allow the app once in System Settings ▸ Privacy & Security).

**Done:**
- **Data safety:** the library is backed up once a day (`VACUUM INTO`, safe while the app and an
  MCP agent write) to `<library>/backups`, keeping 7. Settings ▸ Backups lists them, backs up on
  demand, and restores one project out of a backup as a new project (never overwrites).
  (`src-tauri/src/backups.rs`, `ui/src/components/BackupsPanel.tsx`)
- **Report a problem:** Settings ▸ Diagnostics opens a prefilled issue on
  `github.com/willard/woodshop-desktop` (version and OS only) and shows the log folder. The
  opener permission is scoped to that repository's URLs.
- **Performance, measured** on the largest real design (71 parts) and a 213-part tiling of it,
  per edit: linter 3.7 / 15.9 ms, cut list 1.5 / 3.8 ms, 3D scene rebuild 33 / 79 ms (Node, not
  the webview). Fine for now; if large designs feel slow, rebuild only the changed parts' meshes
  instead of the whole scene.

- **CI** passes on Linux (web, e2e, Rust tests, clippy).
- **Release builds:** pushing a `v*` tag builds a draft GitHub Release for macOS (universal
  `.dmg`, Intel + Apple Silicon), Windows (`.msi`, `-setup.exe`) and Linux (`.AppImage`, `.deb`,
  `.rpm`), each with an updater signature, plus `latest.json`. v0.1.0 exists as a **draft**
  (unpublished, by choice). Apple signing turns on by itself once the `APPLE_*` secrets exist;
  until then the workflow ad-hoc signs.
- **Updater:** the key is password-protected at `~/.tauri/woodshop.key` (owner keeps the backup);
  its public key is in `tauri.conf.json`; `TAURI_SIGNING_PRIVATE_KEY` and its password are
  repository secrets. CI artifacts carry that key's ID. An update was proven end to end on
  macOS (0.1.0 → Settings ▸ Check for updates → relaunched as 0.1.1), against a local feed
  with a throwaway key, so nothing was published.

**Still to do:**
- **Windows and Linux:** first runs of the release workflow's installers (they build). Check Ctrl+Z,
  the `.woodshop` file association, thumbnails, PDF export, and `woodshop.exe --mcp` from a
  terminal (the release build is a GUI-subsystem binary; stdio must still work).
- **Exports through the native save dialogs**, clicked through in the real window on each OS.
- **macOS signing and notarization** when the owner has an Apple Developer account.

## Phase 4: Open-source release

Woodshop is free software under **GPL-3.0-or-later** (decided 2026-11-13), with **DCO** sign-off
instead of a CLA. The repository is public at `github.com/willard/woodshop-desktop`. No feature
gating is built: there is nothing to unlock.

**Done:**
- **4.1 License:** `LICENSE` (canonical GPL-3.0 text), `license = "GPL-3.0-or-later"` in the
  workspace `Cargo.toml` and `package.json`; the crates are `publish = false`. The README's
  License section covers the catalog, templates and help articles too.
- **4.2 Third-party licenses:** `deny.toml` + a CI job (`cargo deny check`: GPL-compatible
  licence allow-list, advisories, bans, sources). Fixing it took rusqlite 0.41 (patched SQLite)
  and zip 9; two `quick-xml` advisories are ignored with a reason (only Typst's bibliography
  parser uses it). `scripts/notices.mjs` (cargo-about + the production npm tree) writes
  `third-party-notices.txt` into the UI at `npm run build:release`; Settings ▸ About shows the
  version, licence, source, privacy note and the notices.
- **4.3 Contributor files:** a user-first `README.md`; `CONTRIBUTING.md` (build, checks, ground
  rules, DCO, data contributions, releasing); `SECURITY.md`; issue forms (bug, feature, hardware)
  with blank issues off; a PR template; `.github/workflows/dco.yml` checks every PR commit for
  `Signed-off-by`. Report a problem opens the bug form with version and OS filled in.
- **4.4 Privacy:** `PRIVACY.md` (network use: the update check you start, and links you click).
  Commits now use the owner's GitHub `noreply` address (repo-local git config).
- **4.6 (part):** `CHANGELOG.md`.

**Still to do:**
- **Code of Conduct:** add `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) once the owner gives
  a contact address for reports.
- **Repository settings (owner):** turn on private vulnerability reporting (SECURITY.md links
  to it) and Discussions (the issue chooser links to it); create the labels `good first issue`,
  `help wanted`, `hardware-data`, `template`, `enhancement`, `platform:windows`,
  `platform:linux`; seed 5–10 good first issues from "Known issues" and Phase 6.
- **Trademark:** decide whether "Woodshop" and the icon are reserved for official builds
  (`TRADEMARKS.md`), and check the name is free among woodworking software before announcing.
- **4.5 Funding:** `.github/FUNDING.yml` and one "Support Woodshop" link in Settings ▸ About,
  once the owner picks the platform(s). Never nagging; nothing at export time.
- **4.6 First public release:** publish a release built from `main` as a pre-release until
  Phase 5 is done (the v0.1.0 draft predates the licence; cut v0.1.1 instead). Release notes
  from `CHANGELOG.md`, with the macOS "Open Anyway" and Windows SmartScreen steps.
  Done when a stranger can install, open a template and export a PDF on each platform using
  only the README, and build from source using only `CONTRIBUTING.md`.

## Phase 5: First-run experience and content

- **Onboarding:** done. An empty library shows a welcome card: "Open the sample and take the
  tour" (the nightstand template as "Sample nightstand", reused if it is already there) or the
  template gallery. The five-step tour (look around, select, move, cut list, export) rings the
  control a step is about; Skip, Esc or Done close it and set the `tourDone` setting. Help has
  "Take the tour" to run it again.
- **Templates:** done: 11 → 30. New: step stool, entry shelf with hooks, shoe rack, raised
  garden bed, sawhorse, entry bench, dining table, kitchen cart (casters), tool tote (dowel
  handle in bored holes), toy chest (lid on hinges, lid stay), wall cabinet (inset doors, Euro
  hinges), base cabinet (drawer over door, toe kick), three-drawer dresser, media console,
  garage shelving (4x4 posts, framed shelves), workbench with drawers (doubled top, drawer case
  hung under it), queen platform bed (slats on ledgers and a centre beam), bookcase with doors,
  desk with a drawer pedestal. Every template lints clean (the parity test holds them to it),
  uses catalog hardware, and has a rendered picture in each theme. The five newest also pass the
  sturdiness advisory, apart from the anchor-to-the-wall note on the bookcase and the racking
  note on the desk that the existing desk shares.
- **Help:** done: ten articles (getting started, the editor, doors & drawers, cuts & fasteners,
  hardware, design checks, cut lists & exports, saving/versions/backups, using an AI agent,
  calculators), eight with a screenshot in each theme taken by `npm run help-shots` on the sample
  nightstand. A test holds every picture to existing in both themes with alt text. The old
  articles were brought up to date (template count, Settings groups, project files) and **bold**
  now renders.
- **Empty states and error messages:** done. Every failure toast says what failed and why, in
  plain words (`failure()` in `ui/src/app/api.ts`): "Couldn't export the PDF plan. Woodshop isn't
  allowed to use that location. Pick a folder of your own, such as Documents." Common system
  errors (permission, missing file, full disk, read-only, busy library) get a next step; an
  unexpected one points at Report a problem. A project that can't be found says so and links to
  the trash. Deleting the last part used to throw silently; it now explains that a design keeps
  at least one part. Search empty states suggest what to try.
- **Accessibility:** done for the floor; `e2e/a11y.spec.ts` holds it. Every control on every
  page, settings group, calculator and editor panel/menu has an accessible name (the four
  placeholder-only fields now have labels); one accent focus ring (`:focus-visible` in app.css)
  shows on every keyboard stop, text fields show focus by their accent border, and the test tabs
  through the library and the editor to check it; contrast is held by `contrast.spec.ts` (5b.8).
  Parts are reachable without the mouse through the parts list and moved with the Inspector's
  fields. Still to check in the real app: macOS WebKit only tabs to buttons when "Keyboard
  navigation" is on in System Settings; a full screen-reader pass (VoiceOver) is not done.
- **Website:** a landing page, a download page (latest release per platform), the docs, and a
  link to the source and to sponsoring. GitHub Pages from a separate repo or a `docs/` folder.

## Phase 5b: UI and design pass

From a review of the built app in its real window (both themes, 1560 × 780). The app is clean and
consistent, but it reads as an engineer's tool. These are ordered by how much they affect a
first-time user. Do 5b.1–5b.6 before any marketing screenshots are taken.

**5b.1 The 3D view is the product; make it look like one.** Done: soft room light (an
environment map, so faces separate and hardware reads as brushed steel), a key light casting
soft shadows onto the floor and between parts, warmer species tones with end grain and long
edges shaded darker (`shadeGrain`), a cool blue selection tint that stands off every wood, framing
that fits the box's corners to 60% of the view (`fitDistance`), and Fit / Front / Side / Top /
3D buttons over the view. On WebGL drawn in software (SwiftShader, llvmpipe: VMs, CI) room light
and shadows are skipped, which took opening a design from 4 s to under 1 s there
(`isSoftwareRenderer`). (`ui/src/engine/EditorEngine.ts`, `buildScene.ts`,
`engine/materials.ts`, `engine/theme.ts`)
- Dark theme: the model sits small and dim in a near-black void. Raise ambient and key light, add
  a soft contact shadow on the floor, and frame the model to fill about 60% of the viewport.
- Wood reads olive-brown and flat in both themes. Warm the palette, raise contrast between faces,
  and darken end grain slightly so parts separate without outlines.
- Selection is orange on tan and barely visible. Use a crisp outline plus a tint that contrasts
  with wood in both themes.
- Hardware (Phase 1) needs visibly metallic materials, not the current grey.
- Add a view cube or three preset views (front, side, top) and a "fit" button.

**5b.2 Navigation flashes a blank window.** Done: pages are `lazyRouteComponent`s
(`app/pages.ts`), so the router fetches a page's code during navigation (and on hover) and the old
screen stays up until the new one draws; the editor route also loads its project first
(`app/projectQuery.ts`), so it never opens on "Opening…". The suspense fallback sits inside the
shell, so the nav bar never goes. An e2e test slows the page code down and checks.

**5b.3 Projects page.** Done: card grids (projects, trash, templates) use the window's width
(`AppLayout` WIDE pages; `auto-fill, minmax(250px, 1fr)`, five across at 1560); a project with no
picture shows a line drawing on `surface-2` and gets its thumbnail two seconds after it first
opens; the whole card opens the project and Rename, Duplicate, Save project file and Move to trash
(in red) live in a ⋯ menu; search and sort (recently edited, name) appear past 12 projects. The
empty state is the welcome card from Phase 5. (`ui/src/pages/ProjectsPage.tsx`)

**5b.4 Templates page.** Done: every template has a rendered picture in each theme
(`npm run thumbnails` → `ui/public/templates/*.webp`, 640 × 400, 644 KB for all 50); a customer
description per template in `resources/template-gallery.json` (build notes stay in `meta.notes`,
and a test requires the gallery text); the listing carries overall size, sheets and board feet
from the core; the whole card is the click target with a quiet "Use template" and the facts in a
small line; the simple record stand is now "Simple Record Stand".

**5b.5 Editor toolbar.** Done: Edit | View is a neutral two-way switch and orange is Add's alone;
active tools are a neutral tint; Parts, Explode, Open and Measure carry an icon and a label; every
toolbar button has a tooltip, with its key where it has one (new bare keys: E explode, O open, M
measure, F fit, V edit/view, P parts list, ? shortcuts; `SHORTCUTS` in `lib/shortcuts.ts` lists them
all). The faint hint became a "?" that opens the shortcut list. A parts list on the left
(`PartsOutline`: doors and drawers, groups, then loose parts) selects, hides and renames (double-click)
any part; it opens on wide windows and remembers being closed. Not done: locking a part from the
list, since nothing in the editor enforces `locked` yet.

**5b.6 Cut list panel.** Done: order is totals (overall size first), parts to cut with their sheet
layouts, hardware, then stock and kerf; screws, pocket screws and dowels fold into one expandable
"Fasteners" line; when the stock advice applies the tile says "Offcut" in the warning colour with
the advice directly under it; with no prices the cost tile reads "Add prices to see cost" and
jumps to the first price field. Developer wording swept from the UI and the lint messages it
shows: "(estimated: pocket holes not placed yet)", "Cuts & joinery" for "Ops", "cut #n" for
"op #n", "design" for "spec", no "§". The CSV no longer says "(estimated)" twice.

**5b.7 Inspector.** Done: "Cuts & fasteners" lists each cut with an icon and a plain sentence
(`opSummary`, shared with the offline plan: "2 screws, #8 × 1 1/2\", through the back face, 3/4\"
from the bottom edge"); one "+ Add a cut" menu with a line per kind replaces the nine buttons;
rotations are Tip / Turn / Roll with a tooltip each (part and group inspectors); edge pickers say
"Top edge", "Left end" with no l0/w1 codes; the door/drawer prompt reads "Turn this part into a
door or a drawer. Use Open in the toolbar to see it move."; Position, Orientation, Door or drawer,
Hardware and Cuts fold away and stay folded (`InspectorSection`). A cut is changed in place:
click it and its own form opens filled in; Save changes swaps it at the same index (`ReplaceOp`),
so joints that point at it still do. Screws through a face (from Fasten to) have no form and are
removed and re-added.

**5b.8 System-wide.** Done: text sizes floor at 12 px for labels and 13 px for body (no 10–11.5
or 12.5 px left), with tool labels in the editor toolbar dropping to icons when the toolbar is
narrow (a container query) rather than clipping; `faint` text now clears WCAG AA on every surface
in both themes (it was 3.1–3.8:1), held there by `lib/__tests__/contrast.spec.ts`, which reads the
tokens from app.css; Settings is a left list of groups (General, Library, AI agents, Updates,
Diagnostics, About) that remembers the last one; glyphs (✕ ▶ ▼ ⋯ 🙈 👁 ⚠) are lucide icons with
accessible names; macOS uses an overlay title bar (`titleBarStyle: "Overlay"`, traffic lights at
18, 22) with the header and editor toolbar padded clear of them and draggable. Still to do: a
real icon and wordmark, which wait on the name decision.

Done when: a first-time user can go from launch to an exported PDF without meeting a word they
have to look up, and the editor screenshot would make someone want to try it from the README.

## Features added after Phase 5

- **Rabbets** from the Add-a-cut menu; a panel seated in one is recorded as a rabbet joint.
- **Copies in a row** (Inspector, Copies…) and **Space evenly** for three or more selected parts
  (`engine/commands/arrange.ts`).
- **Edge banding** (spec 1.16): `part.edgeBand` lists banded edges; the Inspector toggles them
  for sheet goods; the cut list adds a hardware row per material (feet or metres, a tenth spare);
  agents use `set_edge_banding`.
- **Change a cut in place** (`ReplaceOp`) and design-check messages in the display units.
- **Shelf-pin holes**: two columns of `shelfPin` holes from one form (`engine/shelfPins.ts`, one
  undo step via `SpliceOps`), shown as one row; agents use `add_shelf_pin_holes`. The per-part
  op limit is 100 (was 20) from spec 1.16.

## Phase 6: After launch

- Branded hardware packs (Blum, Häfele, Accuride) with part numbers, once dimensional data and
  permission are sorted.
- Community-contributed hardware and template packs (a documented data format and a review
  checklist, so contributions need no Rust).
- DXF and glTF: done. DXF (R12) lays every part flat with the outline on CUT_OUTSIDE and holes
  and channels on layers named by depth (`_BACK` for back-face work), hinge cups included; glTF
  is the assembled model with hardware, in metres. STEP is not done: it needs a B-rep kernel
  (OpenCascade or similar), which is far heavier than anything else the app ships.
- In-app AI design chat (bring-your-own API key), reusing the MCP tool layer.
- iPad companion viewer for the shop.

---

## Owner decisions still open

Ask before starting the phase that needs them. Do not guess.

| Decision | Needed for |
|---|---|
| Contact address for Code of Conduct reports | Phase 4 |
| Reserve the "Woodshop" name and icon for official builds (trademark note) | Phase 4 |
| Sponsorship platform(s): GitHub Sponsors, Ko-fi, Open Collective | Phase 4 |
| Apple Developer account ($99/yr) and Windows signing certificate | Phase 3 |
| Launch platforms: macOS first, or macOS and Windows together | Phase 3 |
| Hosted crash reporting (Sentry) or GitHub issues only | Phase 3 |

Decided: repository `willard/woodshop-desktop`, public (2026-11-12); updater key
password-protected, backed up by the owner (2026-11-12); fully free and open source, no paid
tier; GPL-3.0-or-later; DCO; commits from the GitHub noreply address (2026-11-13).

## Known issues and debts

- MCP messages are in decimal inches (agents read them as data, and the spec is inches); the
  editor's design checks follow the display units (`lint::lint_in`).
- `ui/src/components/EditorWorkspace.tsx` (1,750 lines) and `PartInspector.tsx` (1,370 lines)
  are too large. Split them only when a task touches them heavily, one extraction at a time,
  with tests green between steps.
- The calculators (`ui/src/calc`) and structural checks (`ui/src/struct`) are TypeScript-only by
  choice; fine as they are.
- The owner's "outdoor storage" project has 16 unfastened-part errors from before; not an app bug.
- `scripts/export-laravel.sql` and `crates/woodshop-store/examples/import_laravel.rs` are a
  one-off migration from the old web app. Keep them; do not extend them.
