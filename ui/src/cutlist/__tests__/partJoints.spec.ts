import { describe, it, expect } from 'vitest';
import { partJoints } from '@/cutlist';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

describe('partJoints', () => {
    const spec = parseSpec(recordStand);

    it('words each joint of a part as the assembly steps do', () => {
        expect(partJoints(spec, 'p_side_l')).toEqual([
            'Middle Shelf seats in its dado',
            '3 pocket screws from Top',
            '3 pocket screws from Bottom',
            '6 screws through Back Panel',
        ]);
        expect(partJoints(spec, 'p_top')).toContain('3 pocket screws into Left Side');
    });

    it('has nothing for a part with no joints', () => {
        expect(partJoints(spec, 'nope')).toEqual([]);
    });
});
