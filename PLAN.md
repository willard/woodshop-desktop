# Woodshop v1.0 plan

A working plan for a coding agent. Goal: turn this app into a product that can be sold. Read
"Ground rules" and "Current state" first, then work the phases in order. Each task says where the
code is and how to know it is done.

Last updated: 2026-11-10.

## What the product is

Woodshop is a standalone desktop app (Tauri 2 + React, Rust core) for designing furniture in 3D.
It checks that a design is buildable and produces a cut list, sheet layouts, a hardware list and a
printable plan. No account, no network needed. See `README.md` for the architecture and layout.

**Business model (decided):** free tier plus a one-time Pro license (about $59–79, one year of
updates). No subscription. Sold through a merchant of record (Lemon Squeezy or Paddle). The app
verifies a signed license key offline.

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
workflows, crash logging, and the macOS fixes.

**Uncommitted work in progress: the first half of Phase 1.** The Rust core side of the hardware
library is written and `cargo test --workspace` passes, but the TypeScript side has not caught up,
so **the UI tests and the app do not work from this tree until tasks 1.1 and 1.2 are done.**

| Done (uncommitted) | File |
|---|---|
| Catalog: 70 items, 10 categories, 20 model shapes | `resources/hardware.json` |
| Catalog loading, lookup, mount frame math | `crates/woodshop-core/src/hardware.rs` |
| Spec 1.15: `hardware[]`, movable `hinge` / `slide` / `pull` | `resources/spec.schema.json`, `spec/types.rs`, `spec/migrate.rs`, `spec/parse.rs` |
| Hardware list rows for mounts and chosen fittings | `crates/woodshop-core/src/cutlist/hardware.rs` |
| Linter rules `hardware.*`, `movable.hardware-unknown` | `crates/woodshop-core/src/lint/checks.rs` |

First action: finish 1.1 and 1.2, get every check green, then commit the lot as one commit.

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
the inspector to that mount's row, highlighting it. (Full hardware-as-selection, with drag to
move, is Phase 6.)

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

### Phase 1b (after 1.10): hardware that affects the build

