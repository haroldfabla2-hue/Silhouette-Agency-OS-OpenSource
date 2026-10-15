/**
 * [W4] Canonical agent-target resolution for the mission mailbox.
 *
 * Factory fire test finding: POST /v1/inbox/Orchestrator accepted the
 * mission (200 OK, "Brief dispatched") but the Orchestrator's canonical ID
 * is 'core-01' (display name Orchestrator_Prime). processGlobalMail only
 * scans knownAgentIds — 'Orchestrator' was never among them, so the
 * mission rotted in a mailbox nobody reads. Silent failure, 200 OK.
 *
 * Resolution order: exact ID -> whitespace-normalized ID (legacy dynamic
 * IDs carried a trailing space) -> display name / normalized alias
 * ("Orchestrator" == "Orchestrator_Prime"). No match = undefined, and the
 * caller MUST fail loudly — never deliver to a mailbox nobody scans.
 */
import { Agent } from '../../types';

function normalize(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveAgentTarget(target: string | undefined | null, agents: Agent[]): Agent | undefined {
    if (!target || !target.trim()) return undefined;

    // 1. Exact ID
    const byId = agents.find(a => a.id === target);
    if (byId) return byId;

    // 2. Whitespace-normalized ID (legacy dynamic IDs with trailing space)
    const t = target.trim();
    const byTrimmed = agents.find(a => a.id === t || a.id.trim() === t);
    if (byTrimmed) return byTrimmed;

    // 3. Display name / normalized alias
    const n = normalize(t);
    if (!n) return undefined;
    return agents.find(a => {
        const name = normalize(a.name);
        return name === n
            || name.replace(/prime$/, '') === n
            || n === normalize(a.id);
    });
}
