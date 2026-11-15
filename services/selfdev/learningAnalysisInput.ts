/** Shared canonical construction, not caller field order or model JSON.
 * No storage, provider or runtime-service import. */
export interface LearningFailureInput {
    id: string;
    incident?: { id: string; source: string; firstSeen: number };
    timestamp: number;
    context: string;
    action: string;
    error?: string;
    solution?: string;
    source: string;
}
export function canonicalLearningAnalysisInput(context: string, failures: readonly LearningFailureInput[]): string {
    if (!context || failures.length < 1 || failures.length > 100 || new Set(failures.map(f => f.id)).size !== failures.length) {
        throw new Error('Distinct bounded failure inputs required');
    }
    return JSON.stringify({ version: 1, context, failures: [...failures].sort((a, b) => a.id.localeCompare(b.id)).map(f => {
        if (!f.id || f.context !== context || !Number.isFinite(f.timestamp) || f.timestamp <= 0
            || typeof f.action !== 'string' || typeof f.source !== 'string'
            || (f.error !== undefined && typeof f.error !== 'string') || (f.solution !== undefined && typeof f.solution !== 'string')
            || (f.incident && (!f.incident.id || f.incident.source !== context || f.incident.firstSeen !== f.timestamp || f.id !== `incident:${f.incident.id}`))) {
            throw new Error('Invalid canonical failure input');
        }
        return { id: f.id, incident: f.incident ? { id: f.incident.id, source: f.incident.source, firstSeen: f.incident.firstSeen } : undefined,
            timestamp: f.timestamp, context: f.context, action: f.action, result: 'FAILURE', error: f.error, solution: f.solution, source: f.source };
    }) });
}
