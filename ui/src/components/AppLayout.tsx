/** The shell around every page except the editor: brand, primary nav, theme. */
import { Link, Outlet } from '@tanstack/react-router';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
    { to: '/', label: 'Projects' },
    { to: '/templates', label: 'Templates' },
    { to: '/tools', label: 'Tools' },
    { to: '/help', label: 'Help' },
    { to: '/settings', label: 'Settings' },
] as const;

export function AppLayout() {
    return (
        <div className="flex h-full flex-col overflow-hidden">
            <header
                className="border-fg/8 bg-surface-1/60 shrink-0 border-b backdrop-blur"
                data-tauri-drag-region
            >
                <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
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
                <div className="mx-auto w-full max-w-6xl px-4 py-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
