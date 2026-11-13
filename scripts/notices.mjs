#!/usr/bin/env node
/**
 * Writes ui/public/third-party-notices.txt: the licence of every Rust crate in the app binary and
 * every npm package in the UI bundle, with the licence texts. GPL-3.0 §4–6 and most permissive
 * licences require these notices to travel with the binary; Settings ▸ About shows the file.
 *
 * Rust: `cargo about` (config in about.toml) over src-tauri, without dev or build dependencies.
 * npm: the production dependency tree (`npm ls --omit=dev`), licence texts from each package.
 *
 * Run by `npm run build:release`. Needs `cargo install cargo-about --features cli`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'ui/public/third-party-notices.txt');
const rule = '='.repeat(78);

function rust() {
    const json = execFileSync(
        'cargo',
        ['about', 'generate', '--format', 'json', '-m', 'src-tauri/Cargo.toml'],
        { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const { licenses } = JSON.parse(json);
    // One entry per distinct licence text, listing the crates that use it.
    return licenses
        .map((l) => ({
            id: l.id,
            users: l.used_by
                .map((u) => `${u.crate.name} ${u.crate.version}`)
                .filter((name) => !name.startsWith('woodshop'))
                .sort(),
            text: l.text.trim(),
        }))
        .filter((l) => l.users.length > 0);
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i;

function npm() {
    const tree = JSON.parse(
        execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        }),
    );
    const seen = new Map();
    (function walk(deps) {
        for (const [name, dep] of Object.entries(deps ?? {})) {
            const key = `${name} ${dep.version}`;
            if (seen.has(key) || !dep.path) continue;
            const pkg = JSON.parse(readFileSync(join(dep.path, 'package.json'), 'utf8'));
            const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
            const file = readdirSync(dep.path).find((f) => LICENSE_FILE.test(f));
            const text = file ? readFileSync(join(dep.path, file), 'utf8').trim() : '';
            seen.set(key, { license, text });
            walk(dep.dependencies);
        }
    })(tree.dependencies);
    // Group identical licence texts so the file stays readable.
    const byText = new Map();
    for (const [key, { license, text }] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
        const group = byText.get(text) ?? { id: license, users: [], text };
        group.users.push(key);
        byText.set(text, group);
    }
    return [...byText.values()];
}

function section(title, groups) {
    return [
        rule,
        title,
        rule,
        '',
        ...groups.flatMap((g) => [
            `${g.id} — used by: ${g.users.join(', ')}`,
            '',
            g.text || `(No licence text is included in the package; see the ${g.id} licence.)`,
            '',
            '-'.repeat(78),
            '',
        ]),
    ].join('\n');
}

const header = `Woodshop — third-party software notices

Woodshop is free software, licensed under the GNU General Public License, version 3 or (at your
option) any later version. Source: https://github.com/willard/woodshop-desktop

It includes the following third-party software, each under its own licence, reproduced below.
The PDF plans also embed fonts shipped with Typst (typst-assets), listed with the Rust crates.

`;

mkdirSync(dirname(out), { recursive: true });
const rustGroups = rust();
const npmGroups = npm();
writeFileSync(
    out,
    header + section('Rust crates (the app and its design engine)', rustGroups) + '\n' +
        section('JavaScript packages (the user interface)', npmGroups),
);
const count = (gs) => gs.reduce((n, g) => n + g.users.length, 0);
console.log(
    `third-party-notices.txt: ${count(rustGroups)} crates, ${count(npmGroups)} npm packages` +
        (existsSync(out) ? '' : ' (not written!)'),
);
