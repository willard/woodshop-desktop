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
