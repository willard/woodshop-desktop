/** The shell around every page except the editor: brand, primary nav, theme. */
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/app/api';
import { useSettings } from '@/app/settings';
import { LAST_SEEN_SETTING, releaseNotes, shouldShowNotes, type Release } from '@/app/whatsNew';
import { WhatsNewDialog } from './WhatsNewDialog';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
    { to: '/', label: 'Projects' },
    { to: '/templates', label: 'Templates' },
    { to: '/tools', label: 'Tools' },
    { to: '/help', label: 'Help' },
    { to: '/settings', label: 'Settings' },
] as const;

/** Pages that are a grid of cards use the window's width; reading pages keep a readable measure. */
const WIDE = new Set(['/', '/trash', '/templates']);

/**
 * After an update, the new version's notes, once. The version is remembered either way, so a
 * first install starts quietly and a second start after an update does not show them again.
 */
function useNotesAfterUpdate(): [Release | null, () => void] {
    const info = useQuery({ queryKey: ['library-info'], queryFn: api.libraryInfo, staleTime: Infinity });
    const settings = useSettings();
    const [notes, setNotes] = useState<Release | null>(null);
    const checked = useRef(false);
    useEffect(() => {
        if (checked.current || info.data === undefined || settings.data === undefined) return;
        checked.current = true;
        const current = info.data.version;
        const lastSeen = settings.data[LAST_SEEN_SETTING];
        if (shouldShowNotes(current, lastSeen)) setNotes(releaseNotes(current));
        if (lastSeen !== current) void api.setSetting(LAST_SEEN_SETTING, current).catch(() => undefined);
    }, [info.data, settings.data]);
    return [notes, () => setNotes(null)];
}

export function AppLayout() {
    const path = useRouterState({ select: (s) => s.location.pathname });
    const [notes, closeNotes] = useNotesAfterUpdate();
    const width = WIDE.has(path) ? 'max-w-[1680px]' : 'max-w-6xl';
    return (
        <div className="flex h-full flex-col overflow-hidden">
            <header
                className="border-fg/8 bg-surface-1/60 titlebar-gutter shrink-0 border-b backdrop-blur"
                data-tauri-drag-region
            >
                {/* Every empty stretch of the header drags the window: the attribute only counts on
                    the element actually under the pointer. */}
                <div
                    className={`mx-auto flex ${width} items-center justify-between px-6 py-3`}
                    data-tauri-drag-region
                >
                    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
                        <span className="text-accent">◧</span>
                        <span>Woodshop</span>
                    </Link>
                    <nav className="flex items-center gap-1 text-sm">
                        {LINKS.map((link) => (
                            <Link
                                key={link.to}
                                to={link.to}
                                activeOptions={{ exact: link.to === '/' }}
                                className="text-muted hover:text-fg-strong data-[status=active]:text-accent rounded-md px-3 py-1.5"
                            >
                                {link.label}
                            </Link>
                        ))}
                        <span className="bg-fg/10 mx-2 h-5 w-px" />
                        <ThemeToggle />
                    </nav>
                </div>
            </header>
            <main className="flex-1 overflow-y-auto">
                <div className={`mx-auto w-full ${width} px-6 py-8`}>
                    {/* Inside the shell, so a page still loading never takes the nav bar with it. */}
                    <Suspense fallback={null}>
                        <Outlet />
                    </Suspense>
                </div>
            </main>
            {notes && <WhatsNewDialog release={notes} onClose={closeNotes} />}
        </div>
    );
}
