import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { HELP_ARTICLES } from '..';

describe('help articles', () => {
    it('have unique slugs', () => {
        const slugs = HELP_ARTICLES.map((a) => a.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('show only screenshots that exist in both themes, each with alt text', () => {
        for (const article of HELP_ARTICLES) {
            for (const block of article.blocks) {
                if (block.type !== 'img') continue;
                expect(block.alt.length, `${article.slug}: ${block.src} alt`).toBeGreaterThan(20);
                for (const theme of ['light', 'dark']) {
                    const file = `ui/public/help/${block.src}-${theme}.webp`;
                    expect(existsSync(file), file).toBe(true);
                }
            }
        }
    });

    it('never leave markdown unrendered', () => {
        // The renderer knows `code` and **bold**; anything else would show its punctuation.
        for (const article of HELP_ARTICLES) {
            const text = JSON.stringify(article.blocks);
            expect(text, article.slug).not.toMatch(/(^|[^*])\*[^*\s][^*]*\*(?!\*)|__|\]\(/);
        }
    });
});
