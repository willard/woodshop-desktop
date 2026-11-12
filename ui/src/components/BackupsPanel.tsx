/**
 * Settings ▸ Backups: the library is copied once a day and the last week is kept. Restoring
 * copies one project out of a backup as a new project, so nothing in the library is overwritten.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type BackupInfo } from '@/app/api';
import { Modal } from './Modal';
import { useToast } from './Toast';

const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });

const megabytes = (bytes: number) =>
    bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function BackupsPanel() {
    const toast = useToast();
    const queryClient = useQueryClient();
    const backups = useQuery({ queryKey: ['backups'], queryFn: api.listBackups });
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState<BackupInfo | null>(null);

    async function backUpNow(): Promise<void> {
        setBusy(true);
        try {
            await api.backupNow();
            await queryClient.invalidateQueries({ queryKey: ['backups'] });
            toast.success('Library backed up.');
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    const list = backups.data ?? [];
    return (
        <div data-testid="backups">
            <ul className="border-fg/8 divide-fg/[0.06] mb-2 divide-y rounded-lg border">
                {list.map((b) => (
                    <li
                        key={b.file}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                        data-testid="backup-row"
                    >
                        <span className="min-w-0 flex-1">{when(b.createdAt)}</span>
                        <span className="text-muted text-xs">{megabytes(b.bytes)}</span>
                        <button
                            className="text-accent text-xs font-medium hover:underline"
                            data-testid="backup-open"
                            onClick={() => setOpen(b)}
                        >
                            Look inside
                        </button>
                    </li>
                ))}
                {backups.isSuccess && list.length === 0 && (
                    <li className="text-muted px-3 py-3 text-sm">
                        No backups yet. The first one is made a few seconds after Woodshop starts.
                    </li>
                )}
            </ul>
            <button
                className="border-fg/12 hover:bg-surface-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                disabled={busy}
                data-testid="backup-now"
                onClick={() => void backUpNow()}
            >
                {busy ? 'Backing up…' : 'Back up now'}
            </button>
            {open && <BackupContents backup={open} onClose={() => setOpen(null)} />}
        </div>
    );
}

function BackupContents({ backup, onClose }: { backup: BackupInfo; onClose(): void }) {
    const toast = useToast();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const projects = useQuery({
        queryKey: ['backup', backup.file],
        queryFn: () => api.backupProjects(backup.file),
    });
    const [restoring, setRestoring] = useState<number | null>(null);

    async function restore(projectId: number): Promise<void> {
        setRestoring(projectId);
        try {
            const project = await api.restoreFromBackup(backup.file, projectId);
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
            toast.success(`Restored as “${project.name}”.`);
            onClose();
            void navigate({ to: '/projects/$id', params: { id: String(project.id) } });
        } catch (e) {
            toast.error(errorMessage(e));
        } finally {
            setRestoring(null);
        }
    }

    return (
        <Modal onClose={onClose} testId="backup-contents" className="max-w-lg">
            <h2 className="mb-1 text-base font-semibold">Backup from {when(backup.createdAt)}</h2>
            <p className="text-muted mb-3 text-xs">
                Restoring copies a project out of this backup as a new project, with its versions and notes.
                Nothing in your library is replaced.
            </p>
            <ul className="border-fg/8 max-h-80 overflow-y-auto rounded-lg border">
                {(projects.data ?? []).map((p) => (
                    <li
                        key={p.id}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                        data-testid="backup-project"
                    >
                        <span className="min-w-0 flex-1 truncate">
                            {p.name}
                            {p.deletedAt !== null && <span className="text-muted"> · in trash</span>}
                        </span>
                        <span className="text-muted text-xs">{p.partCount} parts</span>
                        <button
                            className="border-fg/12 hover:bg-surface-2 rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                            disabled={restoring !== null}
                            data-testid="backup-restore"
                            onClick={() => void restore(p.id)}
                        >
                            {restoring === p.id ? 'Restoring…' : 'Restore'}
                        </button>
                    </li>
                ))}
                {projects.isPending && <li className="text-muted px-3 py-3 text-sm">Opening the backup…</li>}
                {projects.isError && (
                    <li className="text-danger-fg px-3 py-3 text-sm">{errorMessage(projects.error)}</li>
                )}
            </ul>
            <div className="mt-3 flex justify-end">
                <button
                    className="border-fg/12 hover:bg-surface-2 rounded-lg border px-3 py-2 text-sm"
                    onClick={onClose}
                >
                    Close
                </button>
            </div>
        </Modal>
    );
}
