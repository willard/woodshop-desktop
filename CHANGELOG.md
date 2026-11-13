# Changelog

All notable changes to Woodshop are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Settings ▸ About: the version, the licence, links to the source and privacy note, and the
  licenses of the open-source software inside the app.
- Report a problem opens the bug form with your version and system filled in.

### Changed

- Woodshop is now free and open-source software under GPL-3.0-or-later.

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
