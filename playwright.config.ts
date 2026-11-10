import { defineConfig, devices } from '@playwright/test';

// The UI against the in-memory mock backend (ui/src/test/mockBackend.ts), which the Vite dev
// server installs whenever it runs outside Tauri. Its own port, so a running `tauri dev` (5317)
// never serves these tests.
const PORT = Number(process.env.E2E_PORT ?? 5327);

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: 'list',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        viewport: { width: 1360, height: 860 },
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1360, height: 860 },
                // E2E_BROWSER_CHANNEL=chrome runs against an installed Chrome instead of the
                // Playwright-downloaded build (`npx playwright install chromium`).
                channel: process.env.E2E_BROWSER_CHANNEL || undefined,
            },
        },
    ],
    webServer: {
        command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
