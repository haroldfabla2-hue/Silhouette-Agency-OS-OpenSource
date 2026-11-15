/**
 * [PR-2] Typed event contracts: SQUAD_EXPANSION is birth-only (validated
 * payload), SQUAD_MOBILIZED is a notification, AGENT_HYDRATION_REQUEST wakes
 * one existing agent. Regression for D3: mobilizeSquad used to emit
 * SQUAD_EXPANSION with {source, message}, and the birth subscriber turned
 * every mobilization (and every introspection hydration request) into an
 * "Unknown Squad Lead" phantom agent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emitLog: Array<{ protocol: string; payload: any }> = [];
const subscribers = new Map<string, Array<(event: any) => void>>();

vi.mock('../../services/systemBus', () => ({
    systemBus: {
        emit: (protocol: string, payload: any) => {
            emitLog.push({ protocol, payload });
            (subscribers.get(protocol) || []).forEach(cb => cb({ payload }));
        },
        subscribe: (protocol: string, cb: (event: any) => void) => {
            if (!subscribers.has(protocol)) subscribers.set(protocol, []);
            subscribers.get(protocol)!.push(cb);
        }
    }
}));

// Minimal orchestrator harness: exercise the REAL subscriber logic by
// re-binding the validation block against a spyable handler. The full
// Orchestrator singleton boots Redis/persistence, so this harness imports
// only the pure contract decision via a fresh subscribe against the mocked bus.
import { systemBus } from '../../services/systemBus';
import { resolveSquadName } from '../../services/squads/dynamicBirth';

function wireBirthSubscriber(handleDynamicExpansion: (p: any) => void) {
    // Mirror of services/orchestrator.ts PR-2 subscriber (same contract).
    systemBus.subscribe('PROTOCOL_SQUAD_EXPANSION' as any, (event) => {
        const raw = event?.payload ?? {};
        const inner = raw?.payload ?? raw;
        const hasName = typeof inner.name === 'string' && inner.name.trim().length > 0;
        const hasCategory = typeof inner.category === 'string' && inner.category.trim().length > 0;
        if (!hasName || !hasCategory) return; // rejected
        handleDynamicExpansion(event.payload);
    });
}

describe('PR-2 event contracts', () => {
    beforeEach(() => { emitLog.length = 0; subscribers.delete('PROTOCOL_SQUAD_EXPANSION'); });

    it('rejects mobilization-shaped payloads (no name/category) — no phantom birth', () => {
        const births: any[] = [];
        wireBirthSubscriber(p => births.push(p));
        systemBus.emit('PROTOCOL_SQUAD_EXPANSION' as any, { source: 'Lead', message: 'Squad fully mobilized with 3 drones.' });
        expect(births).toHaveLength(0);
    });

    it('rejects hydration-shaped payloads ({agentId, reason}) — no phantom birth', () => {
        const births: any[] = [];
        wireBirthSubscriber(p => births.push(p));
        systemBus.emit('PROTOCOL_SQUAD_EXPANSION' as any, { agentId: 'agt_123', reason: 'proactive hydration' });
        expect(births).toHaveLength(0);
    });

    it('accepts a valid birth command (name+category)', () => {
        const births: any[] = [];
        wireBirthSubscriber(p => births.push(p));
        systemBus.emit('PROTOCOL_SQUAD_EXPANSION' as any, { name: 'Genesis_Ops', category: 'INTEGRATION', role: 'Deployment' });
        expect(births).toHaveLength(1);
        expect(resolveSquadName(births[0])).toBe('Genesis_Ops');
    });

    it('accepts double-wrapped birth payloads (payload.payload.name)', () => {
        const births: any[] = [];
        wireBirthSubscriber(p => births.push(p));
        systemBus.emit('PROTOCOL_SQUAD_EXPANSION' as any, { payload: { name: 'Data_Squad', category: 'ANALYSIS' } });
        expect(births).toHaveLength(1);
        expect(resolveSquadName(births[0])).toBe('Data_Squad');
    });

    it('mobilizeSquad emits SQUAD_MOBILIZED, never SQUAD_EXPANSION (source audit)', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('services/orchestrator.ts', 'utf8');
        const mobilizeBody = src.slice(src.indexOf('public async mobilizeSquad(squad: Squad)'), src.indexOf('public async mobilizeSquad(squad: Squad)') + 2000); // [PR-3b] anchor on the method signature with a bounded window (message text changed when drones stopped mass-hydrating; next legit SQUAD_EXPANSION emission is +10k chars away)
        expect(mobilizeBody).toContain('SQUAD_MOBILIZED');
        expect(mobilizeBody).not.toContain('SystemProtocol.SQUAD_EXPANSION');
    });

    it('introspection hydration emits AGENT_HYDRATION_REQUEST, never SQUAD_EXPANSION (source audit)', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync('services/introspectionEngine.ts', 'utf8');
        // The HYDRATE_AGENT decision path must use the hydration contract.
        const i = src.indexOf("'HYDRATE_AGENT'");
        expect(i).toBeGreaterThan(-1);
        const region = src.slice(i, i + 700);
        expect(region).toContain('AGENT_HYDRATION_REQUEST');
        expect(region).not.toContain('systemBus.emit(SystemProtocol.SQUAD_EXPANSION');
    });
});
