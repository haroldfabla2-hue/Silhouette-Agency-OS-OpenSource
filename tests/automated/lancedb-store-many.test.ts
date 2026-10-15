/**
 * LanceDbService.storeMany — bulk seed/import path.
 * One merge transaction for the batch, same refusal rules and writeQueue
 * serialization as store(); read-back spot check on batch edges.
 * Hermetic: real LanceDbService on a tmp dir, no network.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { MemoryTier, type MemoryNode } from '../../types';
import { LanceDbService } from '../../services/lancedbService';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const fresh = async () => { const dir = await mkdtemp(join(tmpdir(), 'store-many-')); dirs.push(dir); return new LanceDbService(dir); };
const node = (id: string, content = 'bulk memory'): MemoryNode => ({ id, content, timestamp: 1000, tier: MemoryTier.MEDIUM, importance: 0.5, tags: [], accessCount: 0, lastAccess: 1000 });

describe('LanceDbService.storeMany', () => {
    it('stores a batch in one call and every row is retrievable', async () => {
        const db = await fresh();
        const nodes = Array.from({ length: 25 }, (_, i) => node(`bulk-${i}`));
        const result = await db.storeMany(nodes);
        expect(result).toEqual({ ok: true, count: 25 });
        const hit = await db.searchByContent('bulk memory', 50);
        expect(hit.length).toBe(25);
        expect((await db.getNodeById('bulk-7'))?.content).toBe('bulk memory');
    });

    it('accepts an empty batch as a no-op', async () => {
        const db = await fresh();
        await expect(db.storeMany([])).resolves.toEqual({ ok: true, count: 0 });
    });

    it('refuses invalid nodes before touching the table', async () => {
        const db = await fresh();
        await expect(db.storeMany([node('ok-1'), node('bad', '')])).rejects.toThrow('Invalid');
        await expect(db.storeMany([{ ...node('undef'), content: 'undefined' }])).rejects.toThrow('Invalid');
        // Nothing was written: the whole batch is validated first
        expect(await db.getNodeById('ok-1')).toBeNull();
    });

    it('merges on id: re-seeding updates instead of duplicating', async () => {
        const db = await fresh();
        await db.storeMany([node('dup-1', 'version one'), node('dup-2', 'other row')]);
        await db.storeMany([node('dup-1', 'version two')]);
        const stored = await db.getNodeById('dup-1');
        expect(stored?.content).toBe('version two');
        const all = await db.searchByContent('version', 50);
        expect(all.filter(n => n.id === 'dup-1').length).toBe(1);
    });
});
