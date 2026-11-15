/**
 * Loading a project into the editor. The router fetches it while it navigates (so the project
 * list stays on screen until the editor can draw) and the editor reads the same cache entry.
 */
import { api, type Project } from './api';
import { queryClient } from './queryClient';

/**
 * The last save of an editor that has just closed, per project. Reopening the project waits for
 * it, so the editor never loads a draft older than the edits it was just showing.
 */
const closingSaves = new Map<number, Promise<void>>();

export function projectQuery(id: number) {
    return {
        queryKey: ['project', id] as const,
        queryFn: async (): Promise<Project> => {
            await closingSaves.get(id);
            return api.getProject(id);
        },
        // Fetched once per visit: while open, the editor owns the design and the autosave keeps
        // the store in step. `closeProject` drops the entry when the editor closes, because it
        // holds the draft as it was on opening, and reopening from it would show (and then try
        // to save) that.
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    };
}

/**
 * Reads a project about to open, always from the store (an earlier read may be out of date).
 * Errors surface in the editor, not here.
 */
export async function prefetchProject(id: number): Promise<void> {
    await queryClient.prefetchQuery({ ...projectQuery(id), staleTime: 0 });
}

/** The editor for `id` is closing with `lastSave` still in flight. */
export function closeProject(id: number, lastSave: Promise<void>): void {
    closingSaves.set(id, lastSave);
    void lastSave.then(() => {
        if (closingSaves.get(id) === lastSave) closingSaves.delete(id);
    });
    queryClient.removeQueries({ queryKey: ['project', id], exact: true });
}
