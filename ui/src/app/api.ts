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

/** System errors people actually meet, in words that say what to do about them. */
const PLAIN_REASONS: [RegExp, string][] = [
    [
        /os error 13\b|permission denied|not permitted/i,
        "Woodshop isn't allowed to use that location. Pick a folder of your own, such as Documents.",
    ],
    [
        /os error 2\b|no such file|cannot find the (file|path)/i,
        "The file isn't there any more. It may have been moved or renamed.",
    ],
    [/os error (28|112)\b|no space left|disk is full/i, 'The disk is full. Free some space and try again.'],
    [/os error 30\b|read-only file system/i, 'That location is read-only. Pick another folder.'],
    [/database is locked|database is busy/i, 'The library is busy with another task. Try again in a moment.'],
];

/**
 * What a person reads when something fails: "Couldn't <action>." and then why, in plain words,
 * with a next step. A raw system message is only shown when nothing better is known, and an
 * unexpected failure points at the problem report.
 */
export function failure(action: string, e: unknown): string {
    const raw = errorMessage(e).trim();
    const known = PLAIN_REASONS.find(([pattern]) => pattern.test(raw));
    let reason: string;
    if (known) {
        reason = known[1];
    } else if (isCommandError(e) && e.kind === 'internal') {
        reason = `${sentence(raw)} If this keeps happening, use Report a problem in Settings, Diagnostics.`;
    } else if (raw === '') {
        reason = 'Try again.';
    } else {
        reason = sentence(raw);
    }
    return `Couldn't ${action}. ${reason}`;
}

function sentence(text: string): string {
    const first = text.charAt(0).toUpperCase() + text.slice(1);
    return /[.!?]$/.test(first) ? first : `${first}.`;
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
    /** One or two sentences for someone choosing a design. */
    summary: string | null;
    /** The design's build notes (`meta.notes`). */
    notes: string | null;
    tags: string[];
    partCount: number;
    /** Finished size in inches. */
    overall: { width: number; depth: number; height: number } | null;
    sheetCount: number;
    boardFeet: number;
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

/** One automatic (or manual) copy of the library. */
export interface BackupInfo {
    file: string;
    createdAt: number;
    bytes: number;
}

export interface McpSetup {
    command: string;
    args: string[];
    claudeDesktopConfig: string;
    claudeCodeCommand: string;
}

/** The design assistant (`src-tauri/src/assistant.rs`). */
export type AssistantProvider = 'anthropic' | 'openai';

/** What Settings ▸ AI agents stores as the `assistant` setting. The API key is in the keychain. */
export interface AssistantSetting {
    provider?: AssistantProvider;
    anthropicModel?: string;
    openaiModel?: string;
    openaiBaseUrl?: string;
}

export interface AssistantAction {
    tool: string;
    ok: boolean;
    error?: string;
}

export interface AssistantTurn {
    reply: string;
    actions: AssistantAction[];
    /** The conversation in the provider's own format; sent back with the next message. */
    history: unknown[];
    changed: boolean;
    /** The version that undoes this turn's changes; only there when something changed. */
    restorePoint?: number;
}

/** Progress while a turn runs, sent as the `assistant-event` event. */
export type AssistantEvent =
    | { kind: 'text'; delta: string }
    | { kind: 'tool'; name: string }
    | { kind: 'toolDone'; name: string; ok: boolean; message: string | null };

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
    /** Which providers have an API key in the keychain (the keys never come back). */
    assistantKeys: () => invoke<Record<AssistantProvider, boolean>>('assistant_keys'),
    /** Saves a provider's key in the keychain, or removes it when `key` is null. */
    assistantSetKey: (provider: AssistantProvider, key: string | null) =>
        invoke<void>('assistant_set_key', { provider, key }),
    /** The assistant chat the panel saved for a project, or null. */
    getAssistantChat: (id: number) => invoke<unknown>('get_assistant_chat', { id }),
    /** Keeps a project's assistant chat; null forgets it. */
    setAssistantChat: (id: number, chat: unknown) => invoke<void>('set_assistant_chat', { id, chat }),
    /** Asks the running turn to stop; it finishes the step it is on and returns. */
    assistantStop: () => invoke<void>('assistant_stop'),
    /** `image` is a picture of the 3D view to go with the message: a JPEG, base64. */
    assistantSend: (projectId: number, history: unknown[], text: string, image: string | null = null) =>
        invoke<AssistantTurn>('assistant_send', { projectId, history, text, image }),

    listBackups: () => invoke<BackupInfo[]>('list_backups'),
    backupNow: () => invoke<BackupInfo>('backup_now'),
    backupProjects: (file: string) => invoke<ProjectSummary[]>('backup_projects', { file }),
    /** Copies one project out of a backup into the library as a new project. */
    restoreFromBackup: (file: string, projectId: number) =>
        invoke<Project>('restore_from_backup', { file, projectId }),
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
    /** One label per piece to cut, on a sheet of sticky labels (Letter, or A4 in millimetres). */
    exportLabels: (id: number, path: string, kerf: number) =>
        invoke<void>('export_labels', { id, path, kerf, units: getUnits() }),
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
