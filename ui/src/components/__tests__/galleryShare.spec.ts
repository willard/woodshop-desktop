import { describe, it, expect } from 'vitest';
import { galleryPostBody } from '../GalleryShare';
import { galleryPostUrl } from '@/app/diagnostics';
import type { Spec } from '@/spec';
import sideTable from '../../../../resources/templates/side-table.json';

describe('the gallery post', () => {
    it('says what the piece is and takes, and how to open it, and nothing about the maker', () => {
        const spec = sideTable as unknown as Spec;
        const body = galleryPostBody(spec, '0.1.3');
        expect(body).toContain('**Overall:** 18" × 18" × 24"');
        expect(body).toMatch(/\*\*Materials:\*\* Birch Plywood 3\/4", Pine 2x2/);
        expect(body).toMatch(/\*\*Pieces:\*\* \d+/);
        expect(body).toContain('Made with Woodshop 0.1.3.');
    });

    it('opens a new post in the gallery category, filled in', () => {
        const url = new URL(galleryPostUrl('Side & table', 'a\nb'));
        expect(url.origin + url.pathname).toBe('https://github.com/willard/woodshop-desktop/discussions/new');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            category: 'gallery',
            title: 'Side & table',
            body: 'a\nb',
        });
    });
});
