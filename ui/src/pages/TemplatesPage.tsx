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
            <ul className="grid [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] gap-4">
                {(templates.data ?? []).map((t) => (
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
