import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { probeVectorEnvironment, selectVectorEngine, memoryIdToU64, AnnIndex, loadUsearchNative } from '../../services/vectorEngine';

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'ann-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('vector environment probe', () => {
    it('parses cpu flags and fails safe on unreadable cpuinfo', () => {
        const d = dir();
        const withAvx = join(d, 'with');
        writeFileSync(withAvx, 'model name\t: QEMU Virtual CPU\nflags\t\t: fpu sse sse2 avx avx2\n');
        const p1 = probeVectorEnvironment(withAvx);
        expect(p1.cpuModel).toBe('QEMU Virtual CPU');
        expect(p1.avx).toBe(true);
        expect(p1.avx2).toBe(true);
        const without = join(d, 'without');
        writeFileSync(without, 'model name\t: QEMU Virtual CPU version 2.5+\nflags\t\t: fpu sse sse2\n');
        const p2 = probeVectorEnvironment(without);
        expect(p2.avx).toBe(false);
        expect(probeVectorEnvironment(join(d, 'missing')).avx).toBe(false);
    });
});

describe('engine selection', () => {
    const probe = { platform: 'linux', cpuModel: 'x', avx: false, avx2: false, ramTotalMB: 8192, diskFreeMB: 1000 };
    it('honors VECTOR_ENGINE=scan as a forced portable fallback', () => {
        expect(selectVectorEngine({ VECTOR_ENGINE: 'scan' } as any, () => null, probe).kind).toBe('js-scan');
    });
    it('auto-selects usearch native whenever the addon loads, regardless of AVX (runtime dispatch)', () => {
        const fake = { Index: class {} } as any;
        expect(selectVectorEngine({} as any, () => fake, probe).kind).toBe('usearch-native');
    });
    it('falls back to the exact scan when the addon is missing, and fails loudly when usearch was forced', () => {
        expect(selectVectorEngine({} as any, () => null, probe).kind).toBe('js-scan');
        expect(() => selectVectorEngine({ VECTOR_ENGINE: 'usearch' } as any, () => null, probe)).toThrow('usearch');
    });
});

describe('memoryIdToU64', () => {
    it('is deterministic and distinct per id', () => {
        expect(memoryIdToU64('a')).toBe(memoryIdToU64('a'));
        expect(memoryIdToU64('a')).not.toBe(memoryIdToU64('b'));
    });
});

