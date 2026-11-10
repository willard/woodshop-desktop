/** The shop calculators hub: the numbers you work out at the bench, no project needed. */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CalculatorIndex } from '@/components/tools/ToolsOverlay';

export default function ToolsPage() {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    return (
        <div data-testid="tools-page">
            <h1 className="mb-2 text-xl font-semibold tracking-tight">Shop calculators</h1>
            <p className="text-muted mb-6 max-w-2xl text-sm">
                The numbers you work out at the bench, without opening a project — board feet, saw settings,
                sag, seasonal movement. Fractions are read the way you write them.
            </p>
            <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="text"
                placeholder="Filter calculators"
                aria-label="Filter calculators"
                data-testid="tools-filter"
                className="border-fg/12 bg-surface-1 text-fg-strong placeholder-faint focus:border-accent mb-6 h-11 w-full rounded-md border px-3 text-sm focus:outline-none"
            />
            <CalculatorIndex
                filter={query}
                onOpen={(id) => navigate({ to: '/tools/$slug', params: { slug: id } })}
            />
        </div>
    );
}
