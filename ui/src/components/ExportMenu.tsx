/**
 * Export actions for the open project. Every export is produced from the spec on screen and
 * written to a path the user picks in a native save dialog. The editor's overflow menu lists them
 * all; the cut list header carries the ones a shop reaches for (plan, 3D, spreadsheet).
 */
import type { Spec } from '@/spec';
import type { CutList } from '@/cutlist/types';
import { cutListCsv } from '@/cutlist/csv';
import { computeCutList } from '@/cutlist';
import { api, errorMessage } from '@/app/api';
import { chooseSavePath, fileStem } from '@/app/files';
import { wasm } from '@/domain';
import { getUnits } from '@/lib/display';
import { derivedHoleOps } from '@/spec/movables';
import { useToast } from './Toast';

export interface ExportTarget {
    projectId: number;
    projectName: string;
    getSpec(): Spec;
    kerf: number;
    /** Writes any pending autosave first, so the backend renders what is on screen. */
    flush(): Promise<void>;
    /** The assembly as glTF, from the 3D view (absent where there is no view). */
    getGltf?: (name: string) => Promise<string>;
}

export function useProjectExports(target: ExportTarget) {
    const toast = useToast();
    const stem = fileStem(target.projectName);

    async function exportTo(
        ext: string,
        filterName: string,
        write: (path: string) => Promise<void>,
        done: string,
    ): Promise<void> {
        await target.flush();
        const path = await chooseSavePath(`${stem}.${ext}`, { name: filterName, extensions: [ext] });
        if (path === null) return;
        try {
            await write(path);
            toast.success(done);
        } catch (e) {
            toast.error(errorMessage(e));
        }
    }

    return {
        pdf: () =>
            exportTo(
                'pdf',
                'PDF plan',
                (path) => api.exportPdf(target.projectId, path, target.kerf),
                'PDF plan saved.',
            ),
        viewer: () =>
            exportTo(
                'html',
                '3D plan (HTML)',
                (path) => api.exportViewer(target.projectId, path, target.kerf),
                'Interactive 3D plan saved.',
            ),
        /** The cut list as shown (same kerf, same grouping), for a spreadsheet. */
        cutListCsv: (cutList?: CutList) =>
            exportTo(
                'csv',
                'Cut list (CSV)',
                (path) =>
                    api.writeTextFile(
                        path,
                        cutListCsv(cutList ?? computeCutList(target.getSpec(), { kerf: target.kerf })),
                    ),
                'Cut list saved.',
            ),
        spec: () =>
            exportTo(
                'json',
                'Spec JSON',
                (path) => api.writeTextFile(path, JSON.stringify(target.getSpec(), null, 2)),
                'Spec JSON saved.',
            ),
        /** Every part laid flat for a CNC router: outlines, holes and channels by layer. */
        dxf: () =>
            exportTo(
                'dxf',
                'DXF for CNC',
                (path) => api.writeTextFile(path, wasm.specDxf(target.getSpec(), getUnits())),
                'DXF saved.',
            ),
        /** The assembled model for other 3D software. */
        gltf: () =>
            exportTo(
                'gltf',
                '3D model (glTF)',
                async (path) => {
                    if (target.getGltf === undefined) throw new Error('The 3D view is not ready.');
                    await api.writeTextFile(path, await target.getGltf(target.projectName));
                },
                '3D model saved.',
            ),
        /** Every shaped or drilled part as a 1:1 printable SVG template, in one file per part. */
        templates: () =>
            exportTo(
                'svg',
                'SVG shop templates',
                async (path) => {
                    const spec = target.getSpec();
                    const materials = new Map(spec.materials.map((m) => [m.id, m]));
                    // A door on concealed hinges gets its cup holes on the template too.
                    const bored = derivedHoleOps(spec);
                    const all = spec.parts.map((p) => {
                        const cups = bored.get(p.id);
                        return cups === undefined ? p : { ...p, ops: [...(p.ops ?? []), ...cups] };
                    });
                    const parts = all.filter((p) => (p.ops ?? []).length > 0);
                    const targets = parts.length > 0 ? parts : all;
                    const base = path.replace(/\.svg$/i, '');
                    for (const [i, part] of targets.entries()) {
                        const m = materials.get(part.materialId);
                        const svg = wasm.outlineSvg(
                            part,
                            m?.thickness ?? 0.75,
                            m?.name ?? '',
                            [],
                            getUnits(),
                        );
                        await api.writeTextFile(
                            targets.length === 1
                                ? path
                                : `${base}-${String(i + 1).padStart(2, '0')}-${fileStem(part.name)}.svg`,
                            svg,
                        );
                    }
                },
                'Shop templates saved.',
            ),
    };
}

export function ExportMenuItems(props: ExportTarget & { close(): void }) {
    const exports = useProjectExports(props);
    const item = 'enabled:hover:bg-fg/[0.07] rounded-md px-2.5 py-2 text-left text-[12.5px]';
    const run = (action: () => Promise<void>) => () => {
        props.close();
        void action();
    };

    return (
        <>
            <button className={item} data-testid="export-pdf" onClick={run(exports.pdf)}>
                Export PDF plan…
            </button>
            <button
                className={item}
                data-testid="export-html"
                title="An interactive, view-only 3D copy of this plan that opens in any browser"
                onClick={run(exports.viewer)}
            >
                Export 3D plan (HTML)…
            </button>
            <button
                className={item}
                data-testid="export-csv"
                title="The cut list for a spreadsheet: one row per blank, sizes in your units"
                onClick={run(() => exports.cutListCsv())}
            >
                Export cut list (CSV)…
            </button>
            <button
                className={item}
                data-testid="export-svg"
                title="Full-size printable patterns for shaped and drilled parts"
                onClick={run(exports.templates)}
            >
                Export shop templates (SVG)…
            </button>
            <button
                className={item}
                data-testid="export-dxf"
                title="Every part laid flat for a CNC router: outlines, holes and dados on layers named by depth"
                onClick={run(exports.dxf)}
            >
                Export parts for CNC (DXF)…
            </button>
            <button
                className={item}
                data-testid="export-gltf"
                title="The assembled model for Blender, SketchUp, Fusion and other 3D software"
                onClick={run(exports.gltf)}
            >
                Export 3D model (glTF)…
            </button>
            <button className={item} onClick={run(exports.spec)}>
                Export spec (JSON)…
            </button>
        </>
    );
}

/** The cut list header's exports: the shop plan, the 3D viewer and the spreadsheet. */
export function CutListExportButtons(props: ExportTarget & { cutList: CutList }) {
    const exports = useProjectExports(props);
    const button =
        'border-fg/10 text-fg/75 hover:bg-fg/5 h-7 rounded-lg border px-2.5 text-[11.5px] whitespace-nowrap';
    return (
        <>
            <button className={button} data-testid="cutlist-export-pdf" onClick={() => void exports.pdf()}>
                PDF
            </button>
            <button
                className={button}
                data-testid="cutlist-export-html"
                title="An interactive, view-only 3D copy of this plan that opens in any browser"
                onClick={() => void exports.viewer()}
            >
                3D
            </button>
            <button
                className={button}
                data-testid="cutlist-export-csv"
                title="The cut list for a spreadsheet: one row per blank, sizes in your units"
                onClick={() => void exports.cutListCsv(props.cutList)}
            >
                CSV
            </button>
        </>
    );
}
