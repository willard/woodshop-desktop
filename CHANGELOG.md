# Changelog

All notable changes to Woodshop are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Settings ▸ About: the version, the licence, links to the source and privacy note, and the
  licenses of the open-source software inside the app.
- Report a problem opens the bug form with your version and system filled in.
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
