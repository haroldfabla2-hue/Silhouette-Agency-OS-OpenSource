import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// [NATIVE-RECOVERY] Root fixes for the 2026-10-23 finding that the memory
// pipeline only worked when an EXTERNAL operator ran recovery by hand:
// 1. Journal replay ran at boot only -> periodic reconcile (pending scope).
// 2. Promote failures reached console only -> incident registry reporting.
// 3. Embedding backfill had zero native callers -> quota-gated native pass.
// 4. Memory embeddings must never silently substitute model identity.
// Tests exercise the real failure/recovery paths (real journal files, real
// Lance on disk, real incident registry on the per-worker sqlite).

// continuum import boots dreamer/redis; drain deterministically (fase6 pattern).
afterAll(async () => {
    const mod: any = await import('../../services/dreamerService');
    for (let i = 0; i < 100 && !mod.dreamer; i++) {
        await new Promise(r => setTimeout(r, 50));
    }
    mod.dreamer?.stopDreamingLoop();
    const { redisClient } = await import('../../services/redisClient');
    await redisClient.disconnect();
});

const mem = (id: string, tier = 'MEDIUM'): any => ({
    id,
    content: `content-${id}`,
    originalContent: `content-${id}`,
    timestamp: Date.now(),
    tier,
    importance: 0.5,
    tags: [],
    accessCount: 0,
    lastAccess: Date.now(),
});

