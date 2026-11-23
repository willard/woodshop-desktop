/**
 * Entry point for the standalone plan viewer, built into one IIFE script that the export inlines
 * into a .html file. It runs from file://, offline, with no app around it.
 */
import { createRoot } from 'react-dom/client';
import { initDomain } from '@/domain';
import { ViewerApp } from './ViewerApp';
import { readPayload } from './payload';
import { setUnits } from '@/lib/display';
import './viewer.css';

function fail(message: string): void {
    const mount = document.getElementById('viewer');
    if (mount !== null) {
        mount.textContent = message;
        mount.setAttribute('data-testid', 'viewer-error');
        mount.setAttribute('style', 'padding:2rem;font:14px system-ui;');
    }
}

/**
 * The exported page links to its AR model with a plain `rel="ar"` link, so it works even where
 * scripts do not run. Where they do, the link moves into the 3D controls, or goes where the
 * browser has no AR Quick Look (there it would only download the file).
 */
function takeArLink(): string | undefined {
    const link = document.getElementById('woodshop-ar');
    if (link === null) return undefined;
    link.remove();
    const href = link.getAttribute('href') ?? '';
    return href !== '' && document.createElement('a').relList.supports('ar') ? href : undefined;
}

const arHref = takeArLink();

void initDomain().then(() => {
    const data = document.getElementById('woodshop-export');
    const mount = document.getElementById('viewer');
    if (data === null || mount === null) {
        fail('This plan is missing its data and cannot be displayed.');
        return;
    }
    const result = readPayload(data.textContent ?? '');
    if (!result.ok) {
        fail(result.error);
        return;
    }
    setUnits(result.payload.units);
    document.title = `${result.payload.projectName} — Woodshop plan`;
    createRoot(mount).render(<ViewerApp payload={result.payload} arHref={arHref} />);
});
