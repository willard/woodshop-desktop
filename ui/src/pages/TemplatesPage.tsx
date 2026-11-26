/** The template gallery: finished designs a new project can start from. */
import { useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, failure, type TemplateSummary } from '@/app/api';
import { plural } from '@/app/format';
import { dims, useUnits } from '@/lib/display';
import { activeTheme, onThemeChange } from '@/lib/theme';
import { useToast } from '@/components/Toast';
import { BlankThumbnail } from '@/components/BlankThumbnail';

const DIFFICULTY_COLOR: Record<string, string> = {
    beginner: 'text-ok-fg',
    intermediate: 'text-accent',
    advanced: 'text-danger-fg',
};

/** How long a template may take, for the filter: up to `max` hours. */
const TIMES = [
    { key: 'any', label: 'Any time', max: Infinity },
    { key: 'afternoon', label: 'An afternoon', max: 4 },
    { key: 'day', label: 'A day', max: 8 },
    { key: 'weekend', label: 'A weekend', max: 16 },
] as const;
type TimeKey = (typeof TIMES)[number]['key'];

/** "About 9 hours", "About 1 hour". */
export function aboutHours(hours: number): string {
    return `About ${hours === 1 ? '1 hour' : `${hours} hours`}`;
}

/** The templates the filters leave: within the time, and without a router when asked. */
export function filterTemplates(
    templates: readonly TemplateSummary[],
    time: TimeKey,
    noRouter: boolean,
): TemplateSummary[] {
    const max = TIMES.find((t) => t.key === time)?.max ?? Infinity;
    return templates.filter((t) => t.effort.hours <= max && !(noRouter && t.effort.needsRouter));
}

/** The painted theme, re-rendering on a change, so each picture matches the page around it. */
function useActiveTheme() {
    return useSyncExternalStore(onThemeChange, activeTheme);
}

