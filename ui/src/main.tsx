import './app.css';

import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import { initDomain } from '@/domain';
import { api, setThumbnailsDir } from '@/app/api';
import { installErrorCapture } from '@/app/diagnostics';
import { isUnits, setUnits } from '@/lib/display';
import { parseHardwarePrices, setHardwarePrices } from '@/cutlist/prices';
import { CrashScreen } from '@/components/CrashScreen';
import { router } from '@/app/router';
import { queryClient } from '@/app/queryClient';
import { ToastProvider } from '@/components/Toast';
import { AppEvents } from '@/components/AppEvents';
import { watchSystemTheme } from '@/lib/theme';

async function boot(): Promise<void> {
    // The domain core (linter, cut list, outlines) is WebAssembly; nothing runs before it.
    await initDomain();
    // A plain browser (Vite preview, Playwright) has no native side: stand in for it.
    if ((import.meta.env.DEV || import.meta.env.VITE_E2E === '1') && !isTauri()) {
        const { installMockBackend } = await import('@/test/mockBackend');
        installMockBackend();
    }
    installErrorCapture();
    const [info, settings] = await Promise.all([api.libraryInfo(), api.getSettings()]);
    // A saved choice of units; until there is one, the default follows the system's region.
    if (isUnits(settings.units)) setUnits(settings.units);
    setHardwarePrices(parseHardwarePrices(settings.hardwarePrices));
    setThumbnailsDir(info.thumbnailsDir);
    watchSystemTheme(() => undefined);
    // macOS draws no title bar (tauri.conf.json: titleBarStyle Overlay); the app's own header sits
    // beside the traffic lights, so headers leave room for them (`.titlebar-gutter` in app.css).
    if (isTauri() && /Mac/i.test(navigator.userAgent)) document.documentElement.dataset.titlebar = 'overlay';

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <ToastProvider>
                    <AppEvents />
                    {/* Last resort only: pages load before they show (see app/router.tsx). */}
                    <Suspense fallback={<div className="bg-surface-0 h-full w-full" />}>
                        <RouterProvider router={router} />
                    </Suspense>
                </ToastProvider>
            </QueryClientProvider>
        </StrictMode>,
    );
}

// If the app cannot even start (the core failed to load, the library would not open), say so
// instead of leaving an empty window.
boot().catch((error: unknown) => {
    createRoot(document.getElementById('root')!).render(
        <CrashScreen error={error} context="startup failed" />,
    );
});
