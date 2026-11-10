import './app.css';

import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { isTauri } from '@tauri-apps/api/core';
import { initDomain } from '@/domain';
import { api, setThumbnailsDir } from '@/app/api';
import { router } from '@/app/router';
import { ToastProvider } from '@/components/Toast';
import { AppEvents } from '@/components/AppEvents';
import { watchSystemTheme } from '@/lib/theme';

const queryClient = new QueryClient({
    defaultOptions: {
        // Local IPC: nothing to retry against, and a failure should surface at once.
        queries: { retry: false, refetchOnWindowFocus: true, staleTime: 5_000 },
        mutations: { retry: false },
    },
});

async function boot(): Promise<void> {
    // The domain core (linter, cut list, outlines) is WebAssembly; nothing runs before it.
    await initDomain();
    // A plain browser (Vite preview, Playwright) has no native side: stand in for it.
    if ((import.meta.env.DEV || import.meta.env.VITE_E2E === '1') && !isTauri()) {
        const { installMockBackend } = await import('@/test/mockBackend');
        installMockBackend();
    }
    const info = await api.libraryInfo();
    setThumbnailsDir(info.thumbnailsDir);
    watchSystemTheme(() => undefined);

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <ToastProvider>
                    <AppEvents />
                    <Suspense fallback={<div className="text-faint p-8 text-sm">Loading…</div>}>
                        <RouterProvider router={router} />
                    </Suspense>
                </ToastProvider>
            </QueryClientProvider>
        </StrictMode>,
    );
}

void boot();