The catalog already carries the numbers (`cup`, `cupDepth`, `boring` on Euro hinges; slide
`thickness`).
- **Euro hinge cup holes:** when a door's hinge is a `euroHinge`, show the 35 mm cup holes on the
  door (drawn as holes, listed in the plan's drilling notes). Decide first whether they are
  derived at render time (preferred: nothing to keep in sync) or written as hole ops.
- **Slide clearance:** a linter warning when a drawer box does not leave the chosen slide's side
  clearance (1/2" each side for side-mount) inside its opening.
- **Caster height:** include mounted casters and levelers in the overall height.
- **Lid stays:** suggest one when a door's hinge edge is horizontal and at the top (a lid).

---

## Phase 2: Metric support

Designs stay in inches internally (ground rule 2). This phase is display and input only.

- A `units` setting (Imperial fractions / Imperial decimal / Metric mm) in
  `ui/src/app/settings.ts` and the Settings page.
- One formatter and one parser used everywhere a length is shown or typed: build on
  `ui/src/lib/units.ts` and `ui/src/lib/fraction.ts`. Replace direct `formatFraction` calls in
  components (grep for them; there are many in `PartInspector`, `CutListPanel`, dialogs).
- Inputs accept either system regardless of the setting (`450mm`, `17 3/4`, `17.75"`).
- Cut list, CSV, PDF (`crates/woodshop-export`, pass the unit choice into `PlanInput`), HTML
  viewer and SVG templates follow the setting.
- Metric stock presets: 18 mm, 12 mm, 9 mm sheet; 2440 × 1220 sheets; common metric timber
  sections. Add to `ui/src/lib/lumberSizes.ts` and the add-material UI.
- Snap grid options in mm (1, 5, 10) when metric.
- Linter and MCP messages stay in inches for now; note it in the help.
- Done when: a design can be created, edited, and exported end to end without seeing an inch.

## Phase 3: Production foundation

Needs decisions from the owner first (see "Owner decisions").

- **Repository and CI:** create the GitHub repo, push, confirm `.github/workflows/ci.yml` passes
  on Linux. Fix whatever only fails there.
- **Updater:** generate the signing key (`npx tauri signer generate`), put the public key and the
  real release URL in `src-tauri/tauri.conf.json`, add the secrets, and prove an update end to
  end: publish 0.1.0 and 0.1.1 to a test repo, install 0.1.0, update from Settings.
- **macOS signing and notarization** through `tauri-action` (secrets listed in
  `.github/workflows/release.yml`). Build universal (Intel + Apple silicon).
- **Windows:** first build and first run ever. Expect path, font and WebView2 differences. The
  menu there is File / View / Help only by design (see `src-tauri/src/menu.rs`). Check Ctrl+Z,
  file association for `.woodshop`, thumbnails, PDF export, and `woodshop.exe --mcp` from a
  terminal (the release build is a GUI-subsystem binary; make sure stdio still works).
- **Linux:** build AppImage and deb, smoke test.
- **Exports through the native save dialog** have never been clicked through in the real window:
  PDF, HTML viewer, CSV, SVG templates, `.woodshop`. Test each on each platform.
- **Crash reports:** local logging exists (`ui/src/app/diagnostics.ts`, Settings → Diagnostics).
  Add a "Report a problem" action that opens an email or web form with the log attached, opt-in.
  A hosted service (Sentry) only if the owner wants it.
- **Data safety:** a daily automatic backup of `woodshop.db` (keep the last 7) and a "Restore
  from backup" action in Settings. A paid product cannot lose a user's designs.
- **Performance pass:** open the largest real design (71 parts) and a 200-part stress design;
  drag, undo and cut list must stay smooth. Profile the linter-on-every-edit path first.

## Phase 4: Licensing and sales

- **License keys:** an Ed25519-signed token (name, email, tier, issued date, updates-until date).
  The public key is compiled in; verification is offline, in Rust (`src-tauri`). Store the key
  in the app settings. No hardware lock, no phoning home.
- **Tiers.** Free: up to 3 projects, cut list without the sheet-layout optimizer, a small
  "Made with Woodshop" line on the PDF, hardware limited to a starter set. Pro: everything.
  Gate in one place (a `license` module with `can(feature)`), never scattered `if`s. Free users
  must always be able to open, view and export projects they already have.
- **UI:** Settings → License (enter key, status, updates-until). A clear, non-nagging upgrade
  prompt at the moment a Pro feature is used.
- **Store:** Lemon Squeezy or Paddle product, a webhook or their license API issuing the signed
  key, and the purchase email. A small key-signing tool or serverless function (keep the private
  key out of the repo).
- **Updates-until:** builds released after that date run as Free unless the key is renewed;
  older builds keep working forever.
- **MCP:** agent access is a Pro feature; the free tier's `--mcp` is read-only.
- Tests: valid, expired, tampered and wrong-product keys; the gates.

## Phase 5: First-run experience and content

- **Onboarding:** on an empty library, offer a sample project and a five-step guided tour
  (orbit, select, drag, cut list, export). Skippable, re-runnable from Help.
- **Templates:** grow from 11 to about 25, covering what people actually build: garage shelving,
  workbench with drawers, bed frame, bookcase with doors, shoe rack, planter, toy box with a lid
  and lid stay, TV console, desk with drawers. Every template must lint clean and use catalog
  hardware. Add a rendered thumbnail per template.
- **Help:** articles for every major feature (there are 6 today), with screenshots. Include
  "Using Woodshop with an AI agent".
- **Empty states and error messages:** read every one; each should say what to do next.
- **Accessibility:** keyboard access to every action, visible focus, sufficient contrast in both
  themes, labels on icon buttons.
- **Website:** a landing page, a download page, pricing, and the docs. Separate repo.

## Phase 5b: UI and design pass

From a review of the built app in its real window (both themes, 1560 × 780). The app is clean and
consistent, but it reads as an engineer's tool. These are ordered by how much they affect a
first-time buyer. Do 5b.1–5b.6 before any marketing screenshots are taken.

**5b.1 The 3D view is the product; make it look like one.** (`ui/src/engine/EditorEngine.ts`,
`buildScene.ts`, `engine/materials.ts`, `lib/theme.ts`)
- Dark theme: the model sits small and dim in a near-black void. Raise ambient and key light, add
  a soft contact shadow on the floor, and frame the model to fill about 60% of the viewport.
- Wood reads olive-brown and flat in both themes. Warm the palette, raise contrast between faces,
  and darken end grain slightly so parts separate without outlines.
- Selection is orange on tan and barely visible. Use a crisp outline plus a tint that contrasts
  with wood in both themes.
- Hardware (Phase 1) needs visibly metallic materials, not the current grey.
- Add a view cube or three preset views (front, side, top) and a "fit" button.

**5b.2 Navigation flashes a blank window.** Every lazy page (editor, tools, help) replaces the
whole window, nav bar included, with an empty screen and a tiny "Loading…" or "Opening…". Keep the
layout mounted and put the suspense boundary inside it (`ui/src/main.tsx`, `app/router.tsx`,
`components/AppLayout.tsx`). Preload the editor chunk on hover of a project card.

**5b.3 Projects page.** (`ui/src/pages/ProjectsPage.tsx`)
- The content column is about 640 pt wide in a 1560 pt window; two thirds of the screen is empty.
  Use a responsive grid that fills the width (4–5 cards across on a wide window).
- A project created from a template has no thumbnail until its first edit, so the card shows an
  empty box. Render the thumbnail on first open, and show a neutral illustration until then.
- In the light theme the thumbnail area has no background and looks like a layout gap.
- Card actions (Rename, Duplicate, Export, Delete) are four equal text links. Move them into a
  "⋯" menu, keep the card itself as the open action, and make Delete visually distinct.
- Empty state: one centred illustration, one sentence, two buttons (New project, Start from a
  template). Today it is a dashed box with small text.
- Add sort (recent, name) and search once there are more than about 12 projects.

**5b.4 Templates page.** (`ui/src/pages/TemplatesPage.tsx`, `resources/templates/*.json`)
- No pictures: eleven text cards. Add a rendered thumbnail to every template (generate them with
  the same snapshot code as project thumbnails; commit the PNGs).
- Descriptions are internal build notes ("§3.3 movable", "Dado variant.", "ends are drawn square
  in the model"). Rewrite each `meta.notes` as one or two sentences for a customer: what it is,
  overall size, sheets and boards needed. Keep the build notes in a separate field.
- Eleven identical orange "Use template" buttons compete. Make the whole card clickable with one
  quiet button, and show overall size and difficulty as small facts.
- Two "Record Stand" entries; rename so they are distinguishable.

**5b.5 Editor toolbar.** (`ui/src/components/EditorWorkspace.tsx`)
- Two orange buttons, "Edit" and "Add", both look like the primary action. "Edit" is a mode
  toggle: make it a two-segment switch (Edit | View) in neutral colours. Keep orange for Add only.
- Explode, Open and Measure are text-only; the snap, panel-toggle and overflow buttons are
  icon-only with no labels. Pick one style: icon plus label for the main tools, and tooltips with
  the keyboard shortcut on every button.
- The bottom-right hint is very low contrast. Raise it, or replace it with a "?" that lists
  shortcuts.
- There is no part list. Add a collapsible outline on the left (parts, groups, doors and drawers)
  so a part hidden inside the piece can be selected, renamed, hidden or locked without hunting.

**5b.6 Cut list panel.** (`ui/src/components/CutListPanel.tsx`)
- The hardware list (ten rows of screws) sits above the actual cut list, which is below the fold.
  Order: totals, parts to cut, sheet layouts, then hardware. Collapse screws into one expandable
  "Fasteners" row.
- "Waste 76%" in the same style as the other totals looks like an error. The stock-advice note
  under it explains why; attach the two (a warning colour on the tile and the advice as its
  detail) and say "Offcut" rather than "Waste" when the sheet is simply bigger than the job.
- "Est. cost —" should read "Add prices to see cost" and link to the material price field.
- Developer wording reaches the user: "(estimated — no pocketHoles op)". Reword to
  "(estimated: pocket holes not placed yet)". Search the whole UI for "op", "ops", "spec",
  "movable" and "§" and replace with plain words ("cut", "joinery", "design", "door or drawer").

**5b.7 Inspector.** (`ui/src/components/PartInspector.tsx`, `GroupInspector.tsx`)
- Section title "OPS" and rows like `screws · #8 · back face · l @ 15 1/4" × 2 · 1 1/2"` are
  unreadable to a woodworker. Title it "Cuts & fasteners"; show each as an icon, a plain name
  ("2 screws, #8 × 1 1/2\", back face") and an edit action.
- "Rot X / Rot Y / Rot Z" with −/+ steppers: label by what happens ("Tip forward", "Turn",
  "Roll"), or show small rotate icons around a cube.
- "Hang this part on hardware so it opens. The spec keeps the closed position — the Open toggle
  is a view." Rewrite: "Turn this part into a door or a drawer. Use Open in the toolbar to see it
  move."
- Nine "+ Dado / + Hole / …" buttons in a grid: group them under one "Add a cut" menu with icons.
- Collapse sections (Position, Orientation, Door/Drawer, Cuts) and remember which are open.

**5b.8 System-wide.**
- Type sizes run 11–12.5 px in panels. Set a 13 px floor for body text and 12 px for labels.
- Check contrast of muted text on both themes against WCAG AA (4.5:1); the dark theme's muted
  grey on near-black fails in several places (hints, card meta, section labels).
- Use the window: on macOS use an overlay title bar so the nav sits beside the traffic lights
  instead of under a separate title strip (`tauri.conf.json` `titleBarStyle: "Overlay"`).
- Settings is one long narrow column; the MCP block dominates it. Group into tabs or a left list
  (General, Library, AI agents, Updates, Diagnostics).
- Give the app a real icon and wordmark; the current mark is a placeholder glyph.
- Add a consistent set of icons (`lucide-react` is already a dependency) instead of text glyphs.

Done when: a first-time user can go from launch to an exported PDF without meeting a word they
have to look up, and the editor screenshot would sell the product on a landing page.

## Phase 6: After launch

- Hardware as a first-class selection: click to select, drag along the face, snap to centre
  lines and to matching hardware on a sibling part.
- Branded hardware packs (Blum, Häfele, Accuride) with part numbers, once dimensional data and
  permission are sorted.
- Paid plan packs and affiliate links from the hardware list.
- DXF export of part outlines for CNC; STEP or glTF export of the assembly.
- In-app AI design chat (bring-your-own API key), reusing the MCP tool layer.
- iPad companion viewer for the shop.

---

## Owner decisions still open

Ask before starting the phase that needs them. Do not guess.

| Decision | Needed for |
|---|---|
| GitHub owner and repo name; private or public | Phase 3 |
| Updater key: password-protected or not; where the backup lives | Phase 3 |
| Apple Developer account ($99/yr) and Windows signing certificate | Phase 3 |
| Launch platforms: macOS first, or macOS and Windows together | Phase 3 |
| Exact Pro price and the free tier's limits | Phase 4 |
| Lemon Squeezy or Paddle | Phase 4 |
| Hosted crash reporting (Sentry) or email only | Phase 3 |

## Known issues and debts

- Linter and MCP messages are inches-only.
- `ui/src/components/EditorWorkspace.tsx` (1,750 lines) and `PartInspector.tsx` (1,370 lines)
  are too large. Split them only when a task touches them heavily, one extraction at a time,
  with tests green between steps.
- The calculators (`ui/src/calc`) and structural checks (`ui/src/struct`) are TypeScript-only by
  choice; fine as they are.
- The owner's "outdoor storage" project has 16 unfastened-part errors from before; not an app bug.
- `scripts/export-laravel.sql` and `crates/woodshop-store/examples/import_laravel.rs` are a
  one-off migration from the old web app. Keep them; do not extend them.
