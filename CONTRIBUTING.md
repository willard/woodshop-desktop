# Contributing to Woodshop

Thanks for helping. Bug reports, hardware data, templates, help articles, translations of
measurements, and code are all welcome. By taking part you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

- **Found a bug?** [Open an issue](https://github.com/willard/woodshop-desktop/issues/new/choose).
  In the app, Settings ▸ Diagnostics ▸ Report a problem fills in your version and system. If you
  can, attach the `.woodshop` file that shows the problem (Export… on the project).
- **Security problem?** Don't open an issue; see [SECURITY.md](SECURITY.md).
- **Bigger change?** Open an issue or a discussion first, so we can agree on the approach before
  you spend time on it. [PLAN.md](PLAN.md) is the roadmap.
- **Looking for something to do?** Issues labelled
  [`good first issue`](https://github.com/willard/woodshop-desktop/labels/good%20first%20issue)
  are small and self-contained.

## Building from source

Prerequisites: stable Rust, the `wasm32-unknown-unknown` target,
[wasm-pack](https://github.com/drager/wasm-pack), Node 24, and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
rustup target add wasm32-unknown-unknown
npm ci
npm run wasm           # build the core to WASM for the UI (again after changing crates/woodshop-core)
npx tauri dev          # the app, with hot reload
```

`npm run dev` alone serves the UI in a browser against an in-memory mock backend
(`ui/src/test/mockBackend.ts`). It is handy for UI work and is what the browser tests use. Every
new Tauri command needs a mock there too.

**Never develop against your real library.** Point the app (and `--mcp`) at a scratch folder:

```bash
WOODSHOP_DATA_DIR=/tmp/woodshop-scratch npx tauri dev
```

A release build without an updater signing key:

```bash
npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

## Before you send a pull request

Run the same checks as CI:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run wasm && npm run typecheck && npm run lint && npm run format:check
npm test
npm run test:e2e        # E2E_BROWSER_CHANNEL=chrome uses an installed Chrome instead of downloading Chromium
```

For anything visible, also try it in the real app window (`npx tauri dev`), not only in the
browser tests: some behaviour (native menus, file dialogs, thumbnails) only exists there.

### Ground rules

- **Tests with every change.** Rust changes get Rust tests; UI changes get Vitest tests, and a
  Playwright test when they change a user flow.
- **The spec is a contract.** Changing the design format (`crates/woodshop-core/src/spec/`,
  `resources/spec.schema.json`) means bumping the spec version, adding a migration, and keeping
  old files opening. Ask in an issue first.
- **One implementation.** Domain logic (geometry, linter, cut list, units) lives in
  `woodshop-core` and reaches the UI through WASM. Don't reimplement it in TypeScript.
- **Match the surrounding code:** naming, comment density, 4-space indent; Prettier and rustfmt
  decide formatting.
- **Measurements:** internally everything is decimal inches. Show lengths with the helpers in
  `ui/src/lib/display.ts` so they follow the user's units setting; never hard-code `"` or `mm`.
- **No network calls** without an opt-in setting and an entry in [PRIVACY.md](PRIVACY.md).
- Keep pull requests focused: one change, with a description of what, why, and how you checked it.

### Sign your commits (DCO)

Woodshop uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of
a contributor licence agreement. Add a `Signed-off-by` line to every commit to certify that you
wrote the change, or otherwise have the right to submit it under the project's licence:

```bash
git commit -s -m "Fix the drawer slide clearance"
```

This adds `Signed-off-by: Your Name <you@example.com>` using your git `user.name` and
`user.email`. A check on every pull request makes sure each commit has one. Forgot? Run
`git rebase --signoff main` and force-push your branch.

Contributions are licensed under [GPL-3.0-or-later](LICENSE), the same as the rest of the project.
There is no CLA: your copyright stays yours.

## Contributing data

Some of the most useful contributions need no Rust:

- **Hardware** lives in `resources/hardware.json` (hinges, slides, pulls, casters, fasteners).
  Use dimensions from the manufacturer's data sheet and say where they came from in the pull
  request. `cargo test -p woodshop-core` checks that the catalog is well formed.
- **Templates** live in `resources/templates/`. Each should lint clean and use catalog hardware.
  `cargo test -p woodshop-core --test parity` lints every template against its recorded result in
  the lint fixture, so add an entry there for a new one. `resources/conventions.md` describes how
  designs are authored.
- **Help articles** live in `ui/src/help/articles.json`.

## Releasing (maintainers)

1. Bump `version` in `src-tauri/tauri.conf.json`, the workspace `Cargo.toml` and `package.json`,
   and move the "Unreleased" notes in `CHANGELOG.md` under the new version.
2. Push a tag like `v0.2.0`. `.github/workflows/release.yml` builds macOS (universal), Windows and
   Linux into a draft GitHub Release with signed updater artifacts and `latest.json`.
3. Check the draft, paste the changelog entry into it, and publish. Installed copies see the
   update the next time someone checks.

The workflow needs the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. macOS builds are ad-hoc signed until the `APPLE_*` secrets
listed in the workflow exist; then they are signed and notarized automatically.
