/** The project library: every design on this computer, newest first. */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ask } from '@tauri-apps/plugin-dialog';
import { api, errorMessage, thumbnailUrl, type ProjectSummary } from '@/app/api';
import { importProjectFromDialog, chooseSavePath, fileStem, WOODSHOP_FILTER } from '@/app/files';
import { plural, timeAgo } from '@/app/format';
import { useToast } from '@/components/Toast';

export function ProjectsPage({ trashed = false }: { trashed?: boolean }) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const toast = useToast();
    const [name, setName] = useState('');

    const projects = useQuery({ queryKey: ['projects', trashed], queryFn: () => api.listProjects(trashed) });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['projects'] });

    const create = useMutation({
        mutationFn: (n: string) => api.createProject(n),
        onSuccess: (project) => {
            setName('');
            refresh();
            navigate({ to: '/projects/$id', params: { id: String(project.id) } });
        },
        onError: (e) => toast.error(errorMessage(e)),
    });

    async function importFile(): Promise<void> {
        try {
            const project = await importProjectFromDialog();
            if (project === null) return;
            refresh();
            toast.success(`Imported “${project.name}”.`);
        } catch (e) {
            toast.error(errorMessage(e));
        }
    }

    function submit(event: FormEvent): void {
        event.preventDefault();
        if (name.trim() !== '') create.mutate(name.trim());
    }

    const list = projects.data ?? [];

    return (
        <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-xl font-semibold tracking-tight">
                    {trashed ? 'Trash' : 'Your projects'}
                </h1>
                <div className="flex items-center gap-2 text-sm">
                    {trashed ? (
                        <Link to="/" className="text-accent hover:text-accent-strong">
                            ← Your projects
                        </Link>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={importFile}
                                className="border-fg/12 text-muted hover:bg-surface-2 hover:text-fg-strong rounded-md border px-3 py-1.5"
                            >
                                Import…
                            </button>
                            <Link
                                to="/templates"
                                className="border-fg/12 text-accent hover:bg-surface-2 rounded-md border px-3 py-1.5"
                            >
                                Start from a template
                            </Link>
                        </>
                    )}
                </div>
            </div>

            {!trashed && (
                <form className="mb-8 flex gap-2" onSubmit={submit}>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        type="text"
                        placeholder="New project name"
                        maxLength={120}
                        className="border-fg/12 bg-surface-1 focus:border-accent flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none"
                    />
                    <button
                        type="submit"
                        disabled={create.isPending || name.trim() === ''}
                        className="bg-accent text-accent-ink hover:bg-accent-strong rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                        Create
                    </button>
                </form>
            )}

            {projects.isError && <p className="text-danger-fg text-sm">{errorMessage(projects.error)}</p>}

            {list.length > 0 ? (
                <ul
                    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    data-testid="project-list"
                >
                    {list.map((project) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            trashed={trashed}
                            onChanged={refresh}
                        />
                    ))}
                </ul>
            ) : (
                projects.isSuccess && (
                    <div className="border-fg/8 rounded-lg border border-dashed px-4 py-12 text-center">
                        <p className="text-muted">{trashed ? 'The trash is empty.' : 'No projects yet.'}</p>
                        {!trashed && (
                            <p className="text-faint mt-1 text-sm">
                                Name one above,{' '}
                                <Link to="/templates" className="text-accent">
                                    start from a template
                                </Link>
                                , or see{' '}
                                <Link
                                    to="/help/$slug"
                                    params={{ slug: 'getting-started' }}
                                    className="text-accent"
                                >
                                    getting started
                                </Link>
                                .
                            </p>
                        )}
                    </div>
                )
            )}

            {!trashed && (
                <p className="mt-8 text-right text-sm">
                    <Link to="/trash" className="text-faint hover:text-muted">
                        Trash
                    </Link>
                </p>
            )}
        </>
    );
}

