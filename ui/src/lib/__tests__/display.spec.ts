import { describe, it, expect, afterEach } from 'vitest';
import {
    defaultUnits,
    len,
    lenValue,
    parseLen,
    parseSignedLen,
    setUnits,
    size,
    unitSuffix,
} from '@/lib/display';

describe('display units', () => {
    afterEach(() => setUnits('fraction'));

    it('formats in the current system', () => {
        setUnits('fraction');
        expect(len(3.5)).toBe('3 1/2"');
        expect(size(24, 16)).toBe('24" × 16"');
        setUnits('metric');
        expect(len(3.5)).toBe('89 mm');
        expect(lenValue(0.75)).toBe('19');
        expect(size(24, 16)).toBe('610 × 406 mm');
        expect(unitSuffix()).toBe('mm');
        setUnits('decimal');
        expect(len(3.5)).toBe('3.5"');
    });

    it('reads a bare number in the current system and a named unit in any', () => {
        setUnits('metric');
        expect(parseLen('25.4')).toBeCloseTo(1, 9);
        expect(parseLen('1 1/2"')).toBe(1.5);
        expect(parseSignedLen('-254')).toBeCloseTo(-10, 9);
        setUnits('fraction');
        expect(parseLen('450mm')).toBeCloseTo(17.716535, 5);
        expect(parseLen('nope')).toBeNull();
    });

    it('defaults to inches where inches are the trade unit', () => {
        expect(defaultUnits('en-US')).toBe('fraction');
        expect(defaultUnits('en-GB')).toBe('metric');
        expect(defaultUnits('de-DE')).toBe('metric');
        expect(defaultUnits('en')).toBe('fraction');
    });
});
