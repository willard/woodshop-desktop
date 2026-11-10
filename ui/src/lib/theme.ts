/**
 * Theme controller (D74). Owns the one piece of state the CSS token layer reads —
 * `<html data-theme>` — plus the device-local preference behind it.
 *
 * The preference is deliberately not on the user record: it describes the room the device is in
 * (a bright shop, a dark office), not the person, so a phone and a desktop should be free to
 * disagree. That also keeps it off the request path, which is what lets `app.blade.php` resolve
 * the theme inline before first paint instead of flashing the wrong one.
 */
import { type ThemeName, scenePalette, type ScenePalette } from '@/engine';

export type ThemePreference = ThemeName | 'system';

const STORAGE_KEY = 'woodshop.theme';

/**
 * Subscribers to an applied theme change. The toggle lives in the app shell now (D76), so the
 * editor no longer owns the moment the theme flips and cannot hand the new palette to the 3D
 * scene itself — it subscribes instead. The OS-change path notifies through here too, so there
 * is one route from "the theme changed" to "the scene was retinted".
 */
const listeners = new Set<(theme: ThemeName) => void>();

/** Registers a listener for applied theme changes. Returns an unsubscribe. */
export function onThemeChange(fn: (theme: ThemeName) => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

/** Kept in sync with the inline resolver in `app.blade.php` — both must agree or the page flashes. */
const THEME_COLOR: Record<ThemeName, string> = {
    dark: '#1c1917',
    light: '#e9e5dc',
};

function systemTheme(): ThemeName {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
}

/** The stored preference, or 'system' when nothing has been chosen (or storage is unavailable). */
export function readPreference(): ThemePreference {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        return stored === 'dark' || stored === 'light' ? stored : 'system';
    } catch {
        // Private browsing / disabled storage: fall back to following the OS.
        return 'system';
    }
}

export function resolveTheme(preference: ThemePreference): ThemeName {
    return preference === 'system' ? systemTheme() : preference;
}

/** The theme currently painted, read from the DOM rather than recomputed. */
export function activeTheme(): ThemeName {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Persists a preference and stamps it onto the document. Passing 'system' clears the override so
 * the page follows the OS again — including later OS changes, via `watchSystemTheme`.
 */
export function setPreference(preference: ThemePreference): ThemeName {
    try {
        if (preference === 'system') {
            window.localStorage.removeItem(STORAGE_KEY);
        } else {
            window.localStorage.setItem(STORAGE_KEY, preference);
        }
    } catch {
        // Preference just will not survive the reload; the current page still themes correctly.
    }
    return applyTheme(resolveTheme(preference));
}

/** Stamps `data-theme` and the PWA status-bar colour, then notifies. Returns what was applied. */
export function applyTheme(theme: ThemeName): ThemeName {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
    listeners.forEach((fn) => fn(theme));
    return theme;
}

/** The order the toggle steps through. Explicit choices first, then back to following the OS. */
const CYCLE: ThemePreference[] = ['dark', 'light', 'system'];

/** Advances to the next preference in the cycle and applies it. Returns the new preference. */
export function cyclePreference(): ThemePreference {
    const next = CYCLE[(CYCLE.indexOf(readPreference()) + 1) % CYCLE.length];
    setPreference(next);
    return next;
}

/**
 * Calls back when the OS theme changes, but only while the user is on 'system' — an explicit
 * choice must not be overridden by the laptop going dark at sunset. Returns an unsubscribe.
 */
export function watchSystemTheme(onChange: (theme: ThemeName) => void): () => void {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (): void => {
        if (readPreference() === 'system') {
            onChange(applyTheme(systemTheme()));
        }
    };
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
}

/** The 3D scene colours matching a theme — re-exported so callers need one import. */
export function sceneFor(theme: ThemeName): ScenePalette {
    return scenePalette(theme);
}
