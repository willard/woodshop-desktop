/**
 * Listens for what the native side pushes: the library changed under us (an MCP agent edited a
 * design), the OS asked us to open `.woodshop` files, and menu bar commands.
 */
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/app/api';
import { importProjectFromDialog } from '@/app/files';
import { router } from '@/app/router';
import { useToast } from './Toast';

export function AppEvents() {
    const queryClient = useQueryClient();
    const toast = useToast();

    useEffect(() => {
        async function openFiles(paths: string[]): Promise<void> {
            for (const path of paths) {
                try {
                    const project = await api.importProjectFile(path);
                    await queryClient.invalidateQueries({ queryKey: ['projects'] });
                    toast.success(`Imported “${project.name}”.`);
                    void router.navigate({ to: '/projects/$id', params: { id: String(project.id) } });
                } catch (e) {
                    toast.error(errorMessage(e));
                }
            }
        }

        async function openFromDialog(): Promise<void> {
            try {
                const project = await importProjectFromDialog();
                if (project === null) return;
                await queryClient.invalidateQueries({ queryKey: ['projects'] });
                toast.success(`Imported “${project.name}”.`);
                void router.navigate({ to: '/projects/$id', params: { id: String(project.id) } });
            } catch (e) {
                toast.error(errorMessage(e));
            }
        }

        /** Menu bar items (`src-tauri/src/menu.rs`), by id. */
        function onMenu(id: string): void {
            const routes: Record<string, string> = {
                'new-from-template': '/templates',
                settings: '/settings',
                'go-projects': '/',
                'go-templates': '/templates',
                'go-tools': '/tools',
                'go-help': '/help',
            };
            if (id === 'open-project-file') void openFromDialog();
            else if (routes[id] !== undefined) void router.navigate({ to: routes[id] });
        }

        const unlisten = [
            listen('library-changed', () => {
                void queryClient.invalidateQueries({ queryKey: ['projects'] });
                void queryClient.invalidateQueries({ queryKey: ['versions'] });
                window.dispatchEvent(new CustomEvent('woodshop:library-changed'));
            }),
            listen<string[]>('open-files', (event) => void openFiles(event.payload)),
            listen<string>('menu', (event) => onMenu(event.payload)),
        ];
        void api.takePendingOpens().then((paths) => {
            if (paths.length > 0) void openFiles(paths);
        });

        return () => unlisten.forEach((p) => void p.then((fn) => fn()));
    }, [queryClient, toast]);

    return null;
}
