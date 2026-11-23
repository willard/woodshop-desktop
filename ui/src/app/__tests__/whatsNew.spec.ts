import { describe, expect, it } from 'vitest';
import { RELEASES, parseChangelog, releaseNotes, shouldShowNotes } from '../whatsNew';
import pkg from '../../../../package.json';

const sample = `# Changelog

## [Unreleased]

### Added

- Not out yet.

## [0.2.0] — 2026-12-01

### Added

- A long line that the changelog
  wraps onto the next.
- \`code\` and **bold**.

### Fixed

- A fix.

## [0.1.0] — first build, not published

[Unreleased]: https://example.com
`;

describe('parseChangelog', () => {
    it('reads each released version, newest first, with its groups and wrapped bullets', () => {
        const releases = parseChangelog(sample);
        expect(releases.map((r) => r.version)).toEqual(['0.2.0', '0.1.0']);
        expect(releases[0].date).toBe('2026-12-01');
        expect(releases[0].groups.map((g) => g.title)).toEqual(['Added', 'Fixed']);
        expect(releases[0].groups[0].items).toEqual([
            'A long line that the changelog wraps onto the next.',
            '`code` and **bold**.',
        ]);
    });

    it('leaves out Unreleased', () => {
        expect(
            parseChangelog(sample).some((r) => r.groups.some((g) => g.items.includes('Not out yet.'))),
        ).toBe(false);
    });
});

describe('the bundled changelog', () => {
    it('has notes for the version in package.json', () => {
        const notes = releaseNotes(pkg.version);
        expect(notes).not.toBeNull();
        expect(notes!.groups.length).toBeGreaterThan(0);
        expect(RELEASES[0].version).toBe(pkg.version);
    });
});

describe('shouldShowNotes', () => {
    it('shows them once after an update, never on a first install or a development build', () => {
        expect(shouldShowNotes(pkg.version, '0.0.1')).toBe(true);
        expect(shouldShowNotes(pkg.version, pkg.version)).toBe(false);
        expect(shouldShowNotes(pkg.version, undefined)).toBe(false);
        expect(shouldShowNotes('0.9.9-dev', '0.0.1')).toBe(false);
    });
});
