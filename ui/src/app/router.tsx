/**
 * Routes. Hash history: a desktop app has no server to answer deep links, and the hash survives a
 * reload of the webview.
 */
import {
    createHashHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
} from '@tanstack/react-router';
import { AppLayout } from '@/components/AppLayout';
import { CrashScreen } from '@/components/CrashScreen';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { EditorPage, HelpArticlePage, HelpPage, SettingsPage, ToolPage, ToolsPage } from './pages';
import { prefetchProject } from './projectQuery';

const rootRoute = createRootRoute({ component: Outlet });

// Every page but the editor sits inside the app shell.
const shell = createRoute({ getParentRoute: () => rootRoute, id: 'shell', component: AppLayout });

const routeTree = rootRoute.addChildren([
    shell.addChildren([
        createRoute({ getParentRoute: () => shell, path: '/', component: () => <ProjectsPage /> }),
        createRoute({
            getParentRoute: () => shell,
            path: '/trash',
            component: () => <ProjectsPage trashed />,
        }),
        createRoute({ getParentRoute: () => shell, path: '/templates', component: TemplatesPage }),
        createRoute({ getParentRoute: () => shell, path: '/tools', component: ToolsPage }),
        createRoute({ getParentRoute: () => shell, path: '/tools/$slug', component: ToolPage }),
        createRoute({ getParentRoute: () => shell, path: '/help', component: HelpPage }),
        createRoute({ getParentRoute: () => shell, path: '/help/$slug', component: HelpArticlePage }),
        createRoute({ getParentRoute: () => shell, path: '/settings', component: SettingsPage }),
    ]),
    createRoute({
        getParentRoute: () => rootRoute,
        path: '/projects/$id',
        component: EditorPage,
        // The project arrives with the page, so the editor opens drawn rather than on "Opening…".
        // A hover preload is never trusted at the click: an agent may have edited it meanwhile.
        loader: ({ params }) => prefetchProject(Number(params.id)),
        preloadStaleTime: 0,
    }),
]);

export const router = createRouter({
    routeTree,
    history: createHashHistory(),
    defaultPreload: 'intent',
    // A screen that throws is replaced by a recovery screen instead of a blank window.
    defaultErrorComponent: ({ error }) => <CrashScreen error={error} />,
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
