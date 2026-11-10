/**
 * A project open in the editor. Owns persistence around the workspace: debounced autosave with
 * the optimistic-concurrency guard, version history, notes, thumbnails, exports, and picking up
 * edits an MCP agent made to this project while it was open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api, errorMessage, isCommandError, type Project } from '@/app/api';
import { chooseSavePath, fileStem, WOODSHOP_FILTER } from '@/app/files';
import { EditorDocument } from '@/engine';
import { extractParts } from '@/engine/extract';
import { parseSpec, type Spec } from '@/spec';
import { EditorWorkspace, type EditorWorkspaceHandle } from '@/components/EditorWorkspace';
import { NotesPanel } from '@/components/NotesPanel';
import { VersionsPanel } from '@/components/VersionsPanel';
import { CutListExportButtons, ExportMenuItems } from '@/components/ExportMenu';
import { useToast } from '@/components/Toast';
import { useDefaultKerf } from '@/app/settings';

export default function EditorPage() {
    const { id } = useParams({ strict: false }) as { id: string };
    const projectId = Number(id);
    const project = useQuery({
        queryKey: ['project', projectId],
        queryFn: () => api.getProject(projectId),
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    });

    if (project.isError) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3">
                <p className="text-danger-fg text-sm">{errorMessage(project.error)}</p>
                <Link to="/" className="text-accent text-sm">
                    ← Back to projects
                </Link>
            </div>
        );
    }
    if (!project.data) {
        return <div className="text-faint flex h-full items-center justify-center text-sm">Opening…</div>;
    }
    return <Editor key={project.data.id} project={project.data} />;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const SAVE_LABEL: Record<SaveState, string> = {
    idle: 'All changes saved',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
    conflict: 'Changed elsewhere',
};

/** Autosave settles this long after the last edit. Local disk, so it can be short. */
const SAVE_DEBOUNCE_MS = 800;
const THUMBNAIL_INTERVAL_MS = 15_000;

