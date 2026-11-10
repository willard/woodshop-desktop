/**
 * Shop notes: the maker's own reminders for a project. They live outside the spec, so a note
 * write never touches the draft, the autosave base, or the version history.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Note } from '@/app/api';
import { timeAgo } from '@/app/format';

export function NotesPanel({ projectId }: { projectId: number }) {
    const queryClient = useQueryClient();
    const key = ['notes', projectId];
    const notes = useQuery({ queryKey: key, queryFn: () => api.listNotes(projectId) });
    const [draft, setDraft] = useState('');
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editBody, setEditBody] = useState('');
    const [confirmingId, setConfirmingId] = useState<number | null>(null);
    const editBox = useRef<HTMLTextAreaElement>(null);

    // The composer keeps its text until the write lands — a note exists nowhere else.
    const write = useMutation({
        mutationFn: (work: () => Promise<unknown>) => work(),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    });
    const busy = write.isPending;

    useEffect(() => {
        if (editingId !== null) editBox.current?.focus();
    }, [editingId]);

    function add(): void {
        const body = draft.trim();
        if (body === '' || busy) return;
        write.mutate(() => api.createNote(projectId, body), {
            onSuccess: () => setDraft((d) => (d.trim() === body ? '' : d)),
        });
    }

    function saveEdit(id: number): void {
        const body = editBody.trim();
        if (body === '' || busy) return;
        write.mutate(() => api.updateNote(id, { body }), { onSuccess: () => setEditingId(null) });
    }

    function remove(id: number): void {
        // Asks once inline — there is no undo for a hand-typed note.
        if (confirmingId === id) {
            setConfirmingId(null);
            write.mutate(() => api.deleteNote(id));
        } else {
            setConfirmingId(id);
        }
    }

    const list: Note[] = notes.data ?? [];

    return (
        <section className="flex h-full min-h-0 w-full flex-col" data-testid="notes-panel">
            <div className="flex-none px-4 pt-3.5 pb-2">
                <h2 className="text-[15px] font-semibold">Shop notes</h2>
                <p className="text-muted text-[11px]">
                    Build steps, reminders, anything to remember for this project.
                </p>
            </div>
            <div className="flex-none space-y-2 px-3 pb-3">
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    placeholder="e.g. cut the legs oversize, trim after glue-up"
                    className="bg-surface-2 focus:border-accent border-fg/10 max-h-32 w-full resize-none rounded-lg border p-2 text-[13px] outline-none"
                    data-testid="note-input"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            add();
                        }
                    }}
                />
                <div className="flex items-center justify-between gap-2">
                    <span className="text-muted text-[11px]">⌘ / Ctrl + Enter to add</span>
                    <button
                        type="button"
                        className="bg-accent text-accent-ink hover:bg-accent-strong shrink-0 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-40"
                        disabled={busy || draft.trim() === ''}
                        data-testid="note-add"
                        onClick={add}
                    >
                        Add note
                    </button>
                </div>
                {write.isError && (
                    <p className="text-danger-fg text-xs" data-testid="note-error">
                        {errorMessage(write.error)}
                    </p>
                )}
            </div>
            <div className="border-fg/[0.07] flex flex-1 flex-col gap-2 overflow-y-auto border-t p-3">
                {list.length === 0 && notes.isSuccess && (
                    <p className="text-muted pt-6 text-center text-sm">
                        No notes yet. Jot down how you plan to build this, or what to pick up from the
                        lumberyard.
                    </p>
                )}
                {list.map((note) => (
                    <article
                        key={note.id}
                        className={`bg-surface-2 rounded-lg border p-2.5 ${note.pinned ? 'border-accent/40' : 'border-fg/[0.07]'}`}
                        data-testid="note-row"
                    >
                        {editingId === note.id ? (
                            <div className="space-y-2">
                                <textarea
                                    ref={editBox}
                                    value={editBody}
                                    onChange={(e) => setEditBody(e.target.value)}
                                    rows={3}
                                    className="bg-surface-1 focus:border-accent border-fg/10 w-full resize-none rounded-lg border p-2 text-[13px] outline-none"
                                    data-testid="note-edit-input"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                            e.preventDefault();
                                            saveEdit(note.id);
                                        }
                                        if (e.key === 'Escape') setEditingId(null);
                                    }}
                                />
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        className="border-fg/10 text-muted hover:bg-fg/5 rounded-lg border px-2.5 py-1 text-xs"
                                        data-testid="note-edit-cancel"
                                        onClick={() => setEditingId(null)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="bg-accent text-accent-ink rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
                                        disabled={busy || editBody.trim() === ''}
                                        data-testid="note-edit-save"
                                        onClick={() => saveEdit(note.id)}
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="text-[13px] leading-snug whitespace-pre-wrap">{note.body}</p>
                                <div className="mt-2 flex items-center gap-1.5">
                                    <span className="text-muted flex-1 truncate text-[11px]">
                                        {timeAgo(note.updatedAt)}
                                    </span>
                                    <button
                                        type="button"
                                        className={`rounded-md px-1.5 py-0.5 text-xs ${note.pinned ? 'text-accent' : 'text-muted hover:text-fg/70'}`}
                                        title={note.pinned ? 'Unpin' : 'Pin to the top'}
                                        disabled={busy}
                                        data-testid="note-pin"
                                        onClick={() =>
                                            write.mutate(() =>
                                                api.updateNote(note.id, { pinned: !note.pinned }),
                                            )
                                        }
                                    >
                                        {note.pinned ? 'Pinned' : 'Pin'}
                                    </button>
                                    <button
                                        type="button"
                                        className="text-muted hover:text-fg/70 rounded-md px-1.5 py-0.5 text-xs"
                                        disabled={busy}
                                        data-testid="note-edit"
                                        onClick={() => {
                                            setEditingId(note.id);
                                            setEditBody(note.body);
                                            setConfirmingId(null);
                                        }}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        className={`rounded-md px-1.5 py-0.5 text-xs ${confirmingId === note.id ? 'text-danger-fg' : 'text-muted hover:text-danger-fg'}`}
                                        disabled={busy}
                                        data-testid="note-delete"
                                        onClick={() => remove(note.id)}
                                    >
                                        {confirmingId === note.id ? 'Sure?' : 'Delete'}
                                    </button>
                                </div>
                            </>
                        )}
                    </article>
                ))}
            </div>
        </section>
    );
}
