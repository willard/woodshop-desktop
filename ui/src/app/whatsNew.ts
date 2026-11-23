/**
 * What's new: the changelog, bundled at build time, shown once after an update and from Help.
 * CHANGELOG.md is Keep a Changelog: `## [0.1.2] — 2026-11-20`, then `### Added` and bullets.
 */
import changelog from '../../../CHANGELOG.md?raw';

export interface Release {
    version: string;
    date: string;
    groups: { title: string; items: string[] }[];
}

/** Every released version, newest first; "Unreleased" is left out. */
export function parseChangelog(text: string): Release[] {
    const releases: Release[] = [];
    let release: Release | null = null;
    let group: Release['groups'][number] | null = null;
    for (const line of text.split('\n')) {
        const heading = /^## \[(\d+\.\d+\.\d+)\](?:\s+[—-]\s+(.+))?/.exec(line);
        if (heading !== null) {
            release = { version: heading[1], date: heading[2]?.trim() ?? '', groups: [] };
            releases.push(release);
            group = null;
            continue;
        }
        if (line.startsWith('## ')) {
            release = null; // Unreleased, or the link list
            continue;
        }
        if (release === null) continue;
        if (line.startsWith('### ')) {
            group = { title: line.slice(4).trim(), items: [] };
            release.groups.push(group);
        } else if (line.startsWith('- ') && group !== null) {
            group.items.push(line.slice(2).trim());
        } else if (/^\s+\S/.test(line) && group !== null && group.items.length > 0) {
            // A bullet wrapped onto the next line.
            group.items[group.items.length - 1] += ` ${line.trim()}`;
        }
    }
    return releases;
}

export const RELEASES: Release[] = parseChangelog(changelog);

/** The notes for `version`, or null when the changelog has none (a development build). */
export function releaseNotes(version: string): Release | null {
    return RELEASES.find((r) => r.version === version) ?? null;
}

/** The setting that remembers the last version whose notes were shown (or skipped). */
export const LAST_SEEN_SETTING = 'lastSeenVersion';

/**
 * Whether to show the notes once on starting: only after an update. A first install has seen
 * nothing, and there is nothing new to it, so it just remembers the version.
 */
export function shouldShowNotes(current: string, lastSeen: unknown): boolean {
    return typeof lastSeen === 'string' && lastSeen !== current && releaseNotes(current) !== null;
}