function ProjectCard({
    project,
    trashed,
    onChanged,
}: {
    project: ProjectSummary;
    trashed: boolean;
    onChanged: () => void;
}) {
    const toast = useToast();
    const [renaming, setRenaming] = useState(false);
    const [draftName, setDraftName] = useState(project.name);
    const thumb = thumbnailUrl(project);

    async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
        try {
            await action();
            onChanged();
            if (done) toast.success(done);
        } catch (e) {
            toast.error(errorMessage(e));
        }
    }

    async function exportFile(): Promise<void> {
        const path = await chooseSavePath(`${fileStem(project.name)}.woodshop`, WOODSHOP_FILTER);
        if (path !== null) await run(() => api.exportProjectFile(project.id, path), 'Project file saved.');
    }

    async function deleteForever(): Promise<void> {
        const ok = await ask(
            `Delete “${project.name}” permanently? Its versions and notes go too. This can't be undone.`,
            {
                title: 'Delete project',
                kind: 'warning',
                okLabel: 'Delete forever',
            },
        );
        if (ok) await run(() => api.deleteProjectForever(project.id));
    }

    function commitRename(): void {
        setRenaming(false);
        if (draftName.trim() !== '' && draftName.trim() !== project.name) {
            void run(() => api.renameProject(project.id, draftName.trim()));
        } else {
            setDraftName(project.name);
        }
    }

    const card = (
        <div className="bg-surface-0 border-fg/8 flex aspect-[16/10] items-center justify-center overflow-hidden border-b">
            {thumb ? (
                <img src={thumb} alt="" className="h-full w-full object-cover" data-testid="project-thumb" />
            ) : (
                <span className="text-faint text-3xl">▢</span>
            )}
        </div>
    );

    return (
        <li
            className="border-fg/8 bg-surface-1 group flex flex-col overflow-hidden rounded-xl border"
            data-testid="project-row"
        >
            {trashed ? (
                card
            ) : (
                <Link to="/projects/$id" params={{ id: String(project.id) }} data-testid="open-project">
                    {card}
                </Link>
            )}
            <div className="flex flex-1 flex-col gap-2 p-3">
                {renaming ? (
                    <input
                        autoFocus
                        value={draftName}
                        maxLength={120}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') {
                                setDraftName(project.name);
                                setRenaming(false);
                            }
                        }}
                        className="border-accent bg-surface-0 rounded border px-2 py-1 text-sm focus:outline-none"
                    />
                ) : (
                    <span className="truncate font-medium" title={project.name}>
                        {project.name}
                    </span>
                )}
                <span className="text-faint text-xs">
                    {plural(project.partCount, 'part')} ·{' '}
                    {trashed && project.deletedAt
                        ? `deleted ${timeAgo(project.deletedAt)}`
                        : `edited ${timeAgo(project.updatedAt)}`}
                </span>
                <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-sm">
                    {trashed ? (
                        <>
                            <button
                                className="text-accent hover:text-accent-strong"
                                onClick={() => run(() => api.restoreProject(project.id))}
                            >
                                Restore
                            </button>
                            <button className="text-muted hover:text-danger-fg" onClick={deleteForever}>
                                Delete forever
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                className="text-muted hover:text-fg-strong"
                                onClick={() => setRenaming(true)}
                            >
                                Rename
                            </button>
                            <button
                                className="text-muted hover:text-fg-strong"
                                onClick={() => run(() => api.duplicateProject(project.id))}
                            >
                                Duplicate
                            </button>
                            <button className="text-muted hover:text-fg-strong" onClick={exportFile}>
                                Export…
                            </button>
                            <button
                                className="text-muted hover:text-danger-fg ml-auto"
                                onClick={() =>
                                    run(
                                        () => api.trashProject(project.id),
                                        `Moved “${project.name}” to the trash.`,
                                    )
                                }
                            >
                                Delete
                            </button>
                        </>
                    )}
                </div>
            </div>
        </li>
    );
}
