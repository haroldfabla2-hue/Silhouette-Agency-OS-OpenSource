import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { LanceDbService } from '../../services/lancedbService';
import { MemoryTier } from '../../types';

/**
 * Prod incident 2026-10-23: the periodic optimizer compacted the canonical
 * table and immediately deleted every unreferenced fragment file
 * (cleanupOlderThan was '2999-01-01', a delete-everything threshold). Every
 * cached table handle stayed pinned to a pre-compaction version, so each
 * mergeInsert / full scan through the running service failed with
 * LanceError(IO) "Not found" until the next process restart.
 *
 * This test rebuilds that exact state on a real LanceDB directory:
 * cached service handle -> external compaction -> old fragments gone.
 * A raw stale handle must fail (failure mode reproduced); the service must
 * reopen and succeed (fix verified).
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lancedb-stale-handle-'));
const DATA_DIR = path.join(tmp, 'memory_records_v2.lance', 'data');

function node(id: string) {
    return {
        id,
        content: `memory ${id}`,
        timestamp: Date.now(),
        tier: MemoryTier.MEDIUM,
        importance: 0.5,
        tags: [] as string[],
        accessCount: 0,
        lastAccess: Date.now()
    } as any;
}

function rawRecord(id: string) {
    return {
        id,
        embedding_state: 'EMBEDDING_PENDING',
        content: `memory ${id}`,
        originalContent: '',
        tags: [''],
        importance: 0.5,
        timestamp: Date.now(),
        tier: 'MEDIUM',
        ownerId: 'system',
        accessCount: 0,
        lastAccess: Date.now(),
        stabilityScore: 0,
        json_data: JSON.stringify({ id, content: `memory ${id}` })
    };
}

describe('LanceDbService stale table handle recovery', () => {
    afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    it('reopens a handle pinned before compaction instead of failing until restart', async () => {
        const svc = new LanceDbService(tmp);
        await svc.store(node('a'));

        const fragmentsBefore = new Set(fs.readdirSync(DATA_DIR));
        expect(fragmentsBefore.size).toBeGreaterThan(0);

        // External writer: several commits so compaction has fragments to merge.
        const db2 = await lancedb.connect(tmp);
        const t2 = await db2.openTable('memory_records_v2');
        const staleRaw = await db2.openTable('memory_records_v2'); // pinned pre-compaction
        await t2.add([rawRecord('b1')]);
        await t2.add([rawRecord('b2')]);
        await t2.add([rawRecord('b3')]);
        // Same immediate cleanup the old prod constant produced.
        await t2.optimize({ cleanupOlderThan: new Date('2999-01-01'), deleteUnverified: false });

        // Prod end state: files the pre-compaction version referenced are gone.
        // Delete them explicitly as well, so the test does not depend on the
        // binding's cleanup timing.
        const afterOptimize = new Set(fs.readdirSync(DATA_DIR));
        const rewritten = [...afterOptimize].filter(f => !fragmentsBefore.has(f));
        expect(rewritten.length).toBeGreaterThan(0); // compaction actually rewrote fragments
        for (const f of afterOptimize) {
            if (fragmentsBefore.has(f)) fs.rmSync(path.join(DATA_DIR, f), { force: true });
        }

        // Failure mode reproduced: a stale pinned handle cannot merge.
        await expect(
            staleRaw.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([rawRecord('c')])
        ).rejects.toThrow(/LanceError\(IO\)|Not found/);

        // Fix verified: the service reopens and completes the same operation.
        await svc.store(node('d'));
        const stored = await svc.getNodeById('d');
        expect(stored?.id).toBe('d');

        // Full scans self-heal too (getAllNodes was the other prod failure).
        const all = await svc.getAllNodes();
        expect(all.some(n => n.id === 'd')).toBe(true);
        expect(all.some(n => n.id === 'a')).toBe(true);
    }, 90000);

    it('optimize with the never-prune threshold compacts without deleting any version or fragment', async () => {
        const svc = new LanceDbService(tmp);
        await svc.store(node('n1'));

        const db2 = await lancedb.connect(tmp);
        const t2 = await db2.openTable('memory_records_v2');
        const pinned = await db2.openTable('memory_records_v2'); // handle pinned pre-compaction
        await t2.add([rawRecord('n2')]);
        await t2.add([rawRecord('n3')]);

        const versionsBefore = (await t2.listVersions()).length;
        const fragmentsBefore = new Set(fs.readdirSync(DATA_DIR));

        // The exact call the fixed service loop makes (epoch threshold = prune nothing).
        await t2.optimize({ cleanupOlderThan: new Date(0), deleteUnverified: false });

        // Compaction happened (fragments were rewritten into new files)...
        const fragmentsAfter = new Set(fs.readdirSync(DATA_DIR));
        expect([...fragmentsAfter].some(f => !fragmentsBefore.has(f))).toBe(true);
        // ...but no old fragment was deleted...
        for (const f of fragmentsBefore) expect(fragmentsAfter.has(f)).toBe(true);
        // ...and no version manifest was pruned.
        const versionsAfter = (await t2.listVersions()).length;
        expect(versionsAfter).toBeGreaterThanOrEqual(versionsBefore);

        // A handle pinned before compaction still works without any reopen,
        // because the files its version references still exist.
        await pinned.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([rawRecord('n4')]);
        const check = await pinned.query().where("id = 'n4'").limit(1).toArray();
        expect(check.length).toBe(1);
    }, 90000);
});
