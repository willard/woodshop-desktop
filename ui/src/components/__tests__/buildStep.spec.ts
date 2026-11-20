import { describe, expect, it } from 'vitest';
import { hiddenAtStep } from '../BuildStepBar';

describe('hiddenAtStep', () => {
    const steps = [
        { heading: 'Start with Bottom', lines: [], partIds: ['bottom'] },
        { heading: 'Add Left Side and Right Side', lines: [], partIds: ['left', 'right'] },
        { heading: 'Add Top', lines: [], partIds: ['top'] },
        { heading: 'Fit the hardware', lines: [], partIds: [] },
    ];
    const parts = ['bottom', 'left', 'right', 'top'];

    it('hides what is not built yet', () => {
        expect([...hiddenAtStep(parts, steps, 0)]).toEqual(['left', 'right', 'top']);
        expect([...hiddenAtStep(parts, steps, 1)]).toEqual(['top']);
    });

    it('shows the whole piece from the last part on, through the hardware step', () => {
        expect(hiddenAtStep(parts, steps, 2).size).toBe(0);
        expect(hiddenAtStep(parts, steps, 3).size).toBe(0);
    });
});
