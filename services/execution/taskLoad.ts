/** Pure task-load projection. No runtime service imports or liveness claims. */
export type TaskPhase = 'admitted' | 'waiting_resources' | 'waiting_congestion' | 'executing';
export interface LoadRow { status: string; data: string | null; updated_at?: number }
export function parseTaskData(raw: string | null): Record<string, any> {
    if (raw === null || raw === '') throw new Error('TASK_METADATA_INVALID');
    const data = JSON.parse(raw);
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('TASK_METADATA_INVALID');
    return data;
}
/** Existing keys survive. Phase-only changes cannot revive terminal/uncertain work. */
export function mergeTaskMetadata(row: LoadRow, patch: Record<string, any>, phaseOnly = false): Record<string, any> | null {
    const data = parseTaskData(row.data);
    if (phaseOnly && (!['pending', 'running'].includes(row.status) || data.abandonedInFlight || data.lateSettlement || data.effectsReviewed)) return null;
    // Ordinary lifecycle metadata never erases recovery evidence or a durable output reference.
    const protectedKeys = new Set(['abandonedInFlight', 'lateSettlement', 'effectsReviewed', 'outputRef']);
    const merged = { ...data };
    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && !(protectedKeys.has(key) && data[key] !== undefined)) merged[key] = value;
    }
    return merged;
}
export function taskLoadSnapshot(rows: LoadRow[], observedAt: number) {
    const counts = { pending: 0, running: 0, completed: 0, failed: 0, other: 0, open: 0, terminalUncertain: 0, unresolvedAbandoned: 0, legacyUnknown: 0, metadataInvalid: 0, provenanceUnknown: 0 };
    const phases: Record<TaskPhase | 'unknown', number> = { admitted: 0, waiting_resources: 0, waiting_congestion: 0, executing: 0, unknown: 0 };
    let latestUpdate: number | null = null;
    for (const row of rows) {
        if (row.updated_at !== undefined && Number.isFinite(row.updated_at)) latestUpdate = Math.max(latestUpdate ?? row.updated_at, row.updated_at);
        const status = ['pending', 'running', 'completed', 'failed'].includes(row.status) ? row.status as 'pending' | 'running' | 'completed' | 'failed' : 'other';
        counts[status]++;
        const open = status === 'pending' || status === 'running';
        if (open) counts.open++;
        let data: Record<string, any>;
        try { data = parseTaskData(row.data); } catch { counts.metadataInvalid++; counts.provenanceUnknown++; if (open) phases.unknown++; continue; }
        if (typeof data.planId !== 'string' || typeof data.stepOrder !== 'number') counts.provenanceUnknown++;
        const uncertain = !!data.abandonedInFlight && !data.lateSettlement && !data.effectsReviewed;
        if (uncertain) { counts.unresolvedAbandoned++; if (!open) counts.terminalUncertain++; }
        if (open) {
            const phase = data.loadPhase as TaskPhase;
            if (!uncertain && Object.hasOwn(phases, phase) && phase !== ('unknown' as string)) phases[phase]++;
            else { phases.unknown++; if (!uncertain) counts.legacyUnknown++; }
        }
    }
    return { coverage: 'task_prefix_ledger_candidates_not_proven_origin', observedAt, latestUpdate, health: counts.metadataInvalid ? 'unknown' : 'observed', counts, phases,
        semantics: 'recorded_not_live; phases_partition_open; abandoned_overlaps_status; terminal_uncertain_not_stopped' };
}
