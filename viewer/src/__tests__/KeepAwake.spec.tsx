import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeepAwake } from '../KeepAwake';

type Listener = () => void;

/** A stand-in for the Screen Wake Lock API: counts requests, and can be released by "the OS". */
function fakeWakeLock() {
    const held: { release: () => Promise<void>; drop: () => void }[] = [];
    const request = vi.fn(async () => {
        const listeners: Listener[] = [];
        const sentinel = {
            released: false,
            addEventListener: (_: string, fn: Listener) => listeners.push(fn),
            release: async () => {
                sentinel.released = true;
                listeners.forEach((fn) => fn());
            },
            drop: () => void sentinel.release(),
        };
        held.push(sentinel);
        return sentinel;
    });
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    return { request, held };
}

describe('KeepAwake', () => {
    afterEach(() => {
        cleanup();
        delete (navigator as { wakeLock?: unknown }).wakeLock;
    });

    it('is not offered where the browser cannot keep the screen on', () => {
        render(<KeepAwake className="" />);
        expect(screen.queryByTestId('viewer-awake')).toBeNull();
    });

    it('holds the screen on until switched off, and takes it back after the page was hidden', async () => {
        const lock = fakeWakeLock();
        render(<KeepAwake className="" />);
        const button = screen.getByTestId('viewer-awake');
        expect(button).toHaveAttribute('aria-pressed', 'false');

        await act(async () => fireEvent.click(button));
        expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(lock.request).toHaveBeenCalledTimes(1);

        // Switching tabs releases the lock; coming back takes it again.
        await act(async () => {
            lock.held[0].drop();
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(lock.request).toHaveBeenCalledTimes(2);

        await act(async () => fireEvent.click(button));
        expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(lock.held.every((s) => (s as unknown as { released: boolean }).released)).toBe(true);
    });

    it('switches itself off when the browser refuses', async () => {
        Object.defineProperty(navigator, 'wakeLock', {
            value: { request: () => Promise.reject(new Error('low battery')) },
            configurable: true,
        });
        render(<KeepAwake className="" />);
        const button = screen.getByTestId('viewer-awake');
        await act(async () => fireEvent.click(button));
        expect(button).toHaveAttribute('aria-pressed', 'false');
    });
});
