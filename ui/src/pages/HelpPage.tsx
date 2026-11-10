import { Link } from '@tanstack/react-router';
import { HELP_ARTICLES } from '@/help';

export default function HelpPage() {
    return (
        <>
            <h1 className="mb-2 text-xl font-semibold tracking-tight">Help Center</h1>
            <p className="text-muted mb-6 text-sm">
                How Woodshop works, from your first design to a printed plan.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                {HELP_ARTICLES.map((a) => (
                    <Link
                        key={a.slug}
                        to="/help/$slug"
                        params={{ slug: a.slug }}
                        className="border-fg/8 bg-surface-1/50 hover:border-accent-strong/50 hover:bg-surface-1 rounded-xl border p-5 transition"
                    >
                        <div className="mb-1 flex items-center gap-2 font-semibold">
                            <span aria-hidden="true">{a.icon}</span>
                            {a.title}
                        </div>
                        <p className="text-muted text-sm">{a.summary}</p>
                    </Link>
                ))}
            </div>
        </>
    );
}
