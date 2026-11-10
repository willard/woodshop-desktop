/**
 * The JSON an exported page carries, written by `woodshop-export::viewer` into a
 * `<script type="application/json">` and read once at boot. It goes through the same
 * migrate-on-read path as every other spec entry point: an exported file outlives the app
 * version that wrote it.
 */
import { safeParseSpec, type Spec } from '@/spec';
import { DEFAULT_CUTLIST_CONFIG } from '@/cutlist';

export interface ExportNote {
    body: string;
    pinned: boolean;
}

export interface ExportPayload {
    version: number;
    exportedAt: string;
    projectName: string;
    spec: Spec;
    kerf: number;
    theme: 'dark' | 'light';
    notes: ExportNote[];
}

interface RawPayload {
    version?: unknown;
    exportedAt?: unknown;
    project?: { name?: unknown };
    spec?: unknown;
    kerf?: unknown;
    theme?: unknown;
    notes?: unknown;
}

export function readPayload(
    json: string,
): { ok: true; payload: ExportPayload } | { ok: false; error: string } {
    let raw: RawPayload;
    try {
        raw = JSON.parse(json) as RawPayload;
    } catch (error) {
        return { ok: false, error: `This plan's data could not be read (${String(error)}).` };
    }
    const parsed = safeParseSpec(raw.spec);
    if (!parsed.success) {
        return {
            ok: false,
            error: 'This plan was written by a newer version of Woodshop and cannot be opened here.',
        };
    }
    const kerf = typeof raw.kerf === 'number' && raw.kerf >= 0 ? raw.kerf : DEFAULT_CUTLIST_CONFIG.kerf;
    return {
        ok: true,
        payload: {
            version: typeof raw.version === 'number' ? raw.version : 1,
            exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
            projectName: typeof raw.project?.name === 'string' ? raw.project.name : parsed.data.name,
            spec: parsed.data,
            kerf,
            theme: raw.theme === 'light' ? 'light' : 'dark',
            notes: Array.isArray(raw.notes)
                ? raw.notes.flatMap((note) => {
                      const row = note as { body?: unknown; pinned?: unknown };
                      return typeof row.body === 'string'
                          ? [{ body: row.body, pinned: row.pinned === true }]
                          : [];
                  })
                : [],
        },
    };
}

/** Pinned notes first, matching the app and the PDF. */
export function orderNotes(notes: readonly ExportNote[]): ExportNote[] {
    return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}
