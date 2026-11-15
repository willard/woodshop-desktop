/**
 * First run: the sample project and the guided tour. The tour is asked for by whoever navigates
 * into the editor (the empty library, the Help page) and taken by the editor once it opens.
 */
import type { QueryClient } from '@tanstack/react-query';
import { api, type Project } from './api';

/** The sample is the nightstand template: a drawer, slides, a pull and a real cut list. */
export const SAMPLE_TEMPLATE = 'nightstand';
export const SAMPLE_NAME = 'Sample nightstand';

/** Set when someone finishes or skips the tour; nothing reads it but the tests and future prompts. */
export const TOUR_DONE_SETTING = 'tourDone';

let tourRequested = false;

/** The next editor to open starts the tour. */
export function requestTour(): void {
    tourRequested = true;
}

/** Whether a tour was asked for. Pure, so it is safe in a render or a state initialiser. */
export function isTourRequested(): boolean {
    return tourRequested;
}

/** The request has been taken: the next editor opens without a tour unless asked again. */
export function clearTourRequest(): void {
    tourRequested = false;
}

/** Opens the sample project — the one already in the library, or a new one — with the tour. */
export async function openSampleWithTour(queryClient: QueryClient): Promise<Project> {
    const existing = (await api.listProjects()).find((p) => p.name === SAMPLE_NAME);
    const project =
        existing !== undefined
            ? await api.getProject(existing.id)
            : await api.createProject(SAMPLE_NAME, SAMPLE_TEMPLATE);
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    requestTour();
    return project;
}
