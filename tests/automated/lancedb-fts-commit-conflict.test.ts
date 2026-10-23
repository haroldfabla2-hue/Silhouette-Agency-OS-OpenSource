import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { LanceDbService } from '../../services/lancedbService';
import { MemoryTier } from '../../types';

/**
 * Prod 2026-10-23 (post-#195): every post-boot "Search failed" was the same
 * retryable lance commit conflict - the lazy FTS createIndex in
 * searchByContent (replace: true) preempted by the periodic compaction
 * Rewrite. Not a stale-handle error, so ftsReady was never set and every
 * content search retried and failed.
 *
 * This test pins the service handle, commits an external compaction
 * (Rewrite), then runs a content search: pre-fix it threw the conflict;
 * post-fix the service rebases onto a fresh handle and the index builds.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lancedb-fts-conflict-'));

function node(id: string) {
    return {
        id,
        content: `needle content ${id}`,
        timestamp: Date.now(),
        tier: MemoryTier.MEDIUM,
        importance: 0.5,
        tags: [] as string[],
        accessCount: 0,
        lastAccess: Date.now()
    } as any;
}

describe('LanceDbService FTS createIndex vs compaction Rewrite', () => {
    afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    it('rebases and builds the FTS index after a retryable commit conflict', async () => {
        const svc = new LanceDbService(tmp);
        await svc.store(node('a'));
        await svc.store(node('b'));

        // External writer commits a compaction (Rewrite) so the cached
        // service handle is pinned to a version with a conflicting commit.
        const db2 = await lancedb.connect(tmp);
        const t2 = await db2.openTable('memory_records_v2');
        await t2.optimize({ cleanupOlderThan: new Date(0), deleteUnverified: false } as any);

        // Content search triggers the lazy FTS createIndex on the pinned
        // handle: must recover via rebase+retry, not fail the search.
        const hits = await svc.searchByContent('needle', 10);
        expect(hits.map(h => h.id).sort()).toEqual(['a', 'b']);

        // A second search uses the now-built index without recreating it.
        const hits2 = await svc.searchByContent('content', 10);
        expect(hits2.length).toBe(2);
    }, 60000);

    it('exhaustion: bounded retries, loud failure, index NEVER marked ready', async () => {
        const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lancedb-fts-exhaust-'));
        try {
            const svc = new LanceDbService(tmp2);
            await svc.store(node('x'));
            const conflict = new Error('lance error: Retryable commit conflict for version 9: This CreateIndex transaction was preempted by concurrent transaction Rewrite at version 9. Please retry.');
            let calls = 0;
            const throwing = async () => { calls++; throw conflict; };
            (svc as any).table.createIndex = throwing;
            // Every rebase (openTable) must also return a failing handle, or
            // the retry path would recover and this test proves nothing.
            const origOpen = (svc as any).db.openTable.bind((svc as any).db);
            (svc as any).db.openTable = async (n: string) => ({ ...(await origOpen(n)), createIndex: throwing });
            await expect(svc.searchByContent('needle', 10)).rejects.toThrow('Retryable commit conflict');
            expect(calls).toBe(3); // bounded: 3 attempts, then the error surfaces loudly
            expect((svc as any).ftsReady.has('v2')).toBe(false); // a failed index is NEVER marked ready
            (svc as any).db.openTable = origOpen; // state stays recoverable: next search retries
        } finally {
            fs.rmSync(tmp2, { recursive: true, force: true });
        }
    }, 60000);
});
