/**
 * Temporal context from the only real clock available: the server.
 * Replaces the previously declared-absent temporalContext in the R8
 * introspection contract: this is a measured value, not a fabrication.
 * The timezone travels with the payload so the reading is never mistaken
 * for the user's local time.
 */
export interface TemporalContext {
    now: string;        // "YYYY-MM-DD HH:MM:SS" server-local (UI splits on the space)
    iso: string;
    dayOfWeek: string;
    dayOfYear: number;
    timezone: string;
    source: 'server-clock';
}

export function buildTemporalContext(at: Date = new Date()): TemporalContext {
    const pad = (n: number) => String(n).padStart(2, '0');
    const startOfYear = new Date(at.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((at.getTime() - startOfYear.getTime()) / 86400000);
    return {
        now: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`,
        iso: at.toISOString(),
        dayOfWeek: at.toLocaleDateString('en-US', { weekday: 'long' }),
        dayOfYear,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        source: 'server-clock'
    };
}
