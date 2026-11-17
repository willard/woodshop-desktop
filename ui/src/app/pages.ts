/**
 * The pages split into their own chunks (the editor pulls in three.js). As route components the
 * router fetches a page's code while it navigates, and on hover (`defaultPreload: 'intent'`), so
 * the old screen stays up until the new one can draw: no blank window in between.
 */
import { lazyRouteComponent } from '@tanstack/react-router';

export const EditorPage = lazyRouteComponent(() => import('@/pages/EditorPage'));
export const ToolsPage = lazyRouteComponent(() => import('@/pages/ToolsPage'));
export const ToolPage = lazyRouteComponent(() => import('@/pages/ToolPage'));
export const HelpPage = lazyRouteComponent(() => import('@/pages/HelpPage'));
export const HelpArticlePage = lazyRouteComponent(() => import('@/pages/HelpArticlePage'));
export const ShoppingPage = lazyRouteComponent(() => import('@/pages/ShoppingPage'));
export const SettingsPage = lazyRouteComponent(() => import('@/pages/SettingsPage'));

/** Warms the editor's code while the user is still looking at the project list. */
export function preloadEditor(): void {
    void EditorPage.preload?.();
}
