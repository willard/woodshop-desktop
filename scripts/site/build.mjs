// Builds the project website into site/dist: a landing page, a download page and the docs.
// The docs are the in-app help articles and the gallery is the bundled templates, so the site
// says what the app says. No dependencies: `npm run site`, then serve site/dist.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'site/dist');
const REPO = 'https://github.com/willard/woodshop-desktop';
const read = (path) => readFileSync(join(root, path), 'utf8');

const esc = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The help text's own markup: `code` and **bold**. */
const inline = (s) =>
    esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

/** A picture in both themes, as the app's screenshots and thumbnails come. */
const themed = (dir, name, alt, cls = '') =>
    `<picture${cls ? ` class="${cls}"` : ''}><source srcset="${dir}/${name}-dark.webp" media="(prefers-color-scheme: dark)">` +
    `<img src="${dir}/${name}-light.webp" alt="${esc(alt)}" loading="lazy"></picture>`;

function page({ title, description, body, depth = 0, current }) {
    const up = depth === 0 ? '' : '../'.repeat(depth);
    const nav = [
        ['Docs', `${up}docs/index.html`, 'docs'],
        ['Download', `${up}download.html`, 'download'],
        ['Source', REPO, 'source'],
    ]
        .map(
            ([label, href, key]) =>
                `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`,
        )
        .join('');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="${up}index.html"><span class="mark" aria-hidden="true"></span>Woodshop</a>
<nav aria-label="Site">${nav}</nav>
</div></header>
<main>${body}</main>
<footer><div class="wrap">
<p>Woodshop is free software under the <a href="${REPO}/blob/main/LICENSE">GPL-3.0-or-later</a>.
No account, no telemetry. <a href="${REPO}/blob/main/PRIVACY.md">Privacy</a> ·
<a href="${REPO}/issues/new/choose">Report a problem</a> ·
<a href="${REPO}/blob/main/CONTRIBUTING.md">Contribute</a></p>
</div></footer>
</body>
</html>
`;
}

// --- Content ---
const articles = JSON.parse(read('ui/src/help/articles.json'));
const gallery = JSON.parse(read('resources/template-gallery.json'));
const templates = readdirSync(join(root, 'resources/templates'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
        const id = f.replace(/\.json$/, '');
        const spec = JSON.parse(read(`resources/templates/${f}`));
        return { id, name: spec.name, summary: gallery[id] ?? '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

function block(b) {
    switch (b.type) {
        case 'h':
            return `<h2>${inline(b.text)}</h2>`;
        case 'p':
            return `<p>${inline(b.text)}</p>`;
        case 'note':
            return `<aside class="note">${inline(b.text)}</aside>`;
        case 'ul':
        case 'ol':
            return `<${b.type}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${b.type}>`;
        case 'img':
            return `<figure>${themed('../images/help', b.src, b.alt)}${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`;
        default:
            throw new Error(`Unknown help block type ${b.type}`);
    }
}

const FEATURES = [
    [
        'Design in 3D',
        'Parts, joints, doors, drawers and real hardware — hinges, slides, pulls, casters — or start from a template.',
    ],
    [
        'Check it can be built',
        'Design checks flag unfastened parts, parts too big for your stock and hardware that won’t fit, and say how to fix each one.',
    ],
    [
        'Cut list and sheet layouts',
        'Every board and panel to cut, laid out on your sheets with your saw’s kerf, plus board feet and what to buy.',
    ],
    [
        'Plans to take to the shop',
        'A print-ready PDF, a 3D plan that opens in any browser, a spreadsheet, and full-size templates for shaped parts.',
    ],
    ['Inches or millimetres', 'On screen, in every export and in what you type.'],
    [
        'Works with AI agents',
        'Woodshop is also a local MCP server, so an agent such as Claude can read and edit your designs, every change checked and undoable.',
    ],
];

const home = page({
    title: 'Woodshop — design furniture you can build',
    description:
        'A free, open-source desktop app: design furniture in 3D, check it can be built, and get a cut list, sheet layouts, a hardware list and a printable plan.',
    body: `
<section class="hero"><div class="wrap">
<h1>Design furniture you can actually build.</h1>
<p class="lede">Woodshop is a free desktop app for macOS, Windows and Linux. Draw a piece in 3D, let it check the joinery, and take a cut list, sheet layouts and a printable plan to the shop.</p>
<p class="cta"><a class="button" href="download.html">Download Woodshop</a><a class="button ghost" href="docs/index.html">Read the docs</a></p>
${themed('images/help', 'editor', 'The Woodshop editor: a parts list, a 3D view of a nightstand and its cut list.', 'shot')}
</div></section>
<section><div class="wrap">
<h2>What it does</h2>
<ul class="features">${FEATURES.map(([t, d]) => `<li><h3>${t}</h3><p>${d}</p></li>`).join('')}</ul>
</div></section>
<section><div class="wrap">
<h2>Start from one of ${templates.length} templates</h2>
<p class="muted">Every template passes the design checks and lists real hardware. Open one and it becomes your own copy to change.</p>
<ul class="gallery">${templates
        .map(
            (t) =>
                `<li>${themed('images/templates', t.id, t.name)}<h3>${esc(t.name)}</h3><p>${esc(t.summary)}</p></li>`,
        )
        .join('')}</ul>
</div></section>
<section><div class="wrap narrow">
<h2>Yours, on your computer</h2>
<p>No account, no subscription, no telemetry and no network needed. Designs live in a library on your computer, with version history and daily backups, and travel as <code>.woodshop</code> files.</p>
<p>Woodshop is open source under the GPL. <a href="${REPO}">Read the code</a>, <a href="${REPO}/issues/new/choose">report a problem</a>, or <a href="${REPO}/blob/main/resources/DATA.md">add hardware and templates</a>.</p>
</div></section>`,
});

const download = page({
    title: 'Download Woodshop',
    description: 'Download Woodshop for macOS, Windows or Linux.',
    current: 'download',
    body: `
<section><div class="wrap narrow">
<h1>Download Woodshop</h1>
<p class="lede" id="release">The latest release is on <a href="${REPO}/releases/latest">GitHub</a>.</p>
<div class="platforms">
<article data-os="mac"><h2>macOS</h2><p>Intel and Apple silicon.</p><ul data-files></ul></article>
<article data-os="windows"><h2>Windows</h2><p>64-bit installer.</p><ul data-files></ul></article>
<article data-os="linux"><h2>Linux</h2><p>AppImage, or a package for Debian/Ubuntu or Fedora.</p><ul data-files></ul></article>
</div>
<h2>Opening it the first time</h2>
<p>Releases are not yet signed with an Apple or Microsoft certificate.</p>
<ul>
<li><strong>macOS:</strong> if it says Woodshop can’t be opened, go to System Settings ▸ Privacy &amp; Security and click <strong>Open Anyway</strong>.</li>
<li><strong>Windows:</strong> if SmartScreen appears, click <strong>More info ▸ Run anyway</strong>.</li>
</ul>
<p>Woodshop checks for updates only when you ask it to (Settings ▸ Updates), and every update is verified against a signing key built into the app. To build it yourself, see <a href="${REPO}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>
</div></section>
<script src="download.js" defer></script>`,
});

const docNav = (slug) =>
    `<nav class="docnav" aria-label="Docs"><ul>${articles
        .map(
            (a) =>
                `<li><a href="${a.slug}.html"${a.slug === slug ? ' aria-current="page"' : ''}>${esc(a.title)}</a></li>`,
        )
        .join('')}</ul></nav>`;

const docsIndex = page({
    title: 'Woodshop docs',
    description:
        'How to use Woodshop: the editor, doors and drawers, hardware, cut lists, exports and AI agents.',
    depth: 1,
    current: 'docs',
    body: `<section><div class="wrap narrow"><h1>Docs</h1>
<p class="lede">The same help that is built into the app, under Help.</p>
<ul class="doclist">${articles
        .map(
            (a) =>
                `<li><a href="${a.slug}.html"><span aria-hidden="true">${a.icon}</span> <strong>${esc(a.title)}</strong></a><p>${inline(a.summary)}</p></li>`,
        )
        .join('')}</ul></div></section>`,
});

// --- Write ---
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'docs'), { recursive: true });
writeFileSync(join(out, 'index.html'), home);
writeFileSync(join(out, 'download.html'), download);
writeFileSync(join(out, 'docs/index.html'), docsIndex);
for (const a of articles) {
    const body = `<section><div class="wrap docs">${docNav(a.slug)}<article class="doc"><h1>${esc(a.title)}</h1>${a.blocks.map(block).join('\n')}</article></div></section>`;
    writeFileSync(
        join(out, `docs/${a.slug}.html`),
        page({
            title: `${a.title} — Woodshop docs`,
            description: a.summary,
            depth: 1,
            current: 'docs',
            body,
        }),
    );
}
for (const f of ['style.css', 'download.js']) cpSync(join(root, 'site', f), join(out, f));
cpSync(join(root, 'ui/public/help'), join(out, 'images/help'), { recursive: true });
cpSync(join(root, 'ui/public/templates'), join(out, 'images/templates'), { recursive: true });

// Every picture a page names must have been copied.
for (const t of templates)
    for (const theme of ['light', 'dark'])
        if (!existsSync(join(out, `images/templates/${t.id}-${theme}.webp`)))
            throw new Error(`No ${theme} picture for template ${t.id}`);
console.log(`Built site/dist: ${articles.length} docs pages, ${templates.length} templates.`);
