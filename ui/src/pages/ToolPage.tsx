import { Suspense } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { calculatorById } from '@/calc/registry';
import { CALC_PANELS } from '@/components/tools/panels';

export default function ToolPage() {
    const { slug } = useParams({ strict: false }) as { slug: string };
    const meta = calculatorById(slug);
    const Panel = CALC_PANELS[slug];
    return (
        <div data-testid="tools-page">
            <nav className="text-faint mb-4 text-sm">
                <Link to="/tools" className="text-accent">
                    Shop calculators
                </Link>
                <span className="px-1.5">/</span>
                <span>{meta?.title ?? 'Unknown'}</span>
            </nav>
            {meta && Panel ? (
                <>
                    <h1 className="mb-1 text-xl font-semibold tracking-tight">{meta.title}</h1>
                    <p className="text-muted mb-5 text-sm">{meta.summary}</p>
                    <Suspense fallback={<p className="text-faint text-sm">Loading…</p>}>
                        <Panel />
                    </Suspense>
                </>
            ) : (
                <p className="text-muted">No such calculator.</p>
            )}
        </div>
    );
}
