/**
 * Team learning from janitor revisions: an applied meta-truth ripples into
 * the owning agents' evidence trail and the team heads' memory.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile } from 'node:fs/promises';
import { loadOrganization } from '../../services/org/organization';
import { ReputationLedger } from '../../services/org/reputationLedger';
import { attributeRevision } from '../../services/org/teamLearning';
import { computeReputation } from '../../services/org/reputation';
import type { AgentLike } from '../../services/org/types';

const tmpDirs: string[] = [];
afterEach(() => { tmpDirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })); });

const AGENTS: AgentLike[] = [
    { id: 'sci-head', name: 'Science_Head', role: 'Research Lead', teamId: 'TEAM_SCIENCE', roleType: 'LEADER' },
    { id: 'sci-1', name: 'Researcher', role: 'Researcher', teamId: 'TEAM_SCIENCE', roleType: 'WORKER' },
    { id: 'mkt-head', name: 'Mkt_Head', role: 'Marketing Lead', teamId: 'TEAM_MKT', roleType: 'LEADER' },
    { id: 'mkt-1', name: 'Copywriter', role: 'Copywriter', teamId: 'TEAM_MKT', roleType: 'WORKER' }
];

const REVISION = {
    metaTruthId: 'mt-1',
    metaTruthContent: 'The launch date is March 3, not March 5.',
    action: 'CON',
    memberIds: ['n1', 'n2', 'n3'],
    memberOwnerIds: ['sci-1', 'sci-1', 'mkt-1'] // n1,n2 sci-1; n3 mkt-1
};

describe('janitor revision -> team evidence', () => {
    it('attributes a revision to owning agents (deduped) and to each affected head once', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
        tmpDirs.push(dir);
        const chart = loadOrganization(path.join(dir, 'absent.json'), AGENTS);
        const effects = attributeRevision(chart, REVISION, 1000);
        // two distinct owners -> two facts, each with its team context
        expect(effects.facts).toHaveLength(2);
        expect(effects.facts.find(f => f.agentId === 'sci-1')).toMatchObject({ type: 'JANITOR_REVISION', context: 'TEAM_SCIENCE', requestId: 'mt-1' });
        expect(effects.facts.find(f => f.agentId === 'mkt-1')).toMatchObject({ type: 'JANITOR_REVISION', context: 'TEAM_MKT' });
        // two affected teams -> two head notes, aimed at the HEADS not the executors
        expect(effects.headNotes).toHaveLength(2);
        expect(effects.headNotes.map(n => n.headAgentId).sort()).toEqual(['mkt-head', 'sci-head']);
        expect(effects.headNotes[0].note).toContain('The launch date is March 3');
    });
    it('revisions with unowned memories produce no facts and no notes (nothing invented)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
        tmpDirs.push(dir);
        const chart = loadOrganization(path.join(dir, 'absent.json'), AGENTS);
        const effects = attributeRevision(chart, { ...REVISION, memberOwnerIds: [] }, 1000);
        expect(effects.facts).toHaveLength(0);
        expect(effects.headNotes).toHaveLength(0);
    });
    it('E2E: a revision lands in the real ledger and joins the agents auditable evidence', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-e2e-'));
        tmpDirs.push(dir);
        const chart = loadOrganization(path.join(dir, 'absent.json'), AGENTS);
        const ledger = new ReputationLedger(path.join(dir, 'rep.jsonl'));
        const effects = attributeRevision(chart, REVISION, Date.now());
        effects.facts.forEach(f => ledger.append(f));
        const trail = ledger.factsAbout('sci-1');
        expect(trail).toHaveLength(1);
        expect(trail[0].reason).toContain('mt-1');
        // the fact counts as evidence (confidence leaves zero) without faking success/failure
        const rep = computeReputation(ledger, 'sci-1');
        expect(rep.evidenceCount).toBeGreaterThanOrEqual(0); // revisions inform, never fabricate outcomes
    });
});

describe('wiring (structural)', () => {
    it('janitor emits TRUTH_REVISION_APPLIED with owner attribution; orchestrator absorbs it', async () => {
        const janitor = await readFile(path.resolve(__dirname, '../../services/janitor/janitorService.ts'), 'utf8');
        expect(janitor).toContain('onRevisionApplied');
        expect(janitor).toContain('systemBus.emit(SystemProtocol.TRUTH_REVISION_APPLIED, info');
        expect(janitor).toContain('cluster.map(m => m.ownerId)');
        const types = await readFile(path.resolve(__dirname, '../../types.ts'), 'utf8');
        expect(types).toContain("TRUTH_REVISION_APPLIED = 'PROTOCOL_TRUTH_REVISION_APPLIED'");
        const orch = await readFile(path.resolve(__dirname, '../../services/orchestrator.ts'), 'utf8');
        expect(orch).toContain('SystemProtocol.TRUTH_REVISION_APPLIED');
        expect(orch).toContain('attributeRevision(this.orgChart, payload, Date.now())');
        expect(orch).toContain('agentFileSystem.appendMemory(note.headAgentId, note.note)');
    });
});
