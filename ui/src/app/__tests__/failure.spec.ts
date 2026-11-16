import { describe, expect, it } from 'vitest';
import { failure } from '../api';

describe('failure', () => {
    it('says what failed and passes a readable reason through', () => {
        expect(
            failure('import the file', {
                kind: 'invalid',
                message: 'Not a Woodshop project file: no project.json',
                issues: [],
            }),
        ).toBe("Couldn't import the file. Not a Woodshop project file: no project.json.");
    });

    it('turns system errors into a next step', () => {
        expect(failure('export the PDF', { kind: 'io', message: 'Permission denied (os error 13)' })).toBe(
            "Couldn't export the PDF. Woodshop isn't allowed to use that location. Pick a folder of your own, such as Documents.",
        );
        expect(
            failure('back up the library', { kind: 'io', message: 'No space left on device (os error 28)' }),
        ).toBe("Couldn't back up the library. The disk is full. Free some space and try again.");
        expect(failure('open the file', new Error('No such file or directory (os error 2)'))).toContain(
            'moved or renamed',
        );
    });

    it('points unexpected failures at the problem report', () => {
        expect(failure('save', { kind: 'internal', message: 'disk I/O error' })).toBe(
            "Couldn't save. Disk I/O error. If this keeps happening, use Report a problem in Settings, Diagnostics.",
        );
    });

    it('never ends on a bare reason', () => {
        expect(failure('rename the project', '')).toBe("Couldn't rename the project. Try again.");
    });
});