function Editor({ project }: { project: Project }) {
    const toast = useToast();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [doc, setDoc] = useState(() => new EditorDocument(project.draft));
    const docRef = useRef(doc);
    docRef.current = doc;
    const workspace = useRef<EditorWorkspaceHandle>(null);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [conflict, setConflict] = useState<{
        draft: Spec;
        updatedAt: number;
    } | null>(null);
    const conflictRef = useRef(conflict);
    conflictRef.current = conflict;
    const [showVersions, setShowVersions] = useState(false);
    const defaultKerf = useDefaultKerf();
    const [kerf, setKerf] = useState<number | null>(null);
    const [name, setName] = useState(project.name);

    // The draft stamp our on-screen edits are based on (the conflict guard's base).
    const base = useRef<number>(project.draftUpdatedAt);
    // Bumped on every document change; a save compares it on the way back so edits made
    // mid-flight are never treated as already saved.
    const revision = useRef(0);
    const savedRevision = useRef(0);
    const timer = useRef<number | undefined>(undefined);
    const running = useRef<Promise<void> | null>(null);
    const pending = useRef(false);
    const lastThumbnail = useRef(0);

    const maybeThumbnail = useCallback(async () => {
        const now = Date.now();
        if (now - lastThumbnail.current < THUMBNAIL_INTERVAL_MS) return;
        lastThumbnail.current = now;
        try {
            const blob = await workspace.current?.snapshot();
            if (blob) {
                await api.saveThumbnail(project.id, blob);
                void queryClient.invalidateQueries({ queryKey: ['projects'] });
            }
        } catch {
            // A thumbnail is cosmetic — never surface its failure.
        }
    }, [project.id, queryClient]);

    const writeDraft = useCallback(async () => {
        if (conflictRef.current !== null) return; // blocked until the user resolves it
        const sent = revision.current;
        try {
            base.current = await api.saveDraft(project.id, docRef.current.spec, base.current);
            if (revision.current === sent) {
                savedRevision.current = sent;
                setSaveState('saved');
            }
            void maybeThumbnail();
        } catch (e) {
            if (isCommandError(e) && e.kind === 'conflict') {
                setConflict({ draft: e.draft, updatedAt: e.draftUpdatedAt });
                setSaveState('conflict');
            } else {
                setSaveState('error');
                toast.error(`Couldn't save: ${errorMessage(e)}`);
            }
            pending.current = false;
        }
    }, [project.id, maybeThumbnail, toast]);

    /** Saves until the store holds the newest revision; concurrent callers join the run. */
    const save = useCallback((): Promise<void> => {
        if (running.current !== null) {
            pending.current = true;
            return running.current;
        }
        running.current = (async () => {
            try {
                do {
                    pending.current = false;
                    await writeDraft();
                } while (pending.current && conflictRef.current === null);
            } finally {
                running.current = null;
            }
        })();
        return running.current;
    }, [writeDraft]);

    const flush = useCallback((): Promise<void> => {
        window.clearTimeout(timer.current);
        return revision.current === savedRevision.current ? (running.current ?? Promise.resolve()) : save();
    }, [save]);

    // Autosave: every spec change schedules a save. Selection changes notify too, but leave the
    // spec object alone, so they write nothing.
    useEffect(() => {
        let lastSpec = doc.spec;
        return doc.subscribe(() => {
            if (doc.spec === lastSpec) return;
            lastSpec = doc.spec;
            revision.current += 1;
            if (conflictRef.current === null) setSaveState('saving');
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
        });
    }, [doc, save]);

    // Never lose the last edit: flush on leaving the editor and before the window closes.
    useEffect(() => {
        const unlisten = getCurrentWindow().onCloseRequested(async () => {
            await flush();
        });
        return () => {
            void flush();
            void unlisten.then((fn) => fn());
        };
    }, [flush]);

    /** Replaces the document; the new spec is already what the store holds. */
    const swapDoc = useCallback((spec: Spec, stamp: number) => {
        window.clearTimeout(timer.current);
        revision.current += 1;
        savedRevision.current = revision.current;
        base.current = stamp;
        setDoc(new EditorDocument(parseSpec(spec)));
        setSaveState('saved');
    }, []);

    // An MCP agent (or another window) edited this project: take it if we have nothing unsaved,
    // otherwise let the user choose.
    useEffect(() => {
        async function onLibraryChanged(): Promise<void> {
            let latest: Project;
            try {
                latest = await api.getProject(project.id);
            } catch {
                return;
            }
            setName(latest.name);
            if (latest.draftUpdatedAt === base.current || running.current !== null) return;
            if (revision.current === savedRevision.current && conflictRef.current === null) {
                swapDoc(latest.draft, latest.draftUpdatedAt);
                toast.info('This design was updated outside the editor.');
            } else {
                setConflict({ draft: latest.draft, updatedAt: latest.draftUpdatedAt });
                setSaveState('conflict');
            }
        }
        const handler = () => void onLibraryChanged();
        window.addEventListener('woodshop:library-changed', handler);
        return () => window.removeEventListener('woodshop:library-changed', handler);
    }, [project.id, swapDoc, toast]);

    function keepMine(): void {
        if (conflict === null) return;
        base.current = conflict.updatedAt; // overwrite the other version
        setConflict(null);
        conflictRef.current = null;
        setSaveState('saving');
        void save();
    }

    function takeTheirs(): void {
        if (conflict === null) return;
        swapDoc(conflict.draft, conflict.updatedAt);
        setConflict(null);
    }

    /** "New project from group": the parts become a design of their own, opened straight away. */
    async function newProjectFromParts(partIds: readonly string[], partName: string): Promise<void> {
        try {
            const spec = extractParts(docRef.current.spec, partIds, partName);
            const created = await api.createProjectFromSpec(spec.name, spec);
            void queryClient.invalidateQueries({ queryKey: ['projects'] });
            toast.success(`Created “${created.name}” from ${partIds.length} parts of “${name}”.`);
            void navigate({ to: '/projects/$id', params: { id: String(created.id) } });
        } catch (e) {
            toast.error(errorMessage(e));
        }
    }

    async function exportProjectFile(): Promise<void> {
        await flush();
        const path = await chooseSavePath(`${fileStem(name)}.woodshop`, WOODSHOP_FILTER);
        if (path === null) return;
        try {
            await api.exportProjectFile(project.id, path);
            toast.success('Project file saved.');
        } catch (e) {
            toast.error(errorMessage(e));
        }
    }

    const toolbar = (
        <>
            <Link
                to="/"
                className="hover:text-fg-strong text-muted hover:bg-fg/5 flex h-7 w-7 flex-none items-center justify-center rounded-lg"
                title="Back to projects"
                onClick={() => void flush()}
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path
                        d="M19 12H5M11 6l-6 6 6 6"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </Link>
            <div className="flex min-w-0 flex-col px-1.5">
                <span className="truncate text-[13.5px] leading-tight font-semibold">{name}</span>
                <span
                    className={`text-[11.5px] leading-tight ${saveState === 'error' || saveState === 'conflict' ? 'text-danger-fg' : 'text-muted'}`}
                    data-testid="save-state"
                >
                    {SAVE_LABEL[saveState]}
                </span>
            </div>
            <button
                className="border-fg/10 text-fg/75 hover:bg-fg/5 h-[30px] flex-none rounded-lg border px-3 text-[12.5px]"
                data-testid="versions-toggle"
                onClick={() => setShowVersions(true)}
            >
                Versions
            </button>
        </>
    );

    return (
        <div className="bg-surface-0 text-fg-strong relative flex h-full w-full overflow-hidden">
            <EditorWorkspace
                ref={workspace}
                doc={doc}
                toolbar={toolbar}
                notes={<NotesPanel projectId={project.id} />}
                kerf={kerf ?? defaultKerf}
                onKerfChange={setKerf}
                onNewProjectFromParts={(ids, partName) => void newProjectFromParts(ids, partName)}
                cutListActions={(cutList, cutListKerf) => (
                    <CutListExportButtons
                        projectId={project.id}
                        projectName={name}
                        getSpec={() => docRef.current.spec}
                        kerf={cutListKerf}
                        flush={flush}
                        cutList={cutList}
                    />
                )}
                overflowExtra={(close) => (
                    <>
                        <div className="bg-fg/[0.08] my-1 h-px" />
                        <ExportMenuItems
                            projectId={project.id}
                            projectName={name}
                            getSpec={() => docRef.current.spec}
                            kerf={kerf ?? defaultKerf}
                            flush={flush}
                            close={close}
                        />
                        <button
                            className="enabled:hover:bg-fg/[0.07] rounded-md px-2.5 py-2 text-left text-[12.5px]"
                            onClick={() => {
                                close();
                                void exportProjectFile();
                            }}
                        >
                            Save project file (.woodshop)…
                        </button>
                    </>
                )}
            />

            {showVersions && (
                <VersionsPanel
                    projectId={project.id}
                    getSpec={() => docRef.current.spec}
                    beforeSave={() => window.clearTimeout(timer.current)}
                    onSaved={(stamp) => {
                        base.current = stamp;
                        savedRevision.current = revision.current;
                        setSaveState('saved');
                    }}
                    onRestored={(spec, stamp) => {
                        swapDoc(spec, stamp);
                        setShowVersions(false);
                    }}
                    onClose={() => setShowVersions(false)}
                />
            )}

            {conflict && (
                <div
                    className="bg-surface-0/70 absolute inset-0 z-50 flex items-center justify-center p-4"
                    data-testid="conflict-dialog"
                >
                    <div className="bg-surface-1 border-fg/10 w-full max-w-sm rounded-2xl border p-5">
                        <h2 className="text-danger-fg mb-2 text-base font-semibold">
                            This design changed elsewhere
                        </h2>
                        <p className="text-muted mb-4 text-sm">
                            It was edited outside this editor (for example by an AI agent over MCP) while you
                            had unsaved changes. Keep your version (overwriting the other), or take theirs
                            (discarding your changes since the last save)?
                        </p>
                        <div className="flex gap-2">
                            <button
                                className="bg-accent text-accent-ink flex-1 rounded-lg px-3 py-2 font-semibold"
                                onClick={keepMine}
                            >
                                Keep mine
                            </button>
                            <button
                                className="border-fg/10 flex-1 rounded-lg border px-3 py-2"
                                onClick={takeTheirs}
                            >
                                Take theirs
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
