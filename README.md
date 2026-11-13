# Woodshop

Design furniture in 3D, check that it can actually be built, and get a cut list, sheet layouts, a
hardware list and a printable plan.

Woodshop is a free, open-source desktop app for macOS, Windows and Linux. No account, no
subscription, no telemetry, no network needed: your designs live in a library on your computer and
can be shared as `.woodshop` files.

**[Download the latest release](https://github.com/willard/woodshop-desktop/releases)** ·
[Report a problem](https://github.com/willard/woodshop-desktop/issues/new/choose) ·
[Contribute](CONTRIBUTING.md)

## What it does

- **Design in 3D** from parts, joints, doors, drawers and real hardware (hinges, slides, pulls,
  casters), or start from a template.
- **Check buildability:** a linter flags unfastened parts, parts that can't be cut from your
  stock, hardware that doesn't fit, and more, and says how to fix each one.
- **Cut list and sheet layouts** with your saw's kerf, grouped by material, with stock advice
  and board feet.
- **Exports:** a print-ready PDF plan, an interactive 3D plan that opens in any browser, the cut
  list as a spreadsheet, and full-size SVG templates for shaped parts.
- **Inches or millimetres**, everywhere: on screen, in every export, and in what you type.
- **Version history and daily backups** of your library, with one-click restore.
- **Works with AI agents:** the app is also a local [MCP](https://modelcontextprotocol.io) server,
  so an agent such as Claude can read and edit your designs, with every change validated and
  undoable.

## Installing

Download the file for your system from the
[releases page](https://github.com/willard/woodshop-desktop/releases):

| System | File |
| --- | --- |
| macOS (Intel and Apple Silicon) | `Woodshop_<version>_universal.dmg` |
| Windows | `Woodshop_<version>_x64-setup.exe` (or the `.msi`) |
| Linux | `.AppImage`, `.deb` or `.rpm` |

Releases are not yet signed with an Apple or Microsoft certificate. The first time you open it:

- **macOS:** if it says Woodshop can't be opened, go to System Settings ▸ Privacy & Security and
  click **Open Anyway**.
- **Windows:** if SmartScreen appears, click **More info ▸ Run anyway**.

Woodshop checks for updates only when you ask it to (Settings ▸ Updates), and updates are
verified against a signing key built into the app.

## Where your data lives

The library is `woodshop.db` plus a `thumbnails/` and a `backups/` folder in the app-data
directory:

- macOS: `~/Library/Application Support/studio.woodshop.desktop`
- Windows: `%APPDATA%\studio.woodshop.desktop`
- Linux: `~/.local/share/studio.woodshop.desktop`

A `.woodshop` file is a zip of one design, its versions, notes and thumbnail; double-clicking one
imports it. The app keeps seven daily backups of the whole library (Settings ▸ Backups). See
[PRIVACY.md](PRIVACY.md) for everything the app does and does not send anywhere.

## Using it with an AI agent (MCP)

The app binary doubles as a local MCP server over stdio. Settings ▸ AI agents (MCP) shows the
exact command for your install. For example, with Claude Code on macOS:

```bash
claude mcp add woodshop -- /Applications/Woodshop.app/Contents/MacOS/woodshop --mcp
```

Agents get tools to read designs, cut lists and buildability checks; to start designs; and to
author and edit parts, materials, ops, joints, doors, drawers and hardware. Every change is
validated against the schema and the buildability linter, and the previous draft is saved as a
version (marked "AI agent"), so it can always be undone from the Versions panel.

## How it's built

| Concern | Choice | Why |
| --- | --- | --- |
| Shell | Tauri 2 | Small native binary, system webview, Rust backend |
| UI | React 19, Vite, TypeScript, Tailwind v4 | |
| 3D | three.js (a framework-agnostic `EditorEngine`), wrapped imperatively | Command-driven editor with undo/redo, snapping and render-on-demand |
| CSG | three-bvh-csg in a web worker | |
| State and routing | Zustand, TanStack Router (hash history), TanStack Query over IPC | |
| Design engine | `woodshop-core` (Rust), compiled natively and to WASM | One implementation of the spec, migrations, validation, linter, geometry and cut list, used by the webview and the backend alike |
| Validation | `jsonschema` against `resources/spec.schema.json` | The schema is the single source |
| Storage | SQLite via rusqlite (WAL) | Safe to share between the app and the MCP process |
| PDF plans | Typst, embedded with bundled fonts | Print-quality output without a browser |
| MCP | rmcp over stdio | The same binary, run as `woodshop --mcp` |
| Updates | tauri-plugin-updater, GitHub Releases | Signed with a minisign key |

```
crates/
  woodshop-core/     spec types, migrate, validate, op catalog, geometry, linter, cut list, fasteners, units
  woodshop-wasm/     wasm-bindgen facade over core (full build for the app, slim build for the viewer)
  woodshop-store/    the SQLite library: projects, versions, notes, settings, thumbnails, .woodshop archives
  woodshop-export/   Typst PDF plan and the self-contained HTML viewer
  woodshop-mcp/      design tools and resources for AI agents
src-tauri/           the app: commands, plugins, backups, file associations, `--mcp` entry
ui/                  the React app (engine/, spec/ and cutlist/ are thin shims over the WASM core)
viewer/              the offline HTML viewer, built as one inlined script
e2e/                 Playwright tests against the UI with a mocked backend
resources/           spec schema, templates, hardware catalog, authoring conventions
```

To build it, run the tests or send a change, see [CONTRIBUTING.md](CONTRIBUTING.md). The roadmap
is [PLAN.md](PLAN.md).

## License

Woodshop is free software: you can redistribute it and/or modify it under the terms of the
[GNU General Public License](LICENSE), version 3 or (at your option) any later version.
SPDX-License-Identifier: `GPL-3.0-or-later`. This covers the code and everything shipped with it in
this repository: the hardware catalog, templates and help articles.

Woodshop is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. Check every plan
before you cut: you are responsible for what you build.
