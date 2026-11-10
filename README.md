# Woodshop (desktop)

Design furniture in 3D, check it is buildable, and get sheet layouts, a cut list, hardware and a
printable plan: a standalone desktop app with no account, no subscription and no network needed.
Your designs live in a library on your computer and can be shared as `.woodshop` files.

It is a port of the Woodshop web app (Laravel + Vue) to **Tauri 2 + React**, with the design
engine rewritten in **Rust** and shared by the app, the exports and a local MCP server.

## What's inside

| Concern | Choice | Why |
| --- | --- | --- |
| Shell | Tauri 2 | Small native binary, system webview, Rust backend |
| UI | React 19, Vite, TypeScript, Tailwind v4 | |
| 3D | **three.js** (the existing framework-agnostic `EditorEngine`), wrapped imperatively | Command-driven editor with undo/redo, snapping and render-on-demand; react-three-fiber would add a reconciler between every edit and the scene for no gain |
| CSG | three-bvh-csg in a web worker | manifold-3d (WASM) is the drop-in upgrade if boolean artifacts ever show up |
| State and routing | Zustand, TanStack Router (hash history), TanStack Query over IPC | |
| Design engine | `woodshop-core` (Rust), compiled **natively** and to **WASM** | One implementation of the spec, migrations, validation, linter, geometry and cut list, used by the webview synchronously and by the backend |
| Validation | `jsonschema` against `resources/spec.schema.json` | The schema stays the single source |
| Storage | SQLite via rusqlite (WAL) | Safe to share between the app and the MCP process |
| PDF plans | Typst, embedded with bundled fonts | Print-quality output without Chromium |
| MCP | rmcp over stdio | The same binary, run as `woodshop --mcp` |
| Updates | tauri-plugin-updater, GitHub Releases | Signed with a minisign key |

### Repository layout

```
crates/
  woodshop-core/     spec types, migrate, validate, op catalog, geometry, linter, cut list, fasteners
  woodshop-wasm/     wasm-bindgen facade over core (full build for the app, slim build for the viewer)
  woodshop-store/    the SQLite library: projects, versions, notes, settings, thumbnails, .woodshop archives
  woodshop-export/   Typst PDF plan and the self-contained HTML viewer
  woodshop-mcp/      29 design tools + 3 resources for AI agents
src-tauri/           the app: commands, plugins, file associations, `--mcp` entry
ui/                  the React app (engine/, spec/ and cutlist/ are thin shims over the WASM core)
viewer/              the offline HTML viewer, built as one inlined script
e2e/                 Playwright tests against the UI with a mocked backend
resources/           spec schema, templates, the §3.1 authoring conventions
```

## Developing

Prerequisites: stable Rust, the `wasm32-unknown-unknown` target, [wasm-pack](https://github.com/drager/wasm-pack),
Node 24, and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
rustup target add wasm32-unknown-unknown
npm ci
npm run wasm           # build the core to WASM for the UI (again after changing crates/woodshop-core)
npx tauri dev          # the app, with hot reload
```

`npm run dev` alone serves the UI in a browser against an in-memory mock backend
(`ui/src/test/mockBackend.ts`), which is handy for UI work and is what the e2e tests use.

| Command | What it checks |
| --- | --- |
| `cargo test --workspace` | Core parity fixtures from the web app (fractions, outlines, linter, cut lists), store, exports, MCP tools |
| `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all --check` | Rust lint and format |
| `npm test` | Vitest: the editor engine and UI modules over the WASM core |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm run test:e2e` | Playwright; set `E2E_BROWSER_CHANNEL=chrome` to use an installed Chrome instead of `npx playwright install chromium` |

Set `WOODSHOP_DATA_DIR` to point the app (and `--mcp`) at a scratch library instead of your real one.

## Where your data lives

The library is `woodshop.db` plus a `thumbnails/` folder in the app-data directory:

- macOS: `~/Library/Application Support/studio.woodshop.desktop`
- Windows: `%APPDATA%\studio.woodshop.desktop`
- Linux: `~/.local/share/studio.woodshop.desktop`

A `.woodshop` file is a zip of the design, its versions, notes and thumbnail. Double-clicking one
imports it. Settings → Project library shows the folder; back it up like any other folder.

### Bringing projects over from the web app

Dump an account from the web app's Postgres database, then import it into a library. The import
keeps drafts, version history, notes, thumbnails, dates and trash state; every spec is migrated and
validated on the way in, and re-running skips projects already imported.

```bash
psql -h 127.0.0.1 -p 5433 -U woodshop -d woodshop -At -v email=you@example.com -f scripts/export-laravel.sql > laravel-projects.json
cargo run -p woodshop-store --example import_laravel -- laravel-projects.json ../woodshop/storage/app/public "$HOME/Library/Application Support/studio.woodshop.desktop"
```

Add `--dry-run` to see what would be imported without writing anything.

## Using it with an AI agent (MCP)

The app binary doubles as a local MCP server over stdio. Settings → AI agents (MCP) shows the exact
command for your install. For example, with Claude Code on macOS:

```bash
claude mcp add woodshop -- /Applications/Woodshop.app/Contents/MacOS/woodshop --mcp
```

Agents get tools to read designs, cut lists and buildability checks; to start designs; and to
author and edit parts, materials, ops, joints, doors and drawers. Every change is validated against
the schema and the buildability linter, and the previous draft is saved as a version
(marked "AI agent"), so it can always be undone from the Versions panel. If the design is open in
the editor, it reloads, or asks which version to keep when you have unsaved edits.

## Releasing

1. Generate the updater signing key once, and keep the private key out of the repository:

   ```bash
   npx tauri signer generate -w ~/.tauri/woodshop.key
   ```

   Put the public key in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`. Replace `OWNER`
   in `plugins.updater.endpoints` with the GitHub owner of the repository that publishes releases.
2. Add the repository secrets `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. For signed and notarized macOS builds, also add the
   `APPLE_*` secrets listed in `.github/workflows/release.yml`. Without them the app still builds,
   but macOS and Windows warn that it is from an unidentified developer.
3. Bump `version` in `src-tauri/tauri.conf.json` (and `Cargo.toml`/`package.json` to match), then
   push a tag like `v0.2.0`. The workflow builds macOS (universal), Windows and Linux bundles into a
   draft release with `latest.json`. Publishing the draft makes the update visible to installed copies.

To build locally without a signing key:

```bash
npx tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

## Differences from the web app

- **No accounts, billing or admin.** Designs are local; there is nothing to sign in to.
- **No in-app AI chat (for now).** Bring your own agent through MCP instead.
- **Desktop-only UI.** The phone layouts (floating action button, bottom sheets, touch select mode) are gone.
- The shop calculators and the structural checks stay in TypeScript: they only ever existed there,
  so porting them would not remove any duplication.
