#!/usr/bin/env node
/**
 * Prints the GitHub Release notes for a version: how to install it on each system (the first-run
 * steps an unsigned build needs), then that version's section of CHANGELOG.md.
 *
 *   node scripts/release-notes.mjs v0.1.1
 *
 * Fails, so a release does not go out half-described, when the tag does not match the version in
 * tauri.conf.json, package.json and the workspace Cargo.toml, or the changelog has no section for
 * it. The release workflow passes its output as the release body; CI runs it for the current
 * version so a mismatch shows up before anyone tags.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

function fail(message) {
    process.stderr.write(`release-notes: ${message}\n`);
    process.exit(1);
}

const arg = process.argv[2];
if (!arg) fail('give the version or tag, e.g. v0.1.1');
const version = arg.replace(/^v/, '');

const versions = {
    'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
    'package.json': JSON.parse(read('package.json')).version,
    'Cargo.toml': read('Cargo.toml').match(/^\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/ms)?.[1],
};
for (const [file, found] of Object.entries(versions)) {
    if (found !== version) fail(`${file} says ${found ?? 'no version'}, not ${version}. Bump it first.`);
}

const changelog = read('CHANGELOG.md');
const heading = changelog.split('\n').findIndex((line) => line.startsWith(`## [${version}]`));
if (heading < 0) fail(`CHANGELOG.md has no "## [${version}]" section. Move the Unreleased notes under it.`);
const lines = changelog.split('\n').slice(heading + 1);
const end = lines.findIndex((line) => line.startsWith('## [') || /^\[[^\]]+\]: /.test(line));
const body = (end < 0 ? lines : lines.slice(0, end)).join('\n').trim();
if (body === '') fail(`the "## [${version}]" section of CHANGELOG.md is empty.`);

process.stdout.write(`## Install

| System | File |
| --- | --- |
| macOS (Intel and Apple Silicon) | \`Woodshop_${version}_universal.dmg\` |
| Windows | \`Woodshop_${version}_x64-setup.exe\` (or the \`.msi\`) |
| Linux | \`.AppImage\`, \`.deb\` or \`.rpm\` |

This build is not signed with an Apple or Microsoft certificate. The first time you open it:

- **macOS:** if it says Woodshop can't be opened, go to System Settings ▸ Privacy & Security and
  click **Open Anyway**.
- **Windows:** if SmartScreen appears, click **More info ▸ Run anyway**.

Already installed? Settings ▸ Updates ▸ Check for updates installs it in place.

## What's new

${body}
`);
