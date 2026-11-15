/** The one query cache, shared by the React tree and the router's loaders. */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
    defaultOptions: {
        // Local IPC: nothing to retry against, and a failure should surface at once.
        queries: { retry: false, refetchOnWindowFocus: true, staleTime: 5_000 },
        mutations: { retry: false },
    },
});
