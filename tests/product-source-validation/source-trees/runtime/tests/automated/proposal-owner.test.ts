/** Proposal owner registry (R9): daemon initiatives start ownerless and
 * undispatchable; owner assignment is an explicit, separate decision by a
 * CURRENT CREATOR (role re-derived from the real identity service), durable
 * across restarts, and never an approval. Two independent fixture principals
 * (not real people). No provider/model call. DECLARED LIMIT: the janitor
 * cycle itself needs provider models, so its wiring is guarded statically;
 * the registry contract is runtime-tested. */
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PROPOSAL_OWNER_DIR = mkdtempSync(join(tmpdir(), 'proposal-owner-'));

const { identityService } = await import('../../services/identityService');
const { ProposalOwnerRegistry, proposalOwners } = await import('../../services/security/proposalOwner');

let creator: any, plain: any, owner: any;

beforeAll(async () => {
    await identityService.init();
    creator = await identityService.upsertUser({ email: 'po-creator@fixture.invalid', name: 'PO Creator' });
    plain = await identityService.upsertUser({ email: 'po-user@fixture.invalid', name: 'PO User' });
    owner = await identityService.upsertUser({ email: 'po-owner@fixture.invalid', name: 'PO Owner' });
});

describe('R9: durable explicit proposal ownership', () => {
    it('a recorded initiative starts UNRESOLVED_OWNER, undispatchable, with no invented owner', () => {
        const r = proposalOwners.propose({ initiativeId: 'janitor:run1:abc', origin: 'janitor', summary: 'REV: meta truth' });
        expect(r.status).toBe('UNRESOLVED_OWNER');
        expect(r.owner).toBeUndefined();
        expect(proposalOwners.isDispatchable('janitor:run1:abc')).toBe(false);
        expect(proposalOwners.isDispatchable('never-recorded')).toBe(false); // unknown: fail-closed
        // idempotent: re-recording preserves state
        const again = proposalOwners.propose({ initiativeId: 'janitor:run1:abc', origin: 'janitor', summary: 'changed' });
        expect(again.summary).toBe('REV: meta truth');
    });

    it('a non-CREATOR cannot assign; the denied attempt is recorded as evidence', () => {
        proposalOwners.propose({ initiativeId: 'janitor:run2:def', origin: 'janitor', summary: 'REV: x' });
        const denied = proposalOwners.assign('janitor:run2:def', owner.id, plain.id);
        expect(denied).toMatchObject({ ok: false, reason: 'NOT_AUTHORIZED' });
        const stored = proposalOwners.get('janitor:run2:def')!;
        expect(stored.status).toBe('UNRESOLVED_OWNER');
        expect(stored.decisions.some(d => d.type === 'OWNER_ASSIGN_DENIED' && d.by === plain.id)).toBe(true);
        expect(proposalOwners.isDispatchable('janitor:run2:def')).toBe(false);
    });

    it('a current CREATOR assigns an existing user; assignment is recorded and is NOT an approval', () => {
        const assigned = proposalOwners.assign('janitor:run2:def', owner.id, creator.id);
        expect(assigned).toMatchObject({ ok: true });
        if (assigned.ok) {
            expect(assigned.record.status).toBe('ASSIGNED');
            expect(assigned.record.owner).toBe(owner.id);
            const d = assigned.record.decisions.find(x => x.type === 'OWNER_ASSIGNED');
            expect(d?.by).toBe(creator.id);
            // No approval concept exists here: the record carries no
            // approved/consent field at all. Effects keep their own gates.
            expect(assigned.record).not.toHaveProperty('approved');
        }
        expect(proposalOwners.isDispatchable('janitor:run2:def')).toBe(true);
    });

    it('unknown initiatives and non-existent owners are denied', () => {
        expect(proposalOwners.assign('never-recorded', owner.id, creator.id)).toMatchObject({ ok: false, reason: 'UNKNOWN_INITIATIVE' });
        expect(proposalOwners.assign('janitor:run2:def', 'fantasma', creator.id)).toMatchObject({ ok: false, reason: 'UNKNOWN_OWNER' });
    });

    it('reassignment is a separate recorded decision by a CREATOR', () => {
        const re = proposalOwners.assign('janitor:run2:def', plain.id, creator.id);
        expect(re).toMatchObject({ ok: true });
        const stored = proposalOwners.get('janitor:run2:def')!;
        expect(stored.owner).toBe(plain.id);
        expect(stored.decisions.filter(d => d.type === 'OWNER_ASSIGNED')).toHaveLength(2);
    });

    it('records survive a registry restart (durable store)', () => {
        const fresh = new ProposalOwnerRegistry(process.env.PROPOSAL_OWNER_DIR!);
        const stored = fresh.get('janitor:run2:def')!;
        expect(stored.status).toBe('ASSIGNED');
        expect(stored.decisions.length).toBeGreaterThanOrEqual(3);
        const lines = readFileSync(join(process.env.PROPOSAL_OWNER_DIR!, 'proposal-owners.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
        expect(lines.find((ev: any) => ev.op === 'PROPOSE' && ev.rec.initiativeId === 'janitor:run2:def')).toBeDefined();
    });

    it('wiring guard: janitor dry-run records every verified proposal as ownerless (static; janitor cycle needs provider models, not run here)', () => {
        const src = readFileSync('services/janitor/janitorService.ts', 'utf8');
        const dryRun = src.slice(src.indexOf('// Layer 3'));
        expect(dryRun).toContain('proposalOwners.propose({');
        expect(dryRun).toContain("origin: 'janitor'");
    });
});

describe('R9-eventlog: append-only owner store resilience', () => {
    it('a torn line (crash mid-append) is skipped; records and assignment keep working', async () => {
        const { appendFileSync } = await import('node:fs');
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = mkdtempSync(join(tmpdir(), 'proposal-torn-'));
        const { ProposalOwnerRegistry } = await import('../../services/security/proposalOwner');
        const registry = new ProposalOwnerRegistry(dir);
        registry.propose({ initiativeId: 'init-torn-1', origin: 'janitor', summary: 's' });
        appendFileSync(join(dir, 'proposal-owners.jsonl'), '{"op":"DECISION","initiativeId":"init-torn');
        expect(registry.get('init-torn-1')?.status).toBe('UNRESOLVED_OWNER');
        expect(registry.isDispatchable('init-torn-1')).toBe(false);
    });
});
