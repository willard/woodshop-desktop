import { describe, it, expect, vi, beforeEach } from 'vitest';

const logClientError = vi.fn(() => Promise.resolve());
vi.mock('@/app/api', () => ({ api: { logClientError } }));

describe('reportError', () => {
    beforeEach(() => {
        vi.resetModules();
        logClientError.mockClear();
    });

    it('logs an error once, with where it happened and its stack', async () => {
        const { reportError } = await import('@/app/diagnostics');
        const error = new TypeError('part is undefined');
        reportError(error, 'screen crashed');
        reportError(error, 'screen crashed');
        expect(logClientError).toHaveBeenCalledTimes(1);
        const [message, detail] = logClientError.mock.calls[0] as unknown as [string, string];
        expect(message).toBe('[screen crashed] TypeError: part is undefined');
        expect(detail).toContain('at #/');
        expect(detail).toContain('TypeError');
    });

    it('stops after a cap, so an error loop cannot fill the log', async () => {
        const { reportError } = await import('@/app/diagnostics');
        for (let i = 0; i < 50; i++) reportError(new Error(`boom ${i}`), 'error');
        expect(logClientError).toHaveBeenCalledTimes(20);
    });

    it('never throws when logging itself fails', async () => {
        logClientError.mockImplementationOnce(() => Promise.reject(new Error('ipc down')));
        const { reportError } = await import('@/app/diagnostics');
        expect(() => reportError('plain string', 'error')).not.toThrow();
    });
});
