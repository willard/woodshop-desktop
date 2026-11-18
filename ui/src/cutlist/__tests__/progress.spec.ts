import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCutProgress } from '../progress';

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
