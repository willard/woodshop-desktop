import { describe, it, expect } from 'vitest';
import { placeAtPoint, placePanel } from '../Popover';

const view = { width: 800, height: 600 };
const panel = { width: 192, height: 220 };

describe('where a popover opens', () => {
    it('opens under its trigger, lined up with its right edge', () => {
        const anchor = { top: 100, bottom: 132, left: 300, right: 332 };
        expect(placePanel(anchor, panel, view, 'right')).toEqual({ top: 136, left: 140, maxHeight: 456 });
        expect(placePanel(anchor, panel, view, 'left')).toMatchObject({ top: 136, left: 300 });
    });

    it('opens above a trigger near the bottom of the window', () => {
        const anchor = { top: 500, bottom: 532, left: 300, right: 332 };
        expect(placePanel(anchor, panel, view, 'right')).toEqual({ top: 276, left: 140, maxHeight: 488 });
    });

    it('scrolls on the roomier side when it fits neither', () => {
        const small = { width: 800, height: 300 };
        // A menu from a toolbar at the top: under it, held to the room below.
        const toolbar = { top: 8, bottom: 40, left: 4, right: 36 };
        expect(placePanel(toolbar, panel, small, 'right')).toEqual({ top: 44, left: 8, maxHeight: 248 });
        // From near the bottom: over it, held to the room above.
        const low = { top: 230, bottom: 262, left: 300, right: 332 };
        expect(placePanel(low, panel, small, 'right')).toEqual({ top: 8, left: 140, maxHeight: 218 });
    });
});

describe('where a right-click menu opens', () => {
    const menu = { width: 160, height: 162 };

    it('opens at the pointer when it fits', () => {
        expect(placeAtPoint({ x: 300, y: 200 }, menu, view)).toEqual({ top: 200, left: 300 });
    });

    it('opens up and in near the bottom-right corner', () => {
        expect(placeAtPoint({ x: 780, y: 560 }, menu, view)).toEqual({ top: 398, left: 632 });
    });
});
