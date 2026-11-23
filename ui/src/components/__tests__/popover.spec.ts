import { describe, it, expect } from 'vitest';
import { placePanel } from '../Popover';

const view = { width: 800, height: 600 };
const panel = { width: 192, height: 220 };

describe('where a popover opens', () => {
    it('opens under its trigger, lined up with its right edge', () => {
        const anchor = { top: 100, bottom: 132, left: 300, right: 332 };
        expect(placePanel(anchor, panel, view, 'right')).toEqual({ top: 136, left: 140 });
        expect(placePanel(anchor, panel, view, 'left')).toEqual({ top: 136, left: 300 });
    });

    it('opens above a trigger near the bottom of the window', () => {
        const anchor = { top: 500, bottom: 532, left: 300, right: 332 };
        expect(placePanel(anchor, panel, view, 'right')).toEqual({ top: 276, left: 140 });
    });

    it('stays inside a window too small for either side', () => {
        const anchor = { top: 150, bottom: 182, left: 4, right: 36 };
        const small = { width: 800, height: 300 };
        expect(placePanel(anchor, panel, small, 'right')).toEqual({ top: 72, left: 8 });
    });
});
