import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { isPieceCut, pieceKey, piecesCutOf, useCutProgress } from '../progress';

describe('useCutProgress', () => {
    beforeEach(() => window.localStorage.clear());

    it('remembers the parts ticked off for each design', () => {
        const { result, unmount } = renderHook(() => useCutProgress('p1'));
        act(() => result.current.set(['p_side_l', 'p_side_r'], true));
        act(() => result.current.set(['p_side_r'], false));
        expect([...result.current.cut]).toEqual(['p_side_l']);
        unmount();
        expect([...renderHook(() => useCutProgress('p1')).result.current.cut]).toEqual(['p_side_l']);
        expect(renderHook(() => useCutProgress('p2')).result.current.cut.size).toBe(0);
    });

    it('clears a design and forgets it', () => {
        const { result } = renderHook(() => useCutProgress('p1'));
        act(() => result.current.set(['p_top'], true));
        act(() => result.current.clear());
        expect(result.current.cut.size).toBe(0);
        expect(window.localStorage.getItem('woodshop.cut.p1')).toBeNull();
    });

    it('reads a damaged entry as nothing cut', () => {
        window.localStorage.setItem('woodshop.cut.p1', '{oops');
        expect(renderHook(() => useCutProgress('p1')).result.current.cut.size).toBe(0);
    });
});

describe('ticking one piece at a time', () => {
    beforeEach(() => window.localStorage.clear());

    it('counts the pieces of a part, and ticks the part once all are cut', () => {
        const { result } = renderHook(() => useCutProgress('p1'));
        act(() => result.current.toggle('p_leg', 2, 4));
        expect(piecesCutOf(result.current.cut, 'p_leg', 4)).toBe(1);
        expect(isPieceCut(result.current.cut, 'p_leg', 2)).toBe(true);
        expect(isPieceCut(result.current.cut, 'p_leg', 0)).toBe(false);
        for (const copy of [0, 1, 3]) act(() => result.current.toggle('p_leg', copy, 4));
        expect([...result.current.cut]).toEqual(['p_leg']);
    });

    it('unticks one piece of a part that was all cut', () => {
        const { result } = renderHook(() => useCutProgress('p1'));
        act(() => result.current.set(['p_leg'], true));
        act(() => result.current.toggle('p_leg', 1, 3));
        expect(piecesCutOf(result.current.cut, 'p_leg', 3)).toBe(2);
        expect(isPieceCut(result.current.cut, 'p_leg', 1)).toBe(false);
    });

    it('a whole-part tick replaces the pieces ticked, and is remembered', () => {
        const { result, unmount } = renderHook(() => useCutProgress('p1'));
        act(() => result.current.toggle('p_leg', 0, 4));
        act(() => result.current.toggle('p_top', 0, 2));
        act(() => result.current.set(['p_leg'], false));
        expect([...result.current.cut]).toEqual([pieceKey('p_top', 0)]);
        unmount();
        const again = renderHook(() => useCutProgress('p1')).result.current.cut;
        expect(piecesCutOf(again, 'p_top', 2)).toBe(1);
    });
});
