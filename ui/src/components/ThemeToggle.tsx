/**
 * Theme control: cycles dark → light → system, so a user who picks a theme can get back to
 * following the OS.
 */
import { useEffect, useState } from 'react';
import { cyclePreference, readPreference, watchSystemTheme, type ThemePreference } from '@/lib/theme';

const LABEL: Record<ThemePreference, string> = {
    dark: 'Theme: dark',
    light: 'Theme: light',
    system: 'Theme: match system',
};

const NEXT: Record<ThemePreference, string> = { dark: 'light', light: 'system', system: 'dark' };

export function ThemeToggle() {
    const [preference, setPreference] = useState<ThemePreference>(readPreference);

    // Keeps the label honest while on 'system': the icon does not change, but the OS may.
    useEffect(() => watchSystemTheme(() => setPreference(readPreference())), []);

    const label = `${LABEL[preference]}. Switch to ${NEXT[preference]}.`;
    return (
        <button
            type="button"
            className="text-muted hover:bg-surface-2 hover:text-fg-strong flex h-[30px] w-[30px] items-center justify-center rounded-lg"
            data-testid="theme-toggle"
            data-theme-preference={preference}
            aria-label={label}
            title={label}
            onClick={() => setPreference(cyclePreference())}
        >
            {preference === 'light' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="2" />
                    <path
                        d="M12 2.4v2.4M12 19.2v2.4M4.2 12H1.8M22.2 12h-2.4M6.5 6.5 4.8 4.8M19.2 19.2l-1.7-1.7M17.5 6.5l1.7-1.7M4.8 19.2l1.7-1.7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                </svg>
            ) : preference === 'dark' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                        d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                    />
                </svg>
            ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect
                        x="2.6"
                        y="4"
                        width="18.8"
                        height="12.4"
                        rx="1.8"
                        stroke="currentColor"
                        strokeWidth="2"
                    />
                    <path
                        d="M8.4 20.4h7.2M12 16.4v4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                </svg>
            )}
        </button>
    );
}
