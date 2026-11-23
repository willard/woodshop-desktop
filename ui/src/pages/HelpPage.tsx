import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/app/api';
import { RELEASES, releaseNotes } from '@/app/whatsNew';
import { WhatsNewDialog } from '@/components/WhatsNewDialog';
import { HELP_ARTICLES } from '@/help';
import { failure } from '@/app/api';
import { openSampleWithTour } from '@/app/tour';
import { useToast } from '@/components/Toast';

export default function HelpPage() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const toast = useToast();
    const tour = useMutation({
        mutationFn: () => openSampleWithTour(queryClient),
        onSuccess: (project) => navigate({ to: '/projects/$id', params: { id: String(project.id) } }),
        onError: (e) => toast.error(failure('open the sample project', e)),
    });
    const info = useQuery({ queryKey: ['library-info'], queryFn: api.libraryInfo, staleTime: Infinity });
    const [notesOpen, setNotesOpen] = useState(false);
    // This version's notes; a development build shows the newest release's.
    const notes = (info.data && releaseNotes(info.data.version)) ?? RELEASES[0] ?? null;
    return (
        <>
            {notesOpen && notes && <WhatsNewDialog release={notes} onClose={() => setNotesOpen(false)} />}
            <div className="mb-2 flex items-center justify-between gap-3">
                <h1 className="text-xl font-semibold tracking-tight">Help Center</h1>
                {notes && (
                    <button
                        className="border-fg/12 text-accent hover:bg-surface-2 rounded-md border px-3 py-1.5 text-sm"
                        data-testid="whats-new-open"
                        onClick={() => setNotesOpen(true)}
                    >
                        What's new
                    </button>
                )}
            </div>
            <p className="text-muted mb-6 text-sm">
                How Woodshop works, from your first design to a printed plan.
            </p>
            <div className="border-accent/30 bg-accent/5 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-5">
                <div>
                    <div className="mb-1 font-semibold">
                        <span aria-hidden="true">🧭</span> Guided tour
                    </div>
                    <p className="text-muted text-sm">
                        Five quick steps through the editor on the sample nightstand: look around, select,
                        move, the cut list and export.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => tour.mutate()}
                    disabled={tour.isPending}
                    className="bg-accent text-accent-ink hover:bg-accent-strong rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                    data-testid="start-tour"
                >
                    Take the tour
                </button>
            </div>
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
