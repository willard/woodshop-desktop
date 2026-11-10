/**
 * Hand-built minimal specs for sturdiness tests. Everything goes through parseSpec so
 * the shapes stay honest against the schema (defaults filled, strict keys enforced).
 */
import { parseSpec, type Spec } from '@/spec';

export interface PartDef {
    id: string;
    size: { l: number; w: number };
    pos: [number, number, number];
    rot?: [number, number, number];
    materialId?: string;
}

export interface MaterialDef {
    id: string;
    type: 'sheet' | 'lumber';
    thickness: number;
    species?: string;
}

const DEFAULT_MATERIAL: MaterialDef = { id: 'mat_ply', type: 'sheet', thickness: 0.75 };

export function makeSpec(
    parts: PartDef[],
    options: { materials?: MaterialDef[]; joints?: object[] } = {},
): Spec {
    const materials = (options.materials ?? [DEFAULT_MATERIAL]).map((m) => ({
        id: m.id,
        type: m.type,
        name: m.id,
        thickness: m.thickness,
        ...(m.type === 'sheet' ? { sheetSize: { l: 96, w: 48 } } : { stockWidth: 11.25, stockLengths: [96] }),
        ...(m.species !== undefined ? { species: m.species } : {}),
    }));
    return parseSpec({
        specVersion: '1.7',
        units: 'in',
        name: 'Struct Test',
        materials,
        parts: parts.map((p) => ({
            id: p.id,
            name: p.id,
            materialId: p.materialId ?? materials[0].id,
            size: p.size,
            transform: { pos: p.pos, rot: p.rot ?? [0, 0, 0] },
        })),
        joints: options.joints ?? [],
    });
}

/**
 * Vertical side panel with its thickness along world X (bookshelf-style, rot [0,90,0]).
 * `x` is the panel center; a 0.75 panel at x = span/2 + 0.375 meets a span-long shelf.
 */
export function sidePanel(id: string, x: number, { depth = 12, height = 30 } = {}): PartDef {
    return { id, size: { l: depth, w: height }, pos: [x, height / 2, 0], rot: [0, 90, 0] };
}

/** Horizontal shelf, thickness vertical (rot [90,0,0]), spanning `span` along world X. */
export function shelf(id: string, span: number, { depth = 12, y = 20 } = {}): PartDef {
    return { id, size: { l: span, w: depth }, pos: [0, y, 0], rot: [90, 0, 0] };
}

/** Two sides + one shelf: the canonical simply-supported span (0.75" side thickness). */
export function shelfBetweenSides(span: number, opts: { depth?: number; y?: number } = {}): PartDef[] {
    const x = span / 2 + 0.375;
    return [
        sidePanel('p_side_l', -x, { depth: opts.depth }),
        sidePanel('p_side_r', x, { depth: opts.depth }),
        shelf('p_shelf', span, opts),
    ];
}
