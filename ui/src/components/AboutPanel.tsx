/**
 * Settings ▸ About: the version, the licence, the source, and the notices for the third-party
 * software inside the app. Release builds ship `third-party-notices.txt` next to the UI
 * (`scripts/notices.mjs`); a dev build may not have it, and says how to make it.
 */
import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { REPO_URL } from '@/app/diagnostics';
import { errorMessage } from '@/app/api';
import { Modal } from './Modal';
import { useToast } from './Toast';

export const NOTICES_PATH = '/third-party-notices.txt';

function NoticesDialog({ onClose }: { onClose: () => void }) {
    const [text, setText] = useState<string | null>(null);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        let live = true;
        fetch(NOTICES_PATH)
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
            .then((t) => {
                if (!live) return;
                // A dev server answers an unknown path with the app's index.html.
                if (t.startsWith('<!')) setMissing(true);
                else setText(t);
            })
            .catch(() => live && setMissing(true));
        return () => {
            live = false;
        };
    }, []);

    return (
        <Modal onClose={onClose} testId="notices" className="max-w-3xl">
            <h2 className="mb-1 text-base font-semibold">Open-source licenses</h2>
            <p className="text-muted mb-3 text-xs">
                Woodshop is built on the work of many open-source projects. Their licenses are reproduced
                here, as they require.
            </p>
            {missing ? (
                <p className="text-muted text-sm">
                    This build doesn't include the notices file. Release builds do; to make it for a
                    development build, run <code>npm run notices</code>.
                </p>
            ) : (
                <pre
                    className="bg-surface-0 border-fg/8 h-[60vh] overflow-auto rounded-lg border p-3 text-[11px] leading-snug whitespace-pre-wrap"
                    data-testid="notices-text"
                >
                    {text ?? 'Loading…'}
                </pre>
            )}
            <div className="mt-3 flex justify-end">
                <button
                    className="border-fg/12 hover:bg-surface-2 rounded-lg border px-3 py-1.5 text-sm"
                    onClick={onClose}
                >
                    Close
                </button>
            </div>
        </Modal>
    );
}

export function AboutPanel({ version }: { version?: string }) {
    const toast = useToast();
    const [notices, setNotices] = useState(false);
    const open = (url: string) => () => void openUrl(url).catch((e) => toast.error(errorMessage(e)));
    const button = 'border-fg/12 hover:bg-surface-2 rounded-lg border px-3 py-2 text-sm';

    return (
        <>
            <p className="mb-3 text-sm">
                Woodshop {version ?? ''} is free software: you can use, study, share and change it under the{' '}
                <button
                    className="text-accent underline-offset-2 hover:underline"
                    onClick={open(`${REPO_URL}/blob/main/LICENSE`)}
                >
                    GNU General Public License, version 3 or later
                </button>
                . It comes with no warranty: check every plan before you cut.
            </p>
            <div className="flex flex-wrap gap-2">
                <button className={button} data-testid="about-source" onClick={open(REPO_URL)}>
                    Source code
                </button>
                <button className={button} data-testid="about-notices" onClick={() => setNotices(true)}>
                    Open-source licenses
                </button>
                <button className={button} onClick={open(`${REPO_URL}/blob/main/PRIVACY.md`)}>
                    Privacy
                </button>
            </div>
            {notices && <NoticesDialog onClose={() => setNotices(false)} />}
        </>
    );
}
