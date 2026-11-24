/**
 * The JSON an exported page carries, written by `woodshop-export::viewer` into a
 * `<script type="application/json">` and read once at boot. It goes through the same
 * migrate-on-read path as every other spec entry point: an exported file outlives the app
 * version that wrote it.
 */
import { safeParseSpec, type Spec } from '@/spec';
import { DEFAULT_CUTLIST_CONFIG } from '@/cutlist';
import { isUnits, type Units } from '@/lib/display';

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
    /** How sizes are shown; files from before 1.15 carry none and stay in fractions. */
    units: Units;
    /** The imported models' GLB files, base64, by hash (spec 1.22). */
    models: Record<string, string>;
}

interface RawPayload {
    version?: unknown;
    exportedAt?: unknown;
    project?: { name?: unknown };
    spec?: unknown;
    kerf?: unknown;
    theme?: unknown;
    notes?: unknown;
    units?: unknown;
    models?: unknown;
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
            units: isUnits(raw.units) ? raw.units : 'fraction',
            models:
                typeof raw.models === 'object' && raw.models !== null
                    ? Object.fromEntries(
                          Object.entries(raw.models as Record<string, unknown>).filter(
                              (entry): entry is [string, string] => typeof entry[1] === 'string',
                          ),
                      )
                    : {},
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

/** An embedded model's GLB bytes, or null when the page doesn't carry it. */
export function embeddedModel(models: Record<string, string>, hash: string): ArrayBuffer | null {
    const base64 = models[hash];
    if (base64 === undefined) return null;
    const text = atob(base64);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes.buffer;
}

/** Pinned notes first, matching the app and the PDF. */
export function orderNotes(notes: readonly ExportNote[]): ExportNote[] {
    return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}
