/** Version history: named snapshots of the design, append-only, each restorable. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/app/api';
import type { Spec } from '@/spec';
import { useToast } from './Toast';

function whenLabel(ms: number): string {
    return new Date(ms).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

export function VersionsPanel(props: {
    projectId: number;
    getSpec(): Spec;
    beforeSave(): void;
    onSaved(stamp: number): void;
    onRestored(spec: Spec, stamp: number): void;
    onClose(): void;
}) {
    const toast = useToast();
    const queryClient = useQueryClient();
    const key = ['versions', props.projectId];
    const versions = useQuery({ queryKey: key, queryFn: () => api.listVersions(props.projectId) });
    const [label, setLabel] = useState('');
    const [busy, setBusy] = useState(false);

    async function run(work: () => Promise<void>): Promise<void> {
        setBusy(true);
        try {
            await work();
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    const save = () =>
        run(async () => {
            props.beforeSave();
            const res = await api.createVersion(props.projectId, props.getSpec(), label.trim() || null);
            props.onSaved(res.draftUpdatedAt);
            setLabel('');
            await queryClient.invalidateQueries({ queryKey: key });
        });

    const restore = (versionId: number) =>
        run(async () => {
            const res = await api.restoreVersion(props.projectId, versionId);
            props.onRestored(res.spec, res.draftUpdatedAt);
            await queryClient.invalidateQueries({ queryKey: key });
        });

    const list = versions.data ?? [];
    return (
        <div
            className="bg-surface-0/95 border-fg/[0.07] absolute inset-y-0 right-0 z-40 flex w-96 flex-col border-l backdrop-blur"
            data-testid="versions"
        >
            <div className="border-fg/[0.07] flex items-center justify-between border-b px-4 py-3">
                <h2 className="font-semibold">Version history</h2>
                <button className="text-muted hover:bg-fg/5 rounded-lg px-2 py-1" onClick={props.onClose}>
                    Close ✕
                </button>
            </div>
            <div className="border-fg/[0.07] border-b p-4">
                <div className="flex gap-2">
                    <input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Label (optional)"
                        data-testid="version-label"
                        className="bg-surface-2 focus:border-accent border-fg/10 flex-1 rounded-lg border px-2 py-2 text-sm focus:outline-none"
                        onKeyDown={(e) => e.key === 'Enter' && void save()}
                    />
                    <button
                        className="bg-accent text-accent-ink hover:bg-accent-strong rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
                        data-testid="save-version"
                        disabled={busy}
                        onClick={() => void save()}
                    >
                        Save version
                    </button>
                </div>
            </div>
            <ul className="flex-1 overflow-auto p-2 text-sm">
                {list.map((v) => (
                    <li
                        key={v.id}
                        className="hover:bg-fg/5 flex items-center justify-between rounded-lg px-2 py-2"
                        data-testid="version-row"
                    >
                        <div>
                            <div className="font-medium">{v.label || 'Untitled'}</div>
                            <div className="text-muted text-xs">
                                {whenLabel(v.createdAt)} · {v.createdBy === 'mcp' ? 'AI agent' : 'you'}
                            </div>
                        </div>
                        <button
                            className="border-fg/10 hover:bg-fg/5 rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void restore(v.id)}
                        >
                            Restore
                        </button>
                    </li>
                ))}
                {versions.isSuccess && list.length === 0 && (
                    <li className="text-muted px-2 py-6 text-center">
                        No saved versions yet. Save one to snapshot this design.
                    </li>
                )}
            </ul>
        </div>
    );
}
