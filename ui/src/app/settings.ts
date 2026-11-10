/** App settings stored in the library (shared with nothing else; per install). */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const KERF_OPTIONS = [0.0625, 0.09375, 0.125, 0.25];

export function useSettings() {
    return useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity });
}

/** The saw kerf new cut lists start from; each editor session can override it. */
export function useDefaultKerf(): number {
    const v = useSettings().data?.defaultKerf;
    return typeof v === 'number' ? v : 0.125;
}
