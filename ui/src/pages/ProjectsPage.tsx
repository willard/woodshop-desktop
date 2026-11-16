/** The project library: every design on this computer, newest first. */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ask } from '@tauri-apps/plugin-dialog';
import { api, errorMessage, thumbnailUrl, type ProjectSummary } from '@/app/api';
import { importProjectFromDialog, chooseSavePath, fileStem, WOODSHOP_FILTER } from '@/app/files';
import { plural, timeAgo } from '@/app/format';
import { useToast } from '@/components/Toast';
import { Popover } from '@/components/Popover';
import { BlankThumbnail } from '@/components/BlankThumbnail';
import { openSampleWithTour } from '@/app/tour';
import { preloadEditor } from '@/app/pages';

/** More projects than this, and the list gets a search box and a sort. */
const SEARCH_FROM = 12;

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

    const all = projects.data ?? [];
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<'recent' | 'name'>('recent');
    // Search and sort earn their place once the library is longer than a screenful.
    const many = all.length > SEARCH_FROM;
    const needle = query.trim().toLowerCase();
    const list = many
        ? all
              .filter((p) => needle === '' || p.name.toLowerCase().includes(needle))
              .sort((a, b) =>
                  sort === 'name'
                      ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
                      : b.updatedAt - a.updatedAt,
              )
        : all;

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

            {many && (
                <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="project-tools">
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${all.length} projects`}
                        aria-label="Search projects"
                        className="border-fg/12 bg-surface-1 focus:border-accent w-64 rounded-md border px-3 py-1.5 text-sm focus:outline-none"
                        data-testid="project-search"
                    />
                    <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as 'recent' | 'name')}
                        aria-label="Sort projects"
                        className="border-fg/12 bg-surface-1 rounded-md border px-2 py-1.5 text-sm"
                        data-testid="project-sort"
                    >
                        <option value="recent">Recently edited</option>
                        <option value="name">Name</option>
                    </select>
                    {needle !== '' && (
                        <span className="text-faint text-sm">
                            {list.length === 0 ? 'No project matches.' : plural(list.length, 'project')}
                        </span>
                    )}
                </div>
            )}

            {list.length > 0 ? (
                <ul
                    className="grid [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))] gap-4"
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
                projects.isSuccess &&
                (many ? null : trashed ? (
                    <div className="border-fg/8 rounded-lg border border-dashed px-4 py-12 text-center">
                        <p className="text-muted">The trash is empty.</p>
                    </div>
                ) : (
                    <Welcome />
                ))
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

    const thumbnail = (
        <div className="bg-surface-2 border-fg/8 flex aspect-[16/10] items-center justify-center overflow-hidden border-b">
            {thumb ? (
                <img src={thumb} alt="" className="h-full w-full object-cover" data-testid="project-thumb" />
            ) : (
                <BlankThumbnail />
            )}
        </div>
    );
    const meta = (
        <span className="text-faint text-xs">
            {plural(project.partCount, 'part')} ·{' '}
            {trashed && project.deletedAt
                ? `deleted ${timeAgo(project.deletedAt)}`
                : `edited ${timeAgo(project.updatedAt)}`}
        </span>
    );

    if (trashed) {
        return (
            <li
                className="border-fg/8 bg-surface-1 flex flex-col overflow-hidden rounded-xl border"
                data-testid="project-row"
            >
                {thumbnail}
                <div className="flex flex-1 flex-col gap-1 p-3">
                    <span className="truncate font-medium" title={project.name}>
                        {project.name}
                    </span>
                    {meta}
                    <div className="mt-auto flex gap-3 pt-2 text-sm">
                        <button
                            className="text-accent hover:text-accent-strong"
                            onClick={() => run(() => api.restoreProject(project.id))}
                        >
                            Restore
                        </button>
                        <button className="text-muted hover:text-danger-fg ml-auto" onClick={deleteForever}>
                            Delete forever
                        </button>
                    </div>
                </div>
            </li>
        );
    }

    const item = 'hover:bg-fg/[0.07] rounded-md px-2.5 py-2 text-left text-[13px]';
    return (
        <li
            className="border-fg/8 bg-surface-1 hover:border-fg/20 focus-within:border-accent/60 relative flex flex-col overflow-hidden rounded-xl border transition-colors"
            data-testid="project-row"
        >
            {renaming ? (
                <>
                    {thumbnail}
                    <div className="flex flex-col gap-1 p-3">
                        <input
                            autoFocus
                            value={draftName}
                            maxLength={120}
                            aria-label="Project name"
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
                            data-testid="rename-input"
                        />
                        {meta}
                    </div>
                </>
            ) : (
                // The whole card opens the project; its actions live in the ⋯ menu beside the name.
                <Link
                    to="/projects/$id"
                    params={{ id: String(project.id) }}
                    data-testid="open-project"
                    onMouseEnter={preloadEditor}
                    onFocus={preloadEditor}
                    className="flex flex-col focus:outline-none"
                >
                    {thumbnail}
                    <div className="flex flex-col gap-1 p-3 pr-11">
                        <span className="truncate font-medium" title={project.name}>
                            {project.name}
                        </span>
                        {meta}
                    </div>
                </Link>
            )}
            {!renaming && (
                <div className="absolute right-2 bottom-3">
                    <Popover
                        testId="project-menu"
                        panelClassName="flex w-48 flex-col gap-px p-1.5"
                        trigger={({ open, toggle }) => (
                            <button
                                className={`text-muted hover:bg-fg/[0.07] hover:text-fg-strong flex h-8 w-8 items-center justify-center rounded-lg ${open ? 'bg-fg/[0.07]' : ''}`}
                                aria-label={`Actions for ${project.name}`}
                                aria-expanded={open}
                                title="Rename, duplicate, export or delete"
                                onClick={toggle}
                                data-testid="project-menu-toggle"
                            >
                                <svg
                                    width="15"
                                    height="15"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    aria-hidden="true"
                                >
                                    <circle cx="5" cy="12" r="1.6" fill="currentColor" />
                                    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                                    <circle cx="19" cy="12" r="1.6" fill="currentColor" />
                                </svg>
                            </button>
                        )}
                    >
                        {(close) => (
                            <>
                                <button
                                    className={item}
                                    onClick={() => {
                                        close();
                                        setRenaming(true);
                                    }}
                                >
                                    Rename
                                </button>
                                <button
                                    className={item}
                                    onClick={() => {
                                        close();
                                        void run(() => api.duplicateProject(project.id), 'Duplicated.');
                                    }}
                                >
                                    Duplicate
                                </button>
                                <button
                                    className={item}
                                    onClick={() => {
                                        close();
                                        void exportFile();
                                    }}
                                >
                                    Save project file…
                                </button>
                                <div className="bg-fg/[0.08] my-1 h-px" />
                                <button
                                    className={`${item} text-danger-fg hover:bg-danger/10`}
                                    onClick={() => {
                                        close();
                                        void run(
                                            () => api.trashProject(project.id),
                                            `Moved “${project.name}” to the trash.`,
                                        );
                                    }}
                                    data-testid="project-trash"
                                >
                                    Move to trash
                                </button>
                            </>
                        )}
                    </Popover>
                </div>
            )}
        </li>
    );
}

/** An empty library: the sample and its tour first, then the other ways in. */
function Welcome() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const toast = useToast();
    const sample = useMutation({
        mutationFn: () => openSampleWithTour(queryClient),
        onSuccess: (project) => navigate({ to: '/projects/$id', params: { id: String(project.id) } }),
        onError: (e) => toast.error(errorMessage(e)),
    });
    return (
        <div
            className="border-fg/10 bg-surface-1/50 rounded-xl border px-6 py-10 text-center"
            data-testid="welcome"
        >
            <h2 className="text-fg-strong mb-1 text-lg font-semibold">Welcome to Woodshop</h2>
            <p className="text-muted mx-auto mb-6 max-w-md text-sm">
                Design furniture in 3D and get a cut list, a printable plan and the hardware to buy. The
                quickest way in is the sample nightstand and a two-minute tour of the editor.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                    type="button"
                    onClick={() => sample.mutate()}
                    disabled={sample.isPending}
                    className="bg-accent text-accent-ink hover:bg-accent-strong rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                    data-testid="open-sample"
                >
                    Open the sample and take the tour
                </button>
                <Link
                    to="/templates"
                    className="border-fg/12 text-accent hover:bg-surface-2 rounded-md border px-4 py-2 text-sm"
                >
                    Browse templates
                </Link>
            </div>
            <p className="text-faint mt-5 text-sm">
                Or name a new project above, or read{' '}
                <Link to="/help/$slug" params={{ slug: 'getting-started' }} className="text-accent">
                    getting started
                </Link>
                .
            </p>
        </div>
    );
}
