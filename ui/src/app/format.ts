/** Display formatting shared by list views. */

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 minutes ago", "yesterday", or a date for anything older than a week. */
export function timeAgo(ms: number, now = Date.now()): string {
    const seconds = Math.round((ms - now) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 45) return 'just now';
    if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
    if (abs < 7 * 86400) return relative.format(Math.round(seconds / 86400), 'day');
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}
