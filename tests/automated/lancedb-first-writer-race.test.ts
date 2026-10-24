/**
 * Root-cause guard: two INDEPENDENT LanceDbService instances pointed at the
 * SAME fresh database directory are concurrent first writers. The per-instance
 * writeQueue cannot serialize across instances, so both entered the
 * check-then-create block, both saw an empty tableNames() and both issued
 * createTable('memory_records_v2') - the loser was rejected with
 * 'already exists' and its write was refused (a real refused write on a fresh
 * DB, e.g. two boot consumers racing first persistence).
 *
 * Fix under test: module-scoped single-flight keyed by dbPath+table, with an
 * atomic create-or-open backstop that converts ONLY the specific
 * 'already exists' outcome into openTable (every other error propagates), so
 * both writers durably persist. Cross-process coverage is NOT claimed here:
 * this suite exercises one process, two real instances, one real DB.
 *
 * DECLARED BOUNDARY (not fixed here, out of the authorized scope): after the
 * race resolves, the winner instance's cached table handle predates the
 * follower's merge commit, so winner-side reads can miss the follower's row
 * until a reopen (a miss returns [] and never throws, so the existing
 * stale-handle reopen path does not fire). Durable visibility is what this
 * suite asserts (fresh instance / restart read everything). Prod runs a
 * single module-singleton instance today, so cross-instance reads are not
 * prod-reachable; a read-miss reopen retry is a separable candidate.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LanceDbService } from '../../services/lancedbService';
import { MemoryTier, type MemoryNode } from '../../types';

const dirs: string[] = [];
const freshDir = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lance-first-writer-'));
    dirs.push(dir);
    return dir;
};
afterEach(async () => {
    await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

const makeNode = (id: string): MemoryNode => ({
    id,
    content: `first-writer race node ${id}`,
    timestamp: Date.now(),
    tier: MemoryTier.WORKING,
    importance: 0.5,
    tags: ['first-writer-race'],
    accessCount: 0,
    lastAccess: Date.now(),
});

describe('LanceDB first-writer race (cross-instance, fresh DB)', () => {
    it('two concurrent first writers through separate instances both persist, creating exactly one table', async () => {
        const dir = await freshDir();
        const svcA = new LanceDbService(dir);
        const svcB = new LanceDbService(dir);

        const [ra, rb] = await Promise.all([
            svcA.store(makeNode('race-a')),
            svcB.store(makeNode('race-b')),
        ]);
        expect(ra.ok).toBe(true);
        expect(rb.ok).toBe(true);

        // Each instance reads its OWN row. Cross-instance read-through of the
        // other writer's row is NOT asserted here: the winner's cached handle
        // predates the follower's commit and can miss it (declared boundary -
        // see header). Durable visibility is asserted via a fresh instance.
        expect((await svcA.getNodeById('race-a'))?.id).toBe('race-a');
        expect((await svcB.getNodeById('race-b'))?.id).toBe('race-b');
        const freshReader = new LanceDbService(dir);
        expect((await freshReader.getNodeById('race-a'))?.id).toBe('race-a');
        expect((await freshReader.getNodeById('race-b'))?.id).toBe('race-b');

        // Exactly one table was created on disk.
        const entries = await readdir(dir);
        expect(entries.filter(e => e.startsWith('memory_records_v2')).length).toBe(1);
    });

    it('single + bulk first writers through separate instances both persist', async () => {
        const dir = await freshDir();
        const svcA = new LanceDbService(dir);
        const svcB = new LanceDbService(dir);

        const [rSingle, rBulk] = await Promise.all([
            svcA.store(makeNode('race-single')),
            svcB.storeMany([makeNode('race-bulk-1'), makeNode('race-bulk-2')]),
        ]);
        expect(rSingle.ok).toBe(true);
        expect(rBulk).toEqual({ ok: true, count: 2 });

        expect((await svcA.getNodeById('race-single'))?.id).toBe('race-single');
        const freshReader = new LanceDbService(dir);
        for (const id of ['race-single', 'race-bulk-1', 'race-bulk-2']) {
            expect((await freshReader.getNodeById(id))?.id).toBe(id);
        }
    });

    it('the original first writer reads BOTH rows after the race (coherent cross-instance read, no silent miss)', async () => {
        const dir = await freshDir();
        const svcA = new LanceDbService(dir);
        const svcB = new LanceDbService(dir);
        await Promise.all([
            svcA.store(makeNode('coh-a')),
            svcB.store(makeNode('coh-b')),
        ]);
        // Whichever instance won the create race must still observe the
        // follower's later commit; a cached-handle miss here was the residual
        // gap the freshness epoch closes.
        for (const svc of [svcA, svcB]) {
            expect((await svc.getNodeById('coh-a'))?.id).toBe('coh-a');
            expect((await svc.getNodeById('coh-b'))?.id).toBe('coh-b');
        }
    });

    it('sequential cross-instance writes stay readable from the first instance (epoch-triggered single reopen)', async () => {
        const dir = await freshDir();
        const svcA = new LanceDbService(dir);
        const svcB = new LanceDbService(dir);
        await svcA.store(makeNode('seq-a1'));
        await svcA.store(makeNode('seq-a2')); // same-instance writes: no reopen needed
        await svcB.store(makeNode('seq-b1')); // external write bumps the epoch
        expect((await svcA.getNodeById('seq-a1'))?.id).toBe('seq-a1');
        expect((await svcA.getNodeById('seq-a2'))?.id).toBe('seq-a2');
        expect((await svcA.getNodeById('seq-b1'))?.id).toBe('seq-b1');
        expect((await svcB.getNodeById('seq-a2'))?.id).toBe('seq-a2');
    });

    it('rows written by racing first writers survive a restart (new instance reopens the table)', async () => {
        const dir = await freshDir();
        const svcA = new LanceDbService(dir);
        const svcB = new LanceDbService(dir);
        await Promise.all([
            svcA.store(makeNode('race-r1')),
            svcB.store(makeNode('race-r2')),
        ]);

        // Simulated restart: brand-new instance over the same on-disk DB.
        const restarted = new LanceDbService(dir);
        expect((await restarted.getNodeById('race-r1'))?.id).toBe('race-r1');
        expect((await restarted.getNodeById('race-r2'))?.id).toBe('race-r2');
    });
});