describe('native pipeline recovery', () => {

    it('journal replay: an interrupted transition resumes and commits against real Lance', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-rec-'));
        const { MemoryTransitions } = await import('../../services/memoryTransitions');
        const { LanceDbService } = await import('../../services/lancedbService');
        const lance = new LanceDbService(path.join(tmp, 'lance'));
        const transitions = new MemoryTransitions(path.join(tmp, 'journal'), lance as any);

        const source = mem('mem-rec-1', 'WORKING');
        const destination = mem('mem-rec-1', 'MEDIUM');
        const entry = await transitions.begin(source, destination); // PENDING, as after a crash
        expect(entry.state).toBe('PENDING');

        await transitions.resume(entry); // periodic reconcile path

        const stored = await lance.getNodeById('mem-rec-1');
        expect(stored?.id).toBe('mem-rec-1');
        const files = fs.readdirSync(path.join(tmp, 'journal'));
        expect(files).toHaveLength(1);
        const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'journal', files[0]), 'utf8'));
        expect(onDisk.state).toBe('COMMITTED');
    }, 60000);

    it('journal failure path: unreachable destination keeps the entry PENDING (no loss, no fake commit)', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fail-'));
        const blocker = path.join(tmp, 'blocker');
        fs.writeFileSync(blocker, 'not a directory'); // lance cannot open a dataset under a plain file
        const { MemoryTransitions } = await import('../../services/memoryTransitions');
        const { LanceDbService } = await import('../../services/lancedbService');
        const lance = new LanceDbService(path.join(blocker, 'lance'));
        const transitions = new MemoryTransitions(path.join(tmp, 'journal'), lance as any);

        const entry = await transitions.begin(mem('mem-fail-1', 'WORKING'), mem('mem-fail-1', 'MEDIUM'));
        await expect(transitions.resume(entry)).rejects.toThrow();

        const files = fs.readdirSync(path.join(tmp, 'journal'));
        const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'journal', files[0]), 'utf8'));
        expect(onDisk.state).toBe('PENDING'); // retained for a later pass - never deleted
    }, 60000);

    it('outstanding scope: periodic reconcile never re-verifies COMMITTED history (eternal journal guard)', async () => {
        const { isOutstandingTransition } = await import('../../services/memoryTransitions');
        const base = { key: 'k', source: mem('a'), destination: mem('a') };
        expect(isOutstandingTransition({ ...base, state: 'PENDING' } as any)).toBe(true);
        expect(isOutstandingTransition({ ...base, state: 'WRITTEN' } as any)).toBe(true);
        expect(isOutstandingTransition({ ...base, state: 'VERIFIED' } as any)).toBe(true);
        expect(isOutstandingTransition({ ...base, state: 'COMMITTED' } as any)).toBe(false);
    });

    it('quota cooldown: real provider 429 blocks backfill without burning calls, expiry reopens', async () => {
        const fs = await import('fs');
        const os = await import('os');
        const path = await import('path');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-cool-'));
        const { QuotaLedger } = await import('../../services/quotaLedger');
        const ledger = new QuotaLedger(path.join(tmp, 'quota.json'));
        // no cooldown => callable
        expect(ledger.cooldownUntil('gemini', 'gemini-embedding-001')).toBeNull();
        // real 429 RetryInfo => durable cooldown, backfill skips without a call
        ledger.recordCooldown('gemini', 'gemini-embedding-001', Date.now() + 60000, 'test 429');
        expect(ledger.cooldownUntil('gemini', 'gemini-embedding-001')).toBeGreaterThan(Date.now());
        const { continuum: continuumMemory } = await import('../../services/continuumMemory');
        let burned = 0;
        const r = await continuumMemory.maybeRunEmbeddingBackfill(ledger, async () => { burned++; return { projected: 1, failed: 0 }; });
        expect(r.ran).toBe(false);
        expect(r.reason).toContain('cooldown');
        expect(burned).toBe(0);
        // expired cooldown => open again (no invented reset: until came from provider).
        // recordCooldown never SHORTENS an active one (max semantics); write
        // the expired record directly to test the read path.
        fs.writeFileSync(path.join(tmp, 'quota-cooldown.json'), JSON.stringify({ 'gemini:gemini-embedding-001': Date.now() - 1 }));
        expect(ledger.cooldownUntil('gemini', 'gemini-embedding-001')).toBeNull();
        // and a shorter real 429 must NOT shorten an active longer cooldown
        const longer = Date.now() + 120000;
        ledger.recordCooldown('gemini', 'gemini-embedding-001', longer, 'long');
        ledger.recordCooldown('gemini', 'gemini-embedding-001', Date.now() + 30000, 'short');
        expect(ledger.cooldownUntil('gemini', 'gemini-embedding-001')).toBe(Math.floor(longer));
    });

    it('quota gate: ledger blocks honestly when the local daily budget is spent, without burning calls', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-quota-'));
        process.env.QUOTA_DAILY_BUDGET_GEMINI_GEMINI_EMBEDDING_001 = '1';
        try {
            const { QuotaLedger } = await import('../../services/quotaLedger');
            const ledger = new QuotaLedger(path.join(tmp, 'quota.json'));
            const first = ledger.recordAttempt('gemini', 'gemini-embedding-001');
            expect(first.allowed).toBe(true);
            const second = ledger.recordAttempt('gemini', 'gemini-embedding-001');
            expect(second.allowed).toBe(false); // 2/1 spent
            expect(ledger.status('gemini', 'gemini-embedding-001').allowed).toBe(false);
        } finally {
            delete process.env.QUOTA_DAILY_BUDGET_GEMINI_GEMINI_EMBEDDING_001;
        }
    });

    it('embedding backfill scheduler: blocked pass records an incident; successful pass resolves the same one', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-sched-'));
        process.env.QUOTA_DAILY_BUDGET_GEMINI_GEMINI_EMBEDDING_001 = '1';
        const { continuum } = await import('../../services/continuumMemory');
        const { QuotaLedger } = await import('../../services/quotaLedger');
        const { incidentRegistry } = await import('../../services/incidentRegistry');
        try {
            const spent = new QuotaLedger(path.join(tmp, 'spent.json'));
            spent.recordAttempt('gemini', 'gemini-embedding-001');
            spent.recordAttempt('gemini', 'gemini-embedding-001'); // 2/1 -> blocked

            const blocked = await continuum.maybeRunEmbeddingBackfill(spent);
            expect(blocked.ran).toBe(false);
            expect(blocked.reason).toContain('quota budget spent');
            const open = incidentRegistry.getOpenIncidents().filter(i => i.source === 'continuum-embeddings');
            expect(open.length).toBeGreaterThan(0);

            const fresh = new QuotaLedger(path.join(tmp, 'fresh.json'));
            const ok = await continuum.maybeRunEmbeddingBackfill(fresh, async () => ({ projected: 3, failed: 0 }));
            expect(ok.ran).toBe(true);
            expect(ok.projected).toBe(3);
            expect(incidentRegistry.getOpenIncidents().filter(i => i.source === 'continuum-embeddings')).toHaveLength(0);
        } finally {
            delete process.env.QUOTA_DAILY_BUDGET_GEMINI_GEMINI_EMBEDDING_001;
        }
    }, 60000);

    it('strict identity: memory-path embedding with no API client returns null and NEVER touches the local model', async () => {
        const saved = { ...process.env };
        delete process.env.GEMINI_API_KEY;
        delete process.env.API_KEY;
        delete process.env.GOOGLE_AI_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        for (let i = 2; i <= 5; i++) delete process.env[`GEMINI_API_KEY_${i}`];
        try {
            const { generateEmbeddingWithIdentity } = await import('../../services/geminiService');
            const { localEmbeddingService } = await import('../../services/localEmbeddingService');
            const spy = vi.spyOn(localEmbeddingService, 'getEmbedding');
            const result = await generateEmbeddingWithIdentity('texto de prueba', { allowFallbackIdentity: false });
            expect(result).toBeNull();
            expect(spy).not.toHaveBeenCalled(); // no silent identity substitution
            spy.mockRestore();
        } finally {
            process.env = saved;
        }
    }, 60000);

    it('doctor audit surfaces outstanding transitions and pending embeddings honestly', async () => {
        const { runMemoryAudit } = await import('../../services/health/memoryAudit');
        const find = (checks: any[], prefix: string) => checks.find(c => c.name.startsWith(prefix));

        const warn = runMemoryAudit({
            nodes: [], souls: [], janitorMetrics: null, now: Date.now(),
            pendingTransitions: 34, pendingEmbeddings: 1548,
            embeddingQuota: { used: 450, budget: 450, day: '2026-10-23' },
        } as any);
        expect(find(warn, 'Memory: transition journal outstanding').status).toBe('warning');
        expect(find(warn, 'Memory: transition journal outstanding').message).toContain('34');
        expect(find(warn, 'Memory: embeddings pending').status).toBe('warning');
        expect(find(warn, 'Memory: embeddings pending').message).toContain('1548');
        expect(find(warn, 'Memory: embeddings pending').message).toContain('450/450');

        const ok = runMemoryAudit({
            nodes: [], souls: [], janitorMetrics: null, now: Date.now(),
            pendingTransitions: 0, pendingEmbeddings: 0, embeddingQuota: null,
        } as any);
        expect(find(ok, 'Memory: transition journal outstanding').status).toBe('ok');
        expect(find(ok, 'Memory: embeddings pending').status).toBe('ok');

        const unknown = runMemoryAudit({
            nodes: [], souls: [], janitorMetrics: null, now: Date.now(),
            pendingTransitions: null, pendingEmbeddings: null, embeddingQuota: null,
        } as any);
        // unreadable must never report as zero
        expect(find(unknown, 'Memory: transition journal outstanding').status).toBe('warning');
        expect(find(unknown, 'Memory: transition journal outstanding').message).toContain('NOT the same as zero');
        expect(find(unknown, 'Memory: embeddings pending').status).toBe('warning');
    });
});
