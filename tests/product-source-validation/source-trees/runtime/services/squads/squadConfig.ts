import fs from 'fs';
import type { Squad, Agent } from '../../types';

/**
 * Squad configuration loader.
 * - A valid data/squads.json wins.
 * - Missing or invalid file => squads derived from the seed agents (never silently empty),
 *   and the reason is returned so the caller can make it visible.
 * - Members are de-duplicated, ids are unique.
 */
export interface SquadLoadResult {
    squads: Squad[];
    source: 'file' | 'seed-fallback';
    warning?: string;
}

export function validateSquads(input: unknown): { ok: true; squads: Squad[] } | { ok: false; error: string } {
    if (!Array.isArray(input)) return { ok: false, error: 'squads file must be a JSON array' };
    const seen = new Set<string>();
    const out: Squad[] = [];
    for (const [i, raw] of input.entries()) {
        const s = raw as Partial<Squad>;
        if (!s || typeof s !== 'object') return { ok: false, error: `squad #${i} is not an object` };
        if (typeof s.id !== 'string' || !s.id) return { ok: false, error: `squad #${i} has no id` };
        if (typeof s.name !== 'string' || !s.name) return { ok: false, error: `squad ${s.id} has no name` };
        if (!Array.isArray(s.members) || s.members.some(m => typeof m !== 'string')) return { ok: false, error: `squad ${s.id} members must be string[]` };
        if (typeof s.category !== 'string') return { ok: false, error: `squad ${s.id} has no category` };
        if (seen.has(s.id)) return { ok: false, error: `duplicate squad id ${s.id}` };
        seen.add(s.id);
        out.push({
            ...(s as Squad),
            leaderId: typeof s.leaderId === 'string' ? s.leaderId : '',
            members: Array.from(new Set(s.members)),
            active: s.active ?? false,
            port: typeof s.port === 'number' ? s.port : 0,
        });
    }
    return { ok: true, squads: out };
}

/** Builds the base squads from the seed agents (id, category and leader come from the agents, nothing invented). */
export function deriveSquadsFromAgents(agents: Agent[]): Squad[] {
    const byTeam = new Map<string, Squad>();
    for (const a of agents) {
        if (!a.teamId) continue;
        let sq = byTeam.get(a.teamId);
        if (!sq) {
            sq = { id: a.teamId, name: a.teamId, leaderId: '', members: [], category: a.category, active: true, port: 9000 + byTeam.size };
            byTeam.set(a.teamId, sq);
        }
        if (!sq.members.includes(a.id)) sq.members.push(a.id);
        if (String(a.roleType).toUpperCase().includes('LEADER') && !sq.leaderId) sq.leaderId = a.id;
    }
    return [...byTeam.values()];
}

export function loadSquads(filePath: string, seedAgents: Agent[]): SquadLoadResult {
    const fallback = (warning: string): SquadLoadResult => ({ squads: deriveSquadsFromAgents(seedAgents), source: 'seed-fallback', warning });
    if (!fs.existsSync(filePath)) return fallback(`${filePath} not found; using squads derived from the seed agents.`);
    try {
        const parsed = validateSquads(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
        if (!parsed.ok) return fallback(`${filePath} is invalid (${(parsed as { error: string }).error}); using squads derived from the seed agents.`);
        return { squads: parsed.squads, source: 'file' };
    } catch (e: any) {
        return fallback(`${filePath} could not be read (${e.message}); using squads derived from the seed agents.`);
    }
}
