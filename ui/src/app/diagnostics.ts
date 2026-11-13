/**
 * Crash capture. Errors nobody handled — a screen that threw while rendering, a rejected promise,
 * a script error — are written to the app's local log file (see Settings → Diagnostics), so a
 * problem report can say what happened. Nothing is sent anywhere.
 */
import { api } from './api';

const MAX_REPORTS = 20; // per run: a render loop must not fill the disk
let reported = 0;
const seen = new Set<string>();

export function reportError(error: unknown, context: string): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const key = `${context}|${message}`;
    if (reported >= MAX_REPORTS || seen.has(key)) return;
    seen.add(key);
    reported += 1;
    const detail = [
        `at ${window.location.hash || '#/'}`,
        error instanceof Error && error.stack ? error.stack : '',
    ]
        .filter(Boolean)
        .join('\n');
    // Logging must never become the next error.
    void api.logClientError(`[${context}] ${message}`, detail).catch(() => undefined);
}

export function installErrorCapture(): void {
    window.addEventListener('error', (event) => reportError(event.error ?? event.message, 'error'));
    window.addEventListener('unhandledrejection', (event) =>
        reportError(event.reason, 'unhandled rejection'),
    );
}

/** Where problems are reported: the project's public issue tracker. */
export const ISSUES_URL = 'https://github.com/willard/woodshop-desktop/issues/new';

/**
 * A new issue on the bug form (`.github/ISSUE_TEMPLATE/bug.yml`), pre-filled with the app version
 * and the system — nothing about the user or their designs. GitHub fills form fields from query
 * parameters named by their `id`. The log stays on this computer until the person attaches it.
 */
export function problemReportUrl(version: string): string {
    const os = navigator.userAgent.match(/\(([^)]+)\)/)?.[1] ?? navigator.platform;
    return `${ISSUES_URL}?${new URLSearchParams({ template: 'bug.yml', version, os }).toString()}`;
}
