/**
 * Takes the Help Center's screenshots: `npm run help-shots`. Runs the app against the browser
 * mock, sets up each screen on the sample nightstand, and saves it in both themes as WebP under
 * `ui/public/help/`. Run it after a change that alters a screen an article shows, on a machine
 * with a GPU (software WebGL draws the plainer fallback lighting).
 */
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';

export default {
    ...base,
    testDir: '.',
    testMatch: 'shots.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    // The dev server runs from the repository root, wherever this config lives.
    webServer: { ...base.webServer, cwd: fileURLToPath(new URL('../..', import.meta.url)) },
};
