/**
 * Share to the gallery (Phase 7.12): the gallery is a Discussions category on the project's
 * repository, so there is no server. Woodshop saves what a post carries (one zip with the design
 * and its 3D plan, and a picture beside it), shows them in the file manager, and opens a new post
 * with the title and the words filled in. The maker drags the two files in and posts it.
 */
import { useState } from 'react';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { Spec } from '@/spec';
import { api, failure } from '@/app/api';
import { chooseSavePath, fileStem } from '@/app/files';
import { galleryPostUrl, GALLERY_URL } from '@/app/diagnostics';
import { overallSize } from '@/spec/geometry';
import { dims } from '@/lib/display';
import { Modal } from './Modal';
import { useToast } from './Toast';

/** The post's words: what it is and what it takes, and how to open it. Nothing about the maker. */
export function galleryPostBody(spec: Spec, version: string): string {
    const size = overallSize(spec);
    const used = new Set(spec.parts.map((p) => p.materialId));
    const materials = spec.materials.filter((m) => used.has(m.id)).map((m) => m.name);
    const pieces = spec.parts.reduce((n, p) => n + (p.qty ?? 1), 0);
    return [
        '<!-- Drag in the picture and the .zip that Woodshop saved, and say a few words about the piece. -->',
        '',
        ...(size === null ? [] : [`**Overall:** ${dims(size.width, size.depth, size.height)}`]),
        `**Materials:** ${materials.join(', ') || 'none'}`,
        `**Pieces:** ${pieces}`,
        '',
        `Made with Woodshop ${version}. To build it, download the .zip: open the 3D plan in any browser, or choose Import… in Woodshop and pick the .woodshop file.`,
    ].join('\n');
}

export function GalleryShare({
    projectId,
    projectName,
    version,
    kerf,
    getSpec,
    flush,
    getPicture,
    onClose,
}: {
    projectId: number;
    projectName: string;
    version: string;
    kerf: number;
    getSpec(): Spec;
    flush(): Promise<void>;
    /** A picture of the 3D view, as PNG. */
    getPicture(): Promise<Blob | null>;
    onClose(): void;
}) {
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const stem = fileStem(projectName);

    async function share(): Promise<void> {
        await flush();
        const path = await chooseSavePath(`${stem} for the gallery.zip`, {
            name: 'Zip',
            extensions: ['zip'],
        });
        if (path === null) return;
        setBusy(true);
        try {
            await api.exportGalleryBundle(projectId, path, stem, kerf);
            const picture = await getPicture();
            if (picture !== null) {
                await api.writeBinaryFile(
                    path.replace(/\.zip$/i, '') + '.png',
                    new Uint8Array(await picture.arrayBuffer()),
                );
            }
            await revealItemInDir(path).catch(() => undefined);
            await openUrl(galleryPostUrl(projectName, galleryPostBody(getSpec(), version)));
            toast.success('Saved. Drag the picture and the zip into the post.');
            onClose();
        } catch (e) {
            toast.error(failure('get the gallery post ready', e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal onClose={onClose} testId="gallery-dialog" className="max-w-md">
            <h2 className="mb-1 text-[15px] font-semibold">Share to the gallery</h2>
            <p className="text-muted mb-3 text-[13px]">
                The gallery is a public board on GitHub where makers post their designs. Woodshop saves a zip
                with this design and its 3D plan, and a picture of it, then opens a new post with the size and
                materials filled in. Drag the two files into the post, add a few words, and post it. You need
                a GitHub account.
            </p>
            <p className="text-muted mb-4 text-[13px]">
                Only the design goes in, with its material prices: not its saved versions or its notes. Anyone
                can download it.
            </p>
            <div className="flex items-center justify-between gap-2">
                <button
                    className="text-accent text-[13px] hover:underline"
                    data-testid="gallery-browse"
                    onClick={() =>
                        void openUrl(GALLERY_URL).catch((e) => toast.error(failure('open the gallery', e)))
                    }
                >
                    See the gallery
                </button>
                <div className="flex gap-2">
                    <button
                        className="border-fg/10 hover:bg-fg/5 h-8 rounded-lg border px-3 text-[13px]"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="bg-accent text-accent-ink hover:bg-accent-strong h-8 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50"
                        data-testid="gallery-share"
                        disabled={busy}
                        onClick={() => void share()}
                    >
                        {busy ? 'Saving…' : 'Save and open GitHub'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
