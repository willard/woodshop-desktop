#!/usr/bin/env node
/**
 * Fails when a Tauri Rust crate and its npm package are on different major.minor versions: the
 * same check `tauri build` makes, which refuses to build a release over it. CI never runs a full
 * Tauri build, so without this a `cargo update` (or an npm one) passes every check and only the
 * release workflow, after a tag is pushed, finds out.
 *
 * Reads the resolved versions from Cargo.lock and package-lock.json. Fix a mismatch by moving the
 * npm package to the crate's minor (`npm install @tauri-apps/api@^2.12.5`) or the reverse.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cargoLock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
const npmLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

/** Crate → npm package, for every Tauri package the UI imports. */
const PAIRS = {
    tauri: '@tauri-apps/api',
    'tauri-plugin-dialog': '@tauri-apps/plugin-dialog',
    'tauri-plugin-opener': '@tauri-apps/plugin-opener',
    'tauri-plugin-process': '@tauri-apps/plugin-process',
    'tauri-plugin-updater': '@tauri-apps/plugin-updater',
};

const minor = (v) => v?.split('.').slice(0, 2).join('.');
const crate = (name) =>
    cargoLock.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`))?.[1];

const problems = [];
for (const [rust, npm] of Object.entries(PAIRS)) {
    const r = crate(rust);
    const n = npmLock.packages?.[`node_modules/${npm}`]?.version;
    if (r === undefined || n === undefined) {
        problems.push(`${rust} (${r ?? 'not in Cargo.lock'}) : ${npm} (${n ?? 'not in package-lock.json'})`);
    } else if (minor(r) !== minor(n)) {
        problems.push(`${rust} (v${r}) : ${npm} (v${n})`);
    }
}
if (problems.length > 0) {
    process.stderr.write(
        `Tauri crates and npm packages are on different minor versions, so \`tauri build\` will refuse to build:\n  ${problems.join('\n  ')}\n`,
    );
    process.exit(1);
}
process.stdout.write(`Tauri crates and npm packages match (${Object.keys(PAIRS).length} pairs).\n`);
