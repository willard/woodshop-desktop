/**
 * Entry point for the standalone plan viewer, built into one IIFE script that the export inlines
 * into a .html file. It runs from file://, offline, with no app around it.
 */
import { createRoot } from 'react-dom/client';
import { initDomain } from '@/domain';
import { ViewerApp } from './ViewerApp';
import { readPayload } from './payload';
import './viewer.css';

function fail(message: string): void {
    const mount = document.getElementById('viewer');
    if (mount !== null) {
        mount.textContent = message;
        mount.setAttribute('data-testid', 'viewer-error');
        mount.setAttribute('style', 'padding:2rem;font:14px system-ui;');
    }
}

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
    document.title = `${result.payload.projectName} — Woodshop plan`;
    createRoot(mount).render(<ViewerApp payload={result.payload} />);
});
