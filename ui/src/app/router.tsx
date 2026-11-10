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
import { lazy } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { TemplatesPage } from '@/pages/TemplatesPage';

// The editor pulls in three.js; load it only when a project opens.
const EditorPage = lazy(() => import('@/pages/EditorPage'));
const ToolsPage = lazy(() => import('@/pages/ToolsPage'));
const ToolPage = lazy(() => import('@/pages/ToolPage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const HelpArticlePage = lazy(() => import('@/pages/HelpArticlePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

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
    createRoute({ getParentRoute: () => rootRoute, path: '/projects/$id', component: EditorPage }),
]);

export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
