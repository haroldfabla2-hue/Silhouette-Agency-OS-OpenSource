import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSquads, validateSquads, deriveSquadsFromAgents } from '../../services/squads/squadConfig';

const agents: any[] = [
    { id: 'core-01', teamId: 'TEAM_CORE', category: 'CORE', roleType: 'LEADER' },
    { id: 'core-02', teamId: 'TEAM_CORE', category: 'CORE', roleType: 'WORKER' },
];
const tmp = (name: string, content?: string) => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sq-')), name);
    if (content !== undefined) fs.writeFileSync(p, content);
    return p;
};

describe('squad config (regression: missing data/squads.json silently produced zero squads)', () => {
    it('missing file falls back to seed squads with a visible warning, never empty', () => {
        const r = loadSquads(tmp('squads.json'), agents);
        expect(r.source).toBe('seed-fallback');
        expect(r.warning).toMatch(/not found/);
        expect(r.squads.map(s => s.id)).toEqual(['TEAM_CORE']);
        expect(r.squads[0].leaderId).toBe('core-01');
        expect(r.squads[0].members).toEqual(['core-01', 'core-02']);
    });
    it('invalid JSON or schema falls back with the reason', () => {
        expect(loadSquads(tmp('s.json', '{nope'), agents).warning).toMatch(/could not be read/);
        expect(loadSquads(tmp('s.json', '[{"id":"A"}]'), agents).warning).toMatch(/invalid/);
    });
    it('valid file wins and members are de-duplicated', () => {
        const f = tmp('s.json', JSON.stringify([{ id: 'A', name: 'A', category: 'DEV', members: ['x', 'x', 'y'] }]));
        const r = loadSquads(f, agents);
        expect(r.source).toBe('file');
        expect(r.squads[0].members).toEqual(['x', 'y']);
    });
    it('duplicate squad ids are rejected', () => {
        const v = validateSquads([{ id: 'A', name: 'A', category: 'DEV', members: [] }, { id: 'A', name: 'B', category: 'DEV', members: [] }]);
        expect(v.ok).toBe(false);
    });
    it('derive uses agent data only', () => {
        expect(deriveSquadsFromAgents(agents as any)[0].category).toBe('CORE');
    });
});
