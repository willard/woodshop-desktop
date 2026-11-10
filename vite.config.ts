import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Tauri expects a fixed dev port and fails if it is taken rather than silently moving.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
    root: 'ui',
    clearScreen: false,
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./ui/src', import.meta.url)),
            '@fixtures': fileURLToPath(new URL('./ui/src/fixtures', import.meta.url)),
        },
    },
    worker: { format: 'es' },
    server: {
        port: 5317,
        strictPort: true,
        host: host || false,
        hmr: host ? { protocol: 'ws', host, port: 5318 } : undefined,
        watch: { ignored: ['**/src-tauri/**', '**/target/**'] },
    },
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        // Tauri's webviews: WebKit on macOS/Linux, Chromium (WebView2) on Windows.
        target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome111' : 'safari16',
        minify: !process.env.TAURI_ENV_DEBUG,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
        // Loaded from the app bundle on local disk, not over a network: three.js in one chunk is fine.
        chunkSizeWarningLimit: 1500,
    },
    test: {
        root: '.',
        environment: 'jsdom',
        include: ['ui/src/**/*.{test,spec}.{ts,tsx}'],
        setupFiles: ['ui/src/test/setup.ts'],
    },
});
