import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HELP_ARTICLES } from '@/help';
import { errorMessage } from '@/app/api';
import { openSampleWithTour } from '@/app/tour';
import { useToast } from '@/components/Toast';

export default function HelpPage() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const toast = useToast();
    const tour = useMutation({
        mutationFn: () => openSampleWithTour(queryClient),
        onSuccess: (project) => navigate({ to: '/projects/$id', params: { id: String(project.id) } }),
        onError: (e) => toast.error(errorMessage(e)),
    });
    return (
        <>
            <h1 className="mb-2 text-xl font-semibold tracking-tight">Help Center</h1>
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
