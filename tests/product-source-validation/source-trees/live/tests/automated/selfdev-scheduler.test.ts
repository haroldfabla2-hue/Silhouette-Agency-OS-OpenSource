/**
 * [AUTONOMOUS-SCHEDULER] Gate-by-gate proof of the self-dev scheduler.
 *
 * What must hold (Alberto's scope, 2026-10-23): OFF by default, memory
 * quota first, one active cycle, daily autonomous budget, declared scopes
 * only, and NEVER past the human PR gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { cycleStore, incidents, quota } = vi.hoisted(() => ({
    cycleStore: {
        list: vi.fn().mockReturnValue([]),
        countCreatedSince: vi.fn().mockReturnValue(0),
        create: vi.fn(),
        attempt: vi.fn(),
        execute: vi.fn(),
        requestPR: vi.fn()
    },
    incidents: { getOpenIncidents: vi.fn().mockReturnValue([]) },
    quota: {
        status: vi.fn().mockReturnValue({ allowed: true, used: 0, budget: 1500, day: 'x' }),
        hasExplicitBudget: vi.fn().mockReturnValue(true),
        budgetFor: vi.fn().mockReturnValue(1500),
        reserve: vi.fn().mockReturnValue({ allowed: true, used: 2, budget: 1500, day: 'x', reserved: true }),
        cooldownUntil: vi.fn().mockReturnValue(null)
    }
}));
vi.mock('../../services/selfdev/cycleService', () => ({ selfDevCycleService: cycleStore }));
vi.mock('../../services/incidentRegistry', () => ({ incidentRegistry: incidents }));
vi.mock('../../services/quotaLedger', () => ({ quotaLedger: quota }));

import { runSelfDevSchedulerOnce } from '../../services/selfdev/scheduler';

const MAPPED_INCIDENT = { id: 'i1', source: 'continuum-promote', kind: 'PROMOTE_FAILED', summary: 'promote failed', detail: 'd', status: 'open', occurrenceCount: 1, firstSeen: 1, lastSeen: 2, resolvedAt: null };

describe('SelfDev autonomous scheduler (preparation branch)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.SELFDEV_AUTONOMOUS;
        delete process.env.SELFDEV_AUTONOMOUS_MAX_CYCLES_PER_DAY;
        cycleStore.list.mockReturnValue([]);
        cycleStore.countCreatedSince.mockReturnValue(0);
        incidents.getOpenIncidents.mockReturnValue([]);
        quota.status.mockReturnValue({ allowed: true, used: 0, budget: 1500, day: 'x' });
        quota.hasExplicitBudget.mockReturnValue(true);
        quota.budgetFor.mockReturnValue(1500);
        quota.reserve.mockReturnValue({ allowed: true, used: 2, budget: 1500, day: 'x', reserved: true });
        quota.cooldownUntil.mockReturnValue(null);
    });
    afterEach(() => { delete process.env.SELFDEV_AUTONOMOUS; });

    it('OFF by default: deploy never activates the scheduler', async () => {
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('disabled');
        expect(cycleStore.create).not.toHaveBeenCalled();
    });

    it('defers when embedding quota is exhausted (memory pipeline first)', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        quota.status.mockReturnValue({ allowed: false, used: 1500, budget: 1500, day: 'x' });
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('quota');
        expect(cycleStore.create).not.toHaveBeenCalled();
    });

    it('defers while another cycle is active (one at a time)', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        cycleStore.list.mockReturnValue([{ id: 'c1', issue: 'x', state: 'EXECUTED', updatedAt: 0 }]);
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('active');
    });

    it('honors the daily autonomous budget (default 2, not the env 9)', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        cycleStore.countCreatedSince.mockReturnValue(2);
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('cap');
        expect(cycleStore.create).not.toHaveBeenCalled();
    });

    it('never guesses a scope: unmapped incidents produce no cycle', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        incidents.getOpenIncidents.mockReturnValue([{ ...MAPPED_INCIDENT, source: 'unknown-source' }]);
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('declared scope');
        expect(cycleStore.create).not.toHaveBeenCalled();
    });

    it('defers during a real provider 429 cooldown (embeddings): no retry pressure', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        quota.cooldownUntil.mockImplementation((p: string, m: string) => m.includes('embedding') ? Date.now() + 3600000 : null);
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('cooldown');
        expect(cycleStore.create).not.toHaveBeenCalled();
    });

    it('defers when every planner leg is in provider cooldown (429 is not a budget)', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        quota.cooldownUntil.mockReturnValue(Date.now() + 3600000);
        incidents.getOpenIncidents.mockReturnValue([MAPPED_INCIDENT]);
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('cooldown');
        expect(cycleStore.create).not.toHaveBeenCalled();
        expect(quota.reserve).not.toHaveBeenCalled();
    });

    it('fail-closed: no chain leg with explicit budget => defer and explain, never execute', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        quota.hasExplicitBudget.mockReturnValue(false);
        incidents.getOpenIncidents.mockReturnValue([MAPPED_INCIDENT]);
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('no free planner route');
        expect(d.reason).toContain('no explicit budget');
        expect(cycleStore.create).not.toHaveBeenCalled();
        expect(quota.reserve).not.toHaveBeenCalled();
    });

    it('fail-closed: quota hold refused => defer, memory/chat keep priority', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        quota.reserve.mockReturnValue({ allowed: false, used: 1499, budget: 1500, day: 'x', reserved: false });
        incidents.getOpenIncidents.mockReturnValue([MAPPED_INCIDENT]);
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('quota hold failed');
        expect(cycleStore.create).not.toHaveBeenCalled();
    });

    it('happy path: mapped incident runs create->attempt->execute, marks issue [auto]', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        incidents.getOpenIncidents.mockReturnValue([MAPPED_INCIDENT]);
        cycleStore.create.mockImplementation(() => {
            (cycleStore as any).createEnv = { ...process.env };
            return { id: 'cyc1', issue: 'x', state: 'PLANNED', createdAt: '', updatedAt: 0, scope: [], acceptance: { kind: 'vitest', target: 'x' } };
        });
        cycleStore.attempt.mockResolvedValue(undefined);
        cycleStore.execute.mockResolvedValue({ id: 'cyc1', state: 'VERIFIED' });
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(true);
        expect(d.finalState).toBe('VERIFIED');
        expect(cycleStore.create).toHaveBeenCalledTimes(1);
        const input = cycleStore.create.mock.calls[0][0];
        expect(input.issue.startsWith('[auto] ')).toBe(true);
        expect(input.scope.length).toBeGreaterThan(0);
        expect(cycleStore.attempt).toHaveBeenCalledWith('cyc1');
        expect(cycleStore.execute).toHaveBeenCalledWith('cyc1');
        // The human PR gate: the scheduler NEVER requests a PR.
        expect(cycleStore.requestPR).not.toHaveBeenCalled();
        // The planner quota hold was taken BEFORE the cycle started.
        expect(quota.reserve).toHaveBeenCalledTimes(1);
        // The reserved leg was pinned EXCLUSIVELY during the cycle (no
        // fallback into unmeasured legs) and the env was restored after.
        expect(cycleStore.createEnv?.SELFDEV_PLANNER_DISABLE_FALLBACK).toBe('true');
        expect(cycleStore.createEnv?.SELFDEV_PLANNER_PROVIDER).toBeTruthy();
        expect(process.env.SELFDEV_PLANNER_DISABLE_FALLBACK).toBeUndefined();
    });

    it('contains cycle errors instead of throwing into the daemon', async () => {
        process.env.SELFDEV_AUTONOMOUS = 'true';
        incidents.getOpenIncidents.mockReturnValue([MAPPED_INCIDENT]);
        cycleStore.create.mockImplementation(() => { throw new Error('boom'); });
        const d = await runSelfDevSchedulerOnce();
        expect(d.ran).toBe(false);
        expect(d.reason).toContain('contained');
    });
});
