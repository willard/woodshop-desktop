import { describe, it, expect } from 'vitest';
import { EditorDocument } from '@/engine/EditorDocument';
import { SetGrainAxis } from '@/engine/commands';
import { parseSpec } from '@/spec';
import recordStand from '@fixtures/specs/record-stand.spec.json';

function doc(): EditorDocument {
    return new EditorDocument(parseSpec(recordStand));
}

describe('SetGrainAxis', () => {
    it('sets the grain axis on the target part', () => {
        const d = doc();
        const before = d.spec.parts.find((p) => p.id === 'p_top')!;
        expect(before.grainAxis).toBe('l');

        d.execute(new SetGrainAxis('p_top', 'w'));

        const after = d.spec.parts.find((p) => p.id === 'p_top')!;
        expect(after.grainAxis).toBe('w');
    });

    it('can set grain axis to none', () => {
        const d = doc();
        d.execute(new SetGrainAxis('p_top', 'none'));

        const after = d.spec.parts.find((p) => p.id === 'p_top')!;
        expect(after.grainAxis).toBe('none');
    });

    it('undo restores the original grain axis', () => {
        const d = doc();
        d.execute(new SetGrainAxis('p_top', 'w'));
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.grainAxis).toBe('w');

        d.undo();
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.grainAxis).toBe('l');

        d.redo();
        expect(d.spec.parts.find((p) => p.id === 'p_top')!.grainAxis).toBe('w');
    });

    it('is a no-op when the part already has that grain axis', () => {
        const d = doc();
        const before = JSON.stringify(d.spec);
        d.execute(new SetGrainAxis('p_top', 'l'));
        expect(JSON.stringify(d.spec)).toBe(before);
    });
});
