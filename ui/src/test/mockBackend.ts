/**
 * An in-memory stand-in for the Rust commands, installed only when the UI runs in a plain browser
 * (Vite dev server, Playwright). It mirrors the command contract in `src-tauri/src/commands.rs`
 * closely enough to drive every screen; the real persistence rules live in `woodshop-store`.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { wasm } from '@/domain';
import type { Note, Project, ProjectSummary, TemplateSummary, VersionSummary } from '@/app/api';
import type { Spec } from '@/spec';
import { overallSize } from '@/spec/geometry';
import { computeCutList } from '@/cutlist';
import gallery from '../../../resources/template-gallery.json';

const templateFiles = import.meta.glob('../../../resources/templates/*.json', {
    eager: true,
    import: 'default',
}) as Record<string, unknown>;

interface Row {
    project: Project;
    versions: (VersionSummary & { spec: Spec })[];
    notes: Note[];
}

export function installMockBackend(): void {
    const rows = new Map<number, Row>();
    const settings: Record<string, unknown> = {};
    const keychain = new Set<string>();
    let stopAssistant: (() => void) | null = null;
    const chats = new Map<number, unknown>();
    const backups: { file: string; createdAt: number; bytes: number; projects: Row[] }[] = [];
    let nextId = 1;
    let clock = Date.now();
    const now = () => (clock = Math.max(clock + 1, Date.now()));

    const templates: (TemplateSummary & { spec: Spec })[] = Object.entries(templateFiles)
        .map(([path, raw]) => {
            const spec = wasm.parseSpec(raw) as Spec;
            const id = path.split('/').pop()!.replace('.json', '');
            // The same facts the core's `templates::all` gives the real app.
            const totals = computeCutList(spec, { kerf: 0.125, units: 'fraction' }).totals;
            return {
                id,
                name: spec.name,
                difficulty: spec.meta?.difficulty ?? null,
                summary: (gallery as Record<string, string>)[id] ?? null,
                notes: spec.meta?.notes ?? null,
                tags: spec.meta?.tags ?? [],
                partCount: spec.parts.length,
                overall: overallSize(spec),
                sheetCount: totals.sheetCount,
                boardFeet: totals.boardFeet,
                spec,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const notFound = (what: string) => ({ kind: 'notFound', message: `${what} not found.` });
    const row = (id: number): Row => {
        const r = rows.get(id);
        if (!r) throw notFound(`Project ${id}`);
        return r;
    };
    const summary = (p: Project): ProjectSummary => ({
        id: p.id,
        name: p.name,
        partCount: p.draft.parts.length,
        updatedAt: p.draftUpdatedAt,
        createdAt: p.createdAt,
        thumbnailAt: p.thumbnailAt,
        deletedAt: p.deletedAt,
    });
    const create = (name: string, spec: Spec): Project => {
        const t = now();
        const project: Project = {
            id: nextId++,
            name: name.trim() || spec.name,
            draft: spec,
            draftUpdatedAt: t,
            createdAt: t,
            thumbnailAt: null,
            deletedAt: null,
        };
        rows.set(project.id, { project, versions: [], notes: [] });
        return project;
    };
    const parse = (raw: unknown): Spec => {
        const result = wasm.safeParseSpec(raw) as
            { status: 'ok'; data: Spec } | { status: 'err'; messages: string[] };
        if (result.status === 'err')
            throw { kind: 'invalid', message: result.messages[0], issues: result.messages };
        return result.data;
    };

    // Seed one project so the library is not empty on first load — unless `?empty` asks for a
    // first run.
    if (!new URLSearchParams(window.location.search).has('empty')) {
        create(
            'Record stand',
            templates.find((t) => t.id === 'record-stand')?.spec ??
                (wasm.starterSpec('Record stand', undefined) as Spec),
        );
    }

    type Args = Record<string, unknown>;
    const handlers: Record<string, (a: Args) => unknown> = {
        library_info: () => ({
            dataDir: '/mock/library',
            thumbnailsDir: '/mock/library/thumbnails',
            version: '0.1.0-dev',
            logDir: '/mock/logs',
        }),
        log_client_error: () => undefined,
        take_pending_opens: () => [],
        list_projects: (a) =>
            [...rows.values()]
                .map((r) => r.project)
                .filter((p) => (a.trashed ? p.deletedAt !== null : p.deletedAt === null))
                .sort((x, y) => y.draftUpdatedAt - x.draftUpdatedAt)
                .map(summary),
        list_templates: () => templates.map(({ spec: _spec, ...t }) => t),
        create_project: (a) => {
            const template = a.template as string | null;
            const spec = template
                ? templates.find((t) => t.id === template)?.spec
                : (wasm.starterSpec(
                      a.name as string,
                      a.metric
                          ? {
                                material_name: 'Birch Plywood 18 mm',
                                thickness: 18 / 25.4,
                                sheet_length: 2440 / 25.4,
                                sheet_width: 1220 / 25.4,
                            }
                          : undefined,
                  ) as Spec);
            if (!spec) throw notFound(`Template "${template}"`);
            return create(a.name as string, structuredClone(spec));
        },
        create_project_from_spec: (a) => create(a.name as string, parse(a.spec)),
        // A copy, like a real IPC reply: callers must never see later saves through it.
        get_project: (a) => structuredClone(row(a.id as number).project),
        rename_project: (a) => void (row(a.id as number).project.name = (a.name as string).trim()),
        trash_project: (a) => void (row(a.id as number).project.deletedAt = now()),
        restore_project: (a) => void (row(a.id as number).project.deletedAt = null),
        delete_project_forever: (a) => void rows.delete(a.id as number),
        duplicate_project: (a) => {
            const p = row(a.id as number).project;
            return create(`${p.name} (copy)`, structuredClone(p.draft));
        },
        save_draft: (a) => {
            const r = row(a.id as number);
            const base = a.baseUpdatedAt as number | null;
            if (base !== null && base !== r.project.draftUpdatedAt) {
                throw {
                    kind: 'conflict',
                    message: 'A newer version of this draft exists.',
                    draft: r.project.draft,
                    draftUpdatedAt: r.project.draftUpdatedAt,
                };
            }
            r.project.draft = parse(a.spec);
            r.project.draftUpdatedAt = now();
            return r.project.draftUpdatedAt;
        },
        list_versions: (a) => row(a.id as number).versions.map(({ spec: _spec, ...v }) => v),
        create_version: (a) => {
            const r = row(a.id as number);
            const spec = parse(a.spec);
            const version = {
                id: nextId++,
                projectId: r.project.id,
                label: (a.label as string | null) ?? null,
                createdBy: 'user' as const,
                createdAt: now(),
                spec,
            };
            r.versions.unshift(version);
            r.project.draft = spec;
            r.project.draftUpdatedAt = now();
            const { spec: _s, ...summaryRow } = version;
            return { version: summaryRow, draftUpdatedAt: r.project.draftUpdatedAt };
        },
        restore_version: (a) => {
            const r = row(a.id as number);
            const v = r.versions.find((x) => x.id === a.versionId);
            if (!v) throw notFound(`Version ${a.versionId}`);
            r.versions.unshift({
                id: nextId++,
                projectId: r.project.id,
                label: 'Before restore',
                createdBy: 'user',
                createdAt: now(),
                spec: r.project.draft,
            });
            r.project.draft = v.spec;
            r.project.draftUpdatedAt = now();
            return { spec: v.spec, draftUpdatedAt: r.project.draftUpdatedAt };
        },
        list_notes: (a) =>
            [...row(a.id as number).notes].sort(
                (x, y) => Number(y.pinned) - Number(x.pinned) || y.updatedAt - x.updatedAt,
            ),
        create_note: (a) => {
            const t = now();
            const note: Note = {
                id: nextId++,
                projectId: a.id as number,
                body: (a.body as string).trim(),
                pinned: false,
                createdAt: t,
                updatedAt: t,
            };
            row(a.id as number).notes.push(note);
            return note;
        },
        update_note: (a) => {
            for (const r of rows.values()) {
                const note = r.notes.find((n) => n.id === a.noteId);
                if (note) {
                    if (a.body !== null) note.body = (a.body as string).trim();
                    if (a.pinned !== null) note.pinned = a.pinned as boolean;
                    note.updatedAt = now();
                    return note;
                }
            }
            throw notFound(`Note ${a.noteId}`);
        },
        delete_note: (a) => {
            for (const r of rows.values()) r.notes = r.notes.filter((n) => n.id !== a.noteId);
        },
        // Backups: snapshots of the in-memory library, taken on demand.
        list_backups: () => backups.map(({ projects: _p, ...b }) => b),
        backup_now: () => {
            const createdAt = now();
            const b = {
                file: `woodshop-${createdAt}.db`,
                createdAt,
                bytes: 4096 * rows.size,
                projects: structuredClone([...rows.values()]),
            };
            backups.unshift(b);
            const { projects: _p, ...info } = b;
            return info;
        },
        backup_projects: (a) => {
            const b = backups.find((x) => x.file === a.file);
            if (!b) throw notFound(`Backup ${a.file}`);
            return b.projects.map((r) => summary(r.project));
        },
        restore_from_backup: (a) => {
            const b = backups.find((x) => x.file === a.file);
            const r = b?.projects.find((x) => x.project.id === a.projectId);
            if (!r) throw notFound(`Project ${a.projectId} in that backup`);
            return create(`${r.project.name} (restored)`, structuredClone(r.project.draft));
        },
        get_settings: () => settings,
        set_setting: (a) => void (settings[a.key as string] = a.value),
        save_thumbnail: () => now(),
        mcp_setup: () => ({
            command: '/Applications/Woodshop.app/Contents/MacOS/woodshop',
            args: ['--mcp'],
            claudeDesktopConfig: JSON.stringify(
                {
                    mcpServers: {
                        woodshop: {
                            command: '/Applications/Woodshop.app/Contents/MacOS/woodshop',
                            args: ['--mcp'],
                        },
                    },
                },
                null,
                2,
            ),
            claudeCodeCommand:
                'claude mcp add woodshop -- /Applications/Woodshop.app/Contents/MacOS/woodshop --mcp',
        }),
        // The design assistant: keys in a stand-in keychain, and a model that only reads the design.
        assistant_keys: () => ({ anthropic: keychain.has('anthropic'), openai: keychain.has('openai') }),
        assistant_set_key: (a) => {
            const key = (a.key as string | null)?.trim();
            if (key) keychain.add(a.provider as string);
            else keychain.delete(a.provider as string);
        },
        get_assistant_chat: (a) => chats.get(a.id as number) ?? null,
        set_assistant_chat: (a) => {
            row(a.id as number);
            if (a.chat === null) chats.delete(a.id as number);
            else chats.set(a.id as number, structuredClone(a.chat));
        },
        assistant_stop: () => {
            stopAssistant?.();
        },
        assistant_send: (a) => {
            // "wait…" stands for a long turn: it runs until Stop.
            if (String(a.text).startsWith('wait')) {
                return new Promise((resolve) => {
                    stopAssistant = () => {
                        stopAssistant = null;
                        resolve({ reply: 'Stopped.', actions: [], history: a.history, changed: false });
                    };
                });
            }
            const r = row(a.projectId as number);
            const history = [...(a.history as unknown[]), { role: 'user', content: a.text }];
            // "longer…" stands for a change: the first part grows an inch, kept as a version first.
            if (String(a.text).startsWith('longer')) {
                const point = {
                    id: nextId++,
                    projectId: r.project.id,
                    label: 'Resize part',
                    createdBy: 'mcp' as const,
                    createdAt: now(),
                    spec: r.project.draft,
                };
                r.versions.unshift(point);
                const draft = structuredClone(r.project.draft);
                draft.parts[0].size.l += 1;
                r.project.draft = draft;
                r.project.draftUpdatedAt = now();
                const reply = 'Made the first part an inch longer.';
                return {
                    reply,
                    actions: [{ tool: 'resize_part', ok: true }],
                    history: [...history, { role: 'assistant', content: reply }],
                    changed: true,
                    restorePoint: point.id,
                };
            }
            const seen = typeof a.image === 'string' && a.image.length > 0 ? ' I can see the view.' : '';
            const reply = `“${r.project.name}” has ${r.project.draft.parts.length} parts.${seen} (This is the browser preview; the real assistant runs in the desktop app.)`;
            return {
                reply,
                actions: [{ tool: 'get_design', ok: true }],
                history: [...history, { role: 'assistant', content: reply }],
                changed: false,
            };
        },
        // Event plumbing used by listen()/emit().
        // Exports: the save dialog picks a fixed folder; written files are kept for the tests.
        'plugin:dialog|save': (a) =>
            `/mock/exports/${String((a.options as { defaultPath?: string } | undefined)?.defaultPath ?? 'file')}`,
        write_text_file: (a) => {
            const file = a.file as { path: string; contents: string };
            const store = window as unknown as { __written?: Record<string, string> };
            store.__written = { ...(store.__written ?? {}), [file.path]: file.contents };
        },
        'plugin:event|listen': () => nextId++,
        'plugin:event|unlisten': () => undefined,
    };

    mockWindows('main');
    mockIPC((cmd, args) => {
        const handler = handlers[cmd];
        if (!handler) {
            throw {
                kind: 'internal',
                message: `The browser preview has no "${cmd}" — run the desktop app for this.`,
            };
        }
        return handler((args ?? {}) as Args);
    });
}
