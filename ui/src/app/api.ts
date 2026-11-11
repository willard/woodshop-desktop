/**
 * Typed wrappers over the Tauri commands in `src-tauri/src/commands.rs`. One function per command;
 * argument names match the Rust parameters (Tauri converts camelCase ↔ snake_case).
 *
 * Every command rejects with a `CommandError` — switch on `kind`; `message` is fit to show.
 */
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Spec } from '@/spec';
import { getUnits } from '@/lib/display';

export type CommandError =
    | { kind: 'notFound'; message: string }
    | { kind: 'conflict'; message: string; draft: Spec; draftUpdatedAt: number }
    | { kind: 'invalid'; message: string; issues: string[] }
    | { kind: 'io'; message: string }
    | { kind: 'internal'; message: string };

export function isCommandError(e: unknown): e is CommandError {
    return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e;
}

/** A message for any rejection, command error or not. */
export function errorMessage(e: unknown): string {
    if (isCommandError(e)) {
        return e.message;
    }
    return e instanceof Error ? e.message : String(e);
}

export interface LibraryInfo {
    dataDir: string;
    thumbnailsDir: string;
    version: string;
    logDir: string | null;
}

export interface ProjectSummary {
    id: number;
    name: string;
    partCount: number;
    updatedAt: number;
    createdAt: number;
    thumbnailAt: number | null;
    deletedAt: number | null;
}

export interface Project {
    id: number;
    name: string;
    draft: Spec;
    draftUpdatedAt: number;
    createdAt: number;
    thumbnailAt: number | null;
    deletedAt: number | null;
}

export interface TemplateSummary {
    id: string;
    name: string;
    difficulty: 'beginner' | 'intermediate' | 'advanced' | null;
    notes: string | null;
    tags: string[];
    partCount: number;
}

export type Author = 'user' | 'mcp';

export interface VersionSummary {
    id: number;
    projectId: number;
    label: string | null;
    createdBy: Author;
    createdAt: number;
}

export interface Note {
    id: number;
    projectId: number;
    body: string;
    pinned: boolean;
    createdAt: number;
    updatedAt: number;
}

export type Settings = Record<string, unknown>;

export interface McpSetup {
    command: string;
    args: string[];
    claudeDesktopConfig: string;
    claudeCodeCommand: string;
}

export const api = {
    libraryInfo: () => invoke<LibraryInfo>('library_info'),
    logClientError: (message: string, detail?: string) =>
        invoke<void>('log_client_error', { message, detail: detail ?? null }),
    takePendingOpens: () => invoke<string[]>('take_pending_opens'),

    listProjects: (trashed = false) => invoke<ProjectSummary[]>('list_projects', { trashed }),
    listTemplates: () => invoke<TemplateSummary[]>('list_templates'),
    createProject: (name: string, template?: string) =>
        invoke<Project>('create_project', {
            name,
            template: template ?? null,
            metric: getUnits() === 'metric',
        }),
    getProject: (id: number) => invoke<Project>('get_project', { id }),
    renameProject: (id: number, name: string) => invoke<void>('rename_project', { id, name }),
    trashProject: (id: number) => invoke<void>('trash_project', { id }),
    restoreProject: (id: number) => invoke<void>('restore_project', { id }),
    deleteProjectForever: (id: number) => invoke<void>('delete_project_forever', { id }),
    duplicateProject: (id: number) => invoke<Project>('duplicate_project', { id }),
    /** Resolves to the new draft stamp; rejects `conflict` when `baseUpdatedAt` is stale. */
    saveDraft: (id: number, spec: Spec, baseUpdatedAt: number | null) =>
        invoke<number>('save_draft', { id, spec, baseUpdatedAt }),

    listVersions: (id: number) => invoke<VersionSummary[]>('list_versions', { id }),
    createVersion: (id: number, spec: Spec, label: string | null) =>
        invoke<{ version: VersionSummary; draftUpdatedAt: number }>('create_version', { id, spec, label }),
    restoreVersion: (id: number, versionId: number) =>
        invoke<{ spec: Spec; draftUpdatedAt: number }>('restore_version', { id, versionId }),

    listNotes: (id: number) => invoke<Note[]>('list_notes', { id }),
    createNote: (id: number, body: string) => invoke<Note>('create_note', { id, body }),
    updateNote: (noteId: number, patch: { body?: string; pinned?: boolean }) =>
        invoke<Note>('update_note', { noteId, body: patch.body ?? null, pinned: patch.pinned ?? null }),
    deleteNote: (noteId: number) => invoke<void>('delete_note', { noteId }),

    getSettings: () => invoke<Settings>('get_settings'),
    setSetting: (key: string, value: unknown) => invoke<void>('set_setting', { key, value }),

    /** PNG bytes go as the raw request body, not a JSON array of numbers. */
    saveThumbnail: async (id: number, png: Blob) =>
        invoke<number>('save_thumbnail', new Uint8Array(await png.arrayBuffer()), {
            headers: { 'x-project-id': String(id) },
        }),

    exportProjectFile: (id: number, path: string) => invoke<void>('export_project_file', { id, path }),
    importProjectFile: (path: string) => invoke<Project>('import_project_file', { path }),
    importSpecJson: (path: string) => invoke<Project>('import_spec_json', { path }),
    /** A project from a spec built in the editor (e.g. "New project from group"). */
    createProjectFromSpec: (name: string, spec: Spec) =>
        invoke<Project>('create_project_from_spec', { name, spec }),
    writeTextFile: (path: string, contents: string) =>
        invoke<void>('write_text_file', { file: { path, contents } }),
    mcpSetup: () => invoke<McpSetup>('mcp_setup'),
    exportPdf: (id: number, path: string, kerf: number) =>
        invoke<void>('export_pdf', {
            id,
            path,
            kerf,
            // Rust has no locale; the plan's date is formatted for the reader here.
            date: new Date().toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            }),
            units: getUnits(),
        }),
    exportViewer: (id: number, path: string, kerf: number) =>
        invoke<void>('export_viewer', {
            id,
            path,
            kerf,
            theme: document.documentElement.dataset.theme ?? 'dark',
            exportedAt: new Date().toISOString(),
            units: getUnits(),
        }),
};

let thumbnailsDir: string | null = null;

/** Remember where thumbnails live (from `libraryInfo`) so rows can build image URLs. */
export function setThumbnailsDir(dir: string): void {
    thumbnailsDir = dir;
}

/** A webview URL for a project's thumbnail, cache-busted by when it was written. */
export function thumbnailUrl(project: { id: number; thumbnailAt: number | null }): string | null {
    if (project.thumbnailAt === null || thumbnailsDir === null) {
        return null;
    }
    const sep = thumbnailsDir.includes('\\') ? '\\' : '/';
    return `${convertFileSrc(`${thumbnailsDir}${sep}${project.id}.png`)}?v=${project.thumbnailAt}`;
}