export function TemplatesPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const toast = useToast();
    const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates, staleTime: Infinity });
    const [using, setUsing] = useState<string | null>(null);
    const [time, setTime] = useState<TimeKey>('any');
    const [noRouter, setNoRouter] = useState(false);
    const all = templates.data ?? [];
    const shown = filterTemplates(all, time, noRouter);
    const filtering = time !== 'any' || noRouter;

    async function startFromTemplate(id: string, name: string): Promise<void> {
        setUsing(id);
        try {
            const project = await api.createProject(name, id);
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
            navigate({ to: '/projects/$id', params: { id: String(project.id) } });
        } catch (e) {
            toast.error(failure('start a project from that template', e));
        } finally {
            setUsing(null);
        }
    }

    return (
        <>
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Start from a template</h1>
                    <p className="text-muted mt-1 text-sm">
                        A finished design to build as it is or change to fit. It opens as your own copy.
                    </p>
                </div>
                <Link to="/" className="text-accent text-sm">
                    ← Your projects
                </Link>
            </div>
            <div
                className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
                data-testid="template-filters"
            >
                <div
                    role="group"
                    aria-label="Time to build"
                    className="border-fg/12 flex rounded-lg border p-0.5"
                >
                    {TIMES.map((t) => (
                        <button
                            key={t.key}
                            aria-pressed={time === t.key}
                            className={`rounded-md px-2.5 py-1 text-xs ${time === t.key ? 'bg-fg/10 text-fg font-medium' : 'text-muted hover:text-fg'}`}
                            title={t.max === Infinity ? undefined : `Up to ${t.max} hours in the shop`}
                            onClick={() => setTime(t.key)}
                            data-testid={`template-filter-${t.key}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                <label className="text-muted flex cursor-pointer items-center gap-1.5 text-xs">
                    <input
                        type="checkbox"
                        className="accent-accent"
                        checked={noRouter}
                        onChange={(e) => setNoRouter(e.target.checked)}
                        data-testid="template-filter-no-router"
                    />
                    No router
                </label>
                {filtering && (
                    <span className="text-faint text-xs" data-testid="template-filter-count">
                        {shown.length} of {plural(all.length, 'template')}
                    </span>
                )}
            </div>
            {filtering && shown.length === 0 && (
                <p className="text-muted text-sm" data-testid="template-filter-none">
                    No template fits.{' '}
                    <button
                        className="text-accent hover:underline"
                        onClick={() => {
                            setTime('any');
                            setNoRouter(false);
                        }}
                    >
                        Show them all
                    </button>
                </p>
            )}
            <ul className="grid [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] gap-4">
                {shown.map((t) => (
                    <TemplateCard
                        key={t.id}
                        template={t}
                        busy={using === t.id}
                        disabled={using !== null}
                        onUse={() => void startFromTemplate(t.id, t.name)}
                    />
                ))}
            </ul>
        </>
    );
}

function TemplateCard({
    template: t,
    busy,
    disabled,
    onUse,
}: {
    template: TemplateSummary;
    busy: boolean;
    disabled: boolean;
    onUse: () => void;
}) {
    const theme = useActiveTheme();
    const units = useUnits();
    const [missing, setMissing] = useState(false);
    const facts = [
        t.overall === null ? null : dims(t.overall.width, t.overall.depth, t.overall.height, units),
        // Sheets for a design in sheet goods; board feet (a lumber measure) only for one in lumber.
        t.sheetCount > 0 ? plural(t.sheetCount, 'sheet') : null,
        t.sheetCount === 0 && t.boardFeet > 0 ? `${t.boardFeet.toFixed(1)} bd ft` : null,
    ].filter((f): f is string => f !== null);

    return (
        <li
            className="border-fg/8 bg-surface-1 hover:border-fg/20 focus-within:border-accent/60 relative flex flex-col overflow-hidden rounded-xl border transition-colors"
            data-testid="template-card"
        >
            <div className="bg-surface-2 border-fg/8 flex aspect-[16/10] items-center justify-center overflow-hidden border-b">
                {missing ? (
                    <BlankThumbnail />
                ) : (
                    <img
                        src={`/templates/${t.id}-${theme}.webp`}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => setMissing(true)}
                        data-testid="template-thumb"
                    />
                )}
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-4">
                <div className="flex items-baseline justify-between gap-2">
                    {/* The button's hit area covers the whole card: one click target, one name for it. */}
                    <h2 className="font-semibold">
                        <button
                            className="text-left after:absolute after:inset-0 after:content-[''] focus:outline-none disabled:cursor-wait"
                            disabled={disabled}
                            onClick={onUse}
                            data-testid="use-template"
                        >
                            {t.name}
                        </button>
                    </h2>
                    {t.difficulty && (
                        <span
                            className={`flex-none text-xs font-medium capitalize ${DIFFICULTY_COLOR[t.difficulty] ?? 'text-muted'}`}
                        >
                            {t.difficulty}
                        </span>
                    )}
                </div>
                <p className="text-muted text-sm leading-snug">
                    {t.summary ?? t.notes ?? 'A starter design.'}
                </p>
                {t.author && (
                    <p className="text-faint text-xs" data-testid="template-credit">
                        Plan by {t.author.name}
                    </p>
                )}
                <p className="text-faint mt-auto pt-2 text-xs" data-testid="template-facts">
                    {facts.join(' · ')}
                </p>
                {t.effort.hours > 0 && (
                    <p
                        className="text-faint text-xs leading-snug"
                        data-testid="template-takes"
                        title="Rough time in the shop with the tools set up, not counting the finish"
                    >
                        <span className="text-muted">{aboutHours(t.effort.hours)}</span> ·{' '}
                        {[t.effort.cuts.join(', '), t.effort.joints.join(', ')].filter(Boolean).join(' · ')}
                    </p>
                )}
                {t.tools.length > 0 && (
                    <p className="text-faint text-xs leading-snug" data-testid="template-tools">
                        <span className="text-muted">{plural(t.effort.toolCount, 'tool')}:</span>{' '}
                        {t.tools.join(', ')}
                        {t.effort.toolCount - t.tools.length >= 2
                            ? ', plus a tape measure and clamps'
                            : ', plus a tape measure'}
                    </p>
                )}
                <span
                    aria-hidden="true"
                    className={`border-fg/12 text-fg/75 mt-2 self-start rounded-md border px-2.5 py-1 text-xs ${busy ? 'opacity-60' : ''}`}
                >
                    {busy ? 'Creating…' : 'Use template'}
                </span>
            </div>
        </li>
    );
}
