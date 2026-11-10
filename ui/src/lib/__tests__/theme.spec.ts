import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    readPreference,
    resolveTheme,
    setPreference,
    applyTheme,
    activeTheme,
    watchSystemTheme,
    sceneFor,
} from '../theme';
import { DARK_SCENE, LIGHT_SCENE } from '@/engine';

/** jsdom has no matchMedia; this stands in for the OS preference and its change event. */
function stubSystem(prefersLight: boolean) {
    const listeners: (() => void)[] = [];
    const query = {
        matches: prefersLight,
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        removeEventListener: (_: string, fn: () => void) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) {
                listeners.splice(i, 1);
            }
        },
    };
    vi.stubGlobal(
        'matchMedia',
        vi.fn(() => query),
    );
    return {
        listenerCount: () => listeners.length,
        change(nowPrefersLight: boolean) {
            query.matches = nowPrefersLight;
            listeners.forEach((fn) => fn());
        },
    };
}

beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.head.innerHTML = '<meta name="theme-color" content="#1c1917">';
    vi.unstubAllGlobals();
});

describe('preference', () => {
    it('defaults to following the OS when nothing is stored', () => {
        stubSystem(true);
        expect(readPreference()).toBe('system');
        expect(resolveTheme('system')).toBe('light');
    });

    it('follows the OS in both directions', () => {
        stubSystem(false);
        expect(resolveTheme('system')).toBe('dark');
    });

    it('persists an explicit choice and stamps the document', () => {
        stubSystem(false);
        expect(setPreference('light')).toBe('light');
        expect(readPreference()).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(activeTheme()).toBe('light');
    });

    it('clears the override when returning to system', () => {
        stubSystem(true);
        setPreference('dark');
        expect(readPreference()).toBe('dark');

        expect(setPreference('system')).toBe('light');
        expect(readPreference()).toBe('system');
    });

    it('ignores a junk stored value rather than stamping it', () => {
        stubSystem(false);
        window.localStorage.setItem('woodshop.theme', 'sepia');
        expect(readPreference()).toBe('system');
    });

    it('survives storage being unavailable', () => {
        stubSystem(false);
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });

        expect(readPreference()).toBe('system');
        // The choice cannot be persisted, but the current page must still theme correctly.
        expect(setPreference('light')).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');

        getItem.mockRestore();
        setItem.mockRestore();
    });
});

describe('applyTheme', () => {
    it('tracks the PWA status-bar colour so the phone chrome matches', () => {
        applyTheme('light');
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#e9e5dc');

        applyTheme('dark');
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#1c1917');
    });

    it('reports dark for an unstamped document', () => {
        expect(activeTheme()).toBe('dark');
    });
});

describe('watchSystemTheme', () => {
    it('applies an OS change while the user is on system', () => {
        const system = stubSystem(false);
        const seen: string[] = [];
        watchSystemTheme((t) => seen.push(t));

        system.change(true);
        expect(seen).toEqual(['light']);
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('leaves an explicit choice alone when the OS flips', () => {
        const system = stubSystem(false);
        const seen: string[] = [];
        watchSystemTheme((t) => seen.push(t));
        setPreference('dark');

        system.change(true);
        expect(seen).toEqual([]);
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('unsubscribes', () => {
        const system = stubSystem(false);
        const stop = watchSystemTheme(() => {});
        expect(system.listenerCount()).toBe(1);
        stop();
        expect(system.listenerCount()).toBe(0);
    });
});

describe('sceneFor', () => {
    it('maps each theme onto its scene palette', () => {
        expect(sceneFor('dark')).toBe(DARK_SCENE);
        expect(sceneFor('light')).toBe(LIGHT_SCENE);
    });
});
