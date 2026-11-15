/**
 * Renders the template gallery's pictures: `npm run thumbnails`. Runs the app against the browser
 * mock, opens every template in the editor, and saves its 3D view in both themes as WebP under
 * `ui/public/templates/`. Run it after adding or changing a template, on a machine with a GPU
 * (software WebGL draws the plainer fallback lighting).
 */
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';

export default {
    ...base,
    testDir: '.',
    testMatch: 'render.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    // The dev server runs from the repository root, wherever this config lives.
    webServer: { ...base.webServer, cwd: fileURLToPath(new URL('../..', import.meta.url)) },
};
