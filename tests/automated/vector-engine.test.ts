import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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
        expect(p2.avx2).toBe(false);
        expect(probeVectorEnvironment(join(d, 'missing')).avx).toBe(false);
    });
});

describe('engine selection', () => {
    const probe = { platform: 'linux', cpuModel: 'x', avx: false, avx2: false, ramTotalMB: 8192, diskFreeMB: 1000 };
    it('honors VECTOR_ENGINE=scan as a forced portable fallback', () => {
        const s = selectVectorEngine({ VECTOR_ENGINE: 'scan' } as any, () => null, probe);
        expect(s.kind).toBe('js-scan');
        expect(s.reason).toContain('forced');
    });
    it('auto-selects usearch native whenever the addon loads, regardless of AVX (runtime dispatch)', () => {
        const fake = { Index: class {} } as any;
        const s = selectVectorEngine({} as any, () => fake, probe);
        expect(s.kind).toBe('usearch-native');
        expect(s.reason).toContain('runtime CPU dispatch');
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
        expect(typeof memoryIdToU64('a')).toBe('bigint');
    });
});

describe('AnnIndex (real USearch native addon)', () => {
    const vec = (x: number) => { const v = new Array(4).fill(0); v[0] = x; v[1] = 1 - x; return v; };
    const makeIdx = (name: string) => {
        const mod = loadUsearchNative();
        if (!mod) throw new Error('usearch native addon required for this test');
        const d = dir();
        const sqlite = new Database(join(d, 'keys.sqlite'));
        return new AnnIndex({ dir: d, name, dimensions: 4, Index: mod.Index, sqlite, flushMs: 1 });
    };
    const rows = [
        { id: 'm-1', vector: vec(1), ownerId: 'alice' },
        { id: 'm-2', vector: vec(0.9), ownerId: 'alice' },
        { id: 'm-3', vector: vec(0), ownerId: 'bob' },
    ];

    it('rebuilds from the projection, searches by owner scope, persists and memory-maps on reopen', async () => {
        const idx = makeIdx('t1');
        const report = await idx.open(0, async () => rows);
        expect(report.source).toBe('rebuilt');
        expect(idx.size()).toBe(3);
        expect(idx.search(vec(1), 3)).toEqual(['m-1', 'm-2', 'm-3']);
        expect(idx.search(vec(1), 3, 'alice')).toEqual(['m-1', 'm-2']);
        idx.flush();
        expect(existsSync(idx.file)).toBe(true);
    });

    it('upsert and remove keep index and key map consistent', async () => {
        const idx = makeIdx('t2');
        await idx.open(0, async () => rows);
        idx.upsert('m-4', 'alice', vec(0.95));
        expect(idx.search(vec(1), 4, 'alice')).toEqual(['m-1', 'm-4', 'm-2']);
        idx.remove('m-4');
        expect(idx.search(vec(1), 4, 'alice')).toEqual(['m-1', 'm-2']);
    });

    it('detects count mismatch against the projection and rebuilds', async () => {
        const idx = makeIdx('t3');
        await idx.open(0, async () => rows);
        idx.flush();
        const d = (idx as any).opts.dir;
        const mod = loadUsearchNative()!;
        const sqlite = new Database(join(d, 'keys.sqlite'));
        const reopened = new AnnIndex({ dir: d, name: 't3', dimensions: 4, Index: mod.Index, sqlite, flushMs: 1 });
        const report = await reopened.open(3, async () => rows); // projection says 3, index has 3 -> view
        expect(report.source).toBe('view');
        const stale = new AnnIndex({ dir: d, name: 't3', dimensions: 4, Index: mod.Index, sqlite: new Database(join(d, 'keys.sqlite')), flushMs: 1 });
        const report2 = await stale.open(4, async () => [...rows, { id: 'm-4', vector: vec(0.5), ownerId: 'bob' }]); // projection grew -> rebuild
        expect(report2.source).toBe('rebuilt');
        expect(stale.size()).toBe(4);
    });
});
