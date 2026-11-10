/** Native file dialogs for project files, with the right filters and a sensible default name. */
import { open, save } from '@tauri-apps/plugin-dialog';
import { api, type Project } from './api';

/** Filesystem-safe version of a project name for a default file name. */
export function fileStem(name: string): string {
    return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';
}

export async function chooseSavePath(
    defaultName: string,
    filter: { name: string; extensions: string[] },
): Promise<string | null> {
    return save({ defaultPath: defaultName, filters: [filter] });
}

export async function chooseProjectFile(): Promise<string | null> {
    const picked = await open({
        multiple: false,
        directory: false,
        filters: [
            { name: 'Woodshop project', extensions: ['woodshop'] },
            { name: 'Spec JSON', extensions: ['json'] },
        ],
    });
    return typeof picked === 'string' ? picked : null;
}

export const WOODSHOP_FILTER = { name: 'Woodshop project', extensions: ['woodshop'] };

/** Ask for a `.woodshop` file or a spec `.json` and add it to the library; null if cancelled. */
export async function importProjectFromDialog(): Promise<Project | null> {
    const path = await chooseProjectFile();
    if (path === null) return null;
    return path.toLowerCase().endsWith('.json') ? api.importSpecJson(path) : api.importProjectFile(path);
}