describe('AnnIndex (real USearch native addon)', () => {
    const vec = (x: number, y = 0) => { const v = [x, y, 0, 0]; const n = Math.hypot(...v) || 1; return v.map(c => c / n); };
    const rows = [
        { id: 'm-1', vector: vec(1), ownerId: 'alice' },
        { id: 'm-2', vector: vec(0.9, 0.1), ownerId: 'alice' },
        { id: 'm-3', vector: vec(0, 1), ownerId: 'bob' },
    ];
    const ids = () => rows.map(r => r.id);
    const makeIdx = (name: string, flushMs = 30_000) => {
        const mod = loadUsearchNative();
        if (!mod) throw new Error('usearch native addon required for this test');
        const d = dir();
        const sqlite = new Database(join(d, 'keys.sqlite'));
        return { idx: new AnnIndex({ dir: d, name, dimensions: 4, Index: mod.Index, sqlite, flushMs, probe: { platform: 'linux', cpuModel: 't', avx: false, avx2: false, ramTotalMB: 1, diskFreeMB: null } }), dir: d, sqlite };
    };

    it('rebuilds from the projection, merges pending writes before flush, then persists', async () => {
        const { idx } = makeIdx('t1');
        const report = await idx.open(0, async () => rows, ids);
        expect(report.source).toBe('rebuilt');
        expect(idx.search(vec(1), 3).map(h => h.id)).toEqual(['m-1', 'm-2', 'm-3']);
        // Pending write is searchable BEFORE the index flush (merge with durable log)
        idx.queueUpsert('m-4', 'alice', vec(0.95, 0.05));
        expect(idx.search(vec(1), 4, 'alice').map(h => h.id)).toEqual(['m-1', 'm-4', 'm-2']);
        // Pending delete hides a stale row before flush
        idx.queueRemove('m-2');
        expect(idx.search(vec(1), 4, 'alice').map(h => h.id)).toEqual(['m-1', 'm-4']);
        await idx.flushPending();
        expect(idx.search(vec(1), 4, 'alice').map(h => h.id)).toEqual(['m-1', 'm-4']);
        expect(existsSync(idx.file)).toBe(true);
    });

    it('mmap view survives reopen with matching content; same-count content change rebuilds', async () => {
        const { idx, dir: d } = makeIdx('t2');
        await idx.open(0, async () => rows, ids);
        await idx.flushPending();
        const mod = loadUsearchNative()!;
        // Reopen with identical canonical state -> memory-mapped view, no rebuild
        const again = new AnnIndex({ dir: d, name: 't2', dimensions: 4, Index: mod.Index, sqlite: new Database(join(d, 'keys.sqlite')) });
        expect((await again.open(3, async () => rows, ids)).source).toBe('view');
        // Same-count canonical update (m-3 replaced by m-x while the ANN intent was lost) -> digest mismatch -> rebuild
        const updated = [rows[0], rows[1], { id: 'm-x', vector: vec(0.5, 0.5), ownerId: 'bob' }];
        const third = new AnnIndex({ dir: d, name: 't2', dimensions: 4, Index: mod.Index, sqlite: new Database(join(d, 'keys.sqlite')) });
        const report = await third.open(3, async () => updated, () => updated.map(r => r.id));
        expect(report.source).toBe('rebuilt');
        expect(third.search(vec(0.5, 0.5), 3).map(h => h.id)).toContain('m-x');
        expect(third.search(vec(0.5, 0.5), 3).map(h => h.id)).not.toContain('m-3');
    });

    it('owner scope escalation never starves: owned matches are found even when other owners dominate the top candidates', async () => {
        const { idx } = makeIdx('t3');
        const many: { id: string; vector: number[]; ownerId: string }[] = [];
        for (let i = 0; i < 40; i++) many.push({ id: `bob-${i}`, vector: vec(1 - i * 0.001, i * 0.001), ownerId: 'bob' });
        many.push({ id: 'alice-far', vector: vec(0.2, 0.8), ownerId: 'alice' });
        await idx.open(0, async () => many, () => many.map(r => r.id));
        const hits = idx.search(vec(1), 5, 'alice');
        expect(hits.map(h => h.id)).toEqual(['alice-far']);
    });

    it('mmap view keeps RSS bounded; the write flush spikes transiently around index size (measured)', async () => {
        const mod = loadUsearchNative()!;
        const d = dir();
        const N = 2000;
        const big: { id: string; vector: number[]; ownerId: string }[] = [];
        for (let i = 0; i < N; i++) big.push({ id: `v${i}`, vector: Array.from({ length: 4 }, (_, j) => Math.sin(i + j)), ownerId: 'o' });
        const first = new AnnIndex({ dir: d, name: 't4', dimensions: 4, Index: mod.Index, sqlite: new Database(join(d, 'keys.sqlite')), probe: { platform: 'linux', cpuModel: 't', avx: false, avx2: false, ramTotalMB: 1, diskFreeMB: null } });
        await first.open(0, async () => big, () => big.map(r => r.id));
        const fileMB = statSync(first.file).size / 1e6;
        const viewer = new AnnIndex({ dir: d, name: 't4', dimensions: 4, Index: mod.Index, sqlite: new Database(join(d, 'keys.sqlite')), probe: { platform: 'linux', cpuModel: 't', avx: false, avx2: false, ramTotalMB: 1, diskFreeMB: null } });
        expect((await viewer.open(N, async () => big, () => big.map(r => r.id))).source).toBe('view');
        global.gc?.();
        const rssView = process.memoryUsage().rss / 1e6;
        viewer.queueUpsert('v-new', 'o', vec(0.3, 0.3));
        await viewer.flushPending();
        global.gc?.();
        const rssAfterWrite = process.memoryUsage().rss / 1e6;
        const spike = rssAfterWrite - rssView;
        console.log(`[MEASURE] index=${fileMB.toFixed(1)}MB rssView=${rssView.toFixed(0)}MB rssAfterWrite=${rssAfterWrite.toFixed(0)}MB spike=${spike.toFixed(0)}MB`);
        // Writable copy dropped after flush (probe ramTotalMB=1 forces drop): RSS must stay far below holding the index resident twice.
        expect(spike).toBeLessThan(Math.max(fileMB * 2, 100));
        expect(viewer.search(vec(0.3, 0.3), 3).map(h => h.id)).toContain('v-new');
    }, 180000);

    it('crash mid-flush recovers same-ID vector+owner updates from the journal (fault injection)', async () => {
        const mod = loadUsearchNative()!;
        for (const crashAt of ['after-apply-before-save', 'after-save-before-commit', 'after-commit'] as const) {
            const d = dir();
            const rowsV1 = [
                { id: 'm-1', vector: vec(1), ownerId: 'alice' },
                { id: 'm-2', vector: vec(0, 1), ownerId: 'alice' },
            ];
            const first = new AnnIndex({ dir: d, name: 't6', dimensions: 4, Index: mod.Index, sqlite: new Database(join(d, 'keys.sqlite')) });
            await first.open(0, async () => rowsV1, () => rowsV1.map(r => r.id));
            await first.flushPending();
            // Same-ID update: m-1 changes owner AND vector. The canonical
            // projection will hold v2 after the intent (pending row) lands.
            const second = new AnnIndex({ dir: d, name: 't6', dimensions: 4, Index: mod.Index, sqlite: new Database(join(d, 'keys.sqlite')) });
            await second.open(2, async () => rowsV1, () => rowsV1.map(r => r.id));
            second.queueUpsert('m-1', 'bob', vec(0.1, 0.9));
            AnnIndex.faultHook = (point) => { if (point === crashAt) throw new Error('crash'); };
            // Every fault point kills the flush mid-way; what matters is recovery.
            await expect(second.flushPending()).rejects.toThrow('crash');
            AnnIndex.faultHook = null;
            const rowsV2 = [{ id: 'm-1', vector: vec(0.1, 0.9), ownerId: 'bob' }, rowsV1[1]];
            // Recovery: a fresh process opens the same dir and replays whatever the journal still holds.
            const third = new AnnIndex({ dir: d, name: 't6', dimensions: 4, Index: mod.Index, sqlite: new Database(join(d, 'keys.sqlite')) });
            await third.open(2, async () => rowsV2, () => rowsV2.map(r => r.id));
            // The NEW vector must be the top hit near its neighborhood - the
            // stale pre-flush vector would rank m-2 first (regression signal).
            const hits = third.search(vec(0.1, 0.9), 2);
            expect(hits[0]?.id).toBe('m-1');
            expect(third.search(vec(0.1, 0.9), 2, 'bob').map(h => h.id)).toContain('m-1');
            expect(third.search(vec(0.1, 0.9), 2, 'alice').map(h => h.id)).not.toContain('m-1');
        }
    });

    it('markStale disables the ANN until rebuild clears it', async () => {
        const { idx } = makeIdx('t5');
        await idx.open(0, async () => rows, ids);
        idx.markStale('test');
        expect(idx.isStale()).toBe(true);
        await idx.open(0, async () => rows, ids);
        expect(idx.isStale()).toBe(false);
    });
});
