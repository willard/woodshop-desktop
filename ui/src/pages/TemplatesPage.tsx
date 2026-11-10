/** The template gallery: finished designs a new project can start from. */
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/app/api';
import { useToast } from '@/components/Toast';

const DIFFICULTY_COLOR: Record<string, string> = {
    beginner: 'bg-ok/20 text-ok-fg',
    intermediate: 'bg-accent/20 text-accent',
    advanced: 'bg-danger/20 text-danger-fg',
};

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
            toast.error(errorMessage(e));
        } finally {
            setUsing(null);
        }
    }

    return (
        <>
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-xl font-semibold tracking-tight">Start from a template</h1>
                <Link to="/" className="text-accent text-sm">
                    ← Your projects
                </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(templates.data ?? []).map((t) => (
                    <div
                        key={t.id}
                        className="border-fg/8 bg-surface-1/50 flex flex-col rounded-xl border p-4"
                        data-testid="template-card"
                    >
                        <div className="mb-1 flex items-center justify-between">
                            <h2 className="font-semibold">{t.name}</h2>
                            {t.difficulty && (
                                <span
                                    className={`rounded px-2 py-0.5 text-xs capitalize ${DIFFICULTY_COLOR[t.difficulty] ?? 'bg-surface-3 text-muted'}`}
                                >
                                    {t.difficulty}
                                </span>
                            )}
                        </div>
                        <p className="text-muted mb-3 flex-1 text-sm">{t.notes || 'A starter design.'}</p>
                        <div className="flex items-center justify-between">
                            <span className="text-faint text-xs">{t.partCount} parts</span>
                            <button
                                className="bg-accent text-accent-ink hover:bg-accent-strong rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                                disabled={using !== null}
                                data-testid="use-template"
                                onClick={() => startFromTemplate(t.id, t.name)}
                            >
                                {using === t.id ? 'Creating…' : 'Use template'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
}
