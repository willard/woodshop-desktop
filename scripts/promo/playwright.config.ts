/**
 * Records the promo video's scenes: `npm run promo` (this, then `compose.mjs`). Runs the app
 * against the browser mock on a machine with a GPU and an installed Chrome (E2E_BROWSER_CHANNEL).
 */
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';

export default {
    ...base,
    testDir: '.',
    testMatch: 'record.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    use: {
        ...base.use,
        actionTimeout: 15_000,
        // The screencast captures at device pixels only when Chrome itself runs at 2x.
        launchOptions: { args: ['--force-device-scale-factor=2'] },
    },
    webServer: { ...base.webServer, cwd: fileURLToPath(new URL('../..', import.meta.url)) },
};
