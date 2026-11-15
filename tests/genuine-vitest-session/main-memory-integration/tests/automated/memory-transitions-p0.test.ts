import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTier, type MemoryNode } from '../../types';
import { lancedbService } from '../../services/lancedbService';
import { MemoryTransitions } from '../../services/memoryTransitions';

const source = (id: string): MemoryNode => ({
    id, content: `memory ${id}`, timestamp: 1000, tier: MemoryTier.WORKING,
    importance: 0.5, tags: [], accessCount: 1, lastAccess: 1000
});
const directories: string[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('P0 durable tier transitions', () => {
    async function journal() {
        const dir = await mkdtemp(join(tmpdir(), 'memory-transition-'));
        directories.push(dir);
        return new MemoryTransitions(dir);
    }

    it('retains PENDING source on write failure, then replays one stable ID after restart', async () => {
        const transitions = await journal();
        const original = source('retry-one');
        const destination = { ...original, tier: MemoryTier.MEDIUM };
        const entry = await transitions.begin(original, destination);
        const fail = vi.spyOn(lancedbService, 'store').mockRejectedValueOnce(new Error('disk offline'));
        await expect(transitions.run(entry)).rejects.toThrow('disk offline');
        expect((await transitions.pending())[0]).toMatchObject({ state: 'PENDING', source: original });
        fail.mockRestore();
        // Actual LanceDB: retry and read back from the disk-backed table.
        const replay = await transitions.begin(original, destination);
        expect(replay.key).toBe(entry.key);
        await transitions.run(replay);
        expect((await transitions.pending())[0].state).toBe('VERIFIED');
        await transitions.commit(replay);
        expect((await lancedbService.getNodeById(original.id))?.tier).toBe(MemoryTier.MEDIUM);
        await expect(transitions.commit(replay)).rejects.toThrow('Unverified');
    });

    it('does not commit if the destination cannot be independently read back', async () => {
        const transitions = await journal();
        const original = source('verify-one');
        const entry = await transitions.begin(original, { ...original, tier: MemoryTier.LONG });
        const write = vi.spyOn(lancedbService, 'store').mockResolvedValueOnce({ ok: true, id: original.id, checksum: 'unverified', version: original.timestamp });
        vi.spyOn(lancedbService, 'getNodeById').mockResolvedValueOnce(null);
        await expect(transitions.run(entry)).rejects.toThrow('verification failed');
        write.mockRestore();
        expect((await transitions.pending())[0].state).toBe('WRITTEN');
        const replay = await transitions.begin(original, entry.destination);
        await transitions.run(replay);
        await transitions.commit(replay);
        expect((await lancedbService.getNodeById(original.id))?.tier).toBe(MemoryTier.LONG);
    });

    it('upserts the same ID without duplicates and preserves the prior row on a rejected write', async () => {
        const original = source('atomic-upsert');
        await lancedbService.store(original);
        await lancedbService.store(original);
        const updated = { ...original, content: 'updated memory' };
        await lancedbService.store(updated);
        expect(await lancedbService.getNodeById(original.id)).toEqual(updated);
        await expect(lancedbService.store({ ...updated, content: '' })).rejects.toThrow('Invalid memory');
        expect(await lancedbService.getNodeById(original.id)).toEqual(updated);
    });

    it('rejects a changed payload for the same transition key', async () => {
        const transitions = await journal();
        const original = source('same-key');
        await transitions.begin(original, { ...original, tier: MemoryTier.MEDIUM });
        await expect(transitions.begin(original, { ...original, tier: MemoryTier.MEDIUM, content: 'changed' })).rejects.toThrow('Conflicting transition');
    });
});


describe('transition admission payload ownership (real journal files)', () => {
    async function ownedJournal() {
        const dir = await mkdtemp(join(tmpdir(), 'memory-admission-'));
        directories.push(dir);
        return new MemoryTransitions(dir);
    }

    it('captures typed payload and key before the first begin await without changing legacy JSON', async () => {
        const transitions = await ownedJournal();
        const original = source('capture-key');
        original.embeddingVector = new Float32Array([0.25, 0.5]);
        original.parentIds = ['parent-before'];
        original.embeddingIdentity = { model: 'fixture', version: 'v1', dimension: 2 };
        original.affect = { valence: 0.25, activation: 0.5, at: 1000 };
        original.originalContent = undefined;
        const destination = { ...original, tier: MemoryTier.MEDIUM };
        const expectedSourceJson = JSON.stringify(original);
        const expectedDestinationJson = JSON.stringify(destination);
        const pending = transitions.begin(original, destination);
        original.timestamp = 9000;
        original.tags.push('after-admission');
        original.parentIds.push('parent-after');
        original.embeddingVector[0] = 0.75;
        const entry = await pending;
        expect(entry.source).not.toBe(original);
        expect(entry.source.embeddingVector).toBeInstanceOf(Float32Array);
        expect(entry.destination.embeddingVector).toBeInstanceOf(Float32Array);
        expect(JSON.stringify(entry.source)).toBe(expectedSourceJson);
        expect(JSON.stringify(entry.destination)).toBe(expectedDestinationJson);
        const persisted = (await transitions.pending())[0];
        expect(JSON.stringify(persisted.source)).toBe(expectedSourceJson);
        expect(JSON.stringify(persisted.destination)).toBe(expectedDestinationJson);
        expect(persisted.key).toBe(entry.key);
        expect(persisted.state).toBe('PENDING');
    });

    it('owns Float32Array values even when the declared vector is backed by shared memory', async () => {
        const transitions = await ownedJournal();
        const original = source('capture-shared-vector');
        original.embeddingVector = new Float32Array(new SharedArrayBuffer(8));
        original.embeddingVector.set([0.25, 0.5]);
        const pending = transitions.begin(original, { ...original, tier: MemoryTier.MEDIUM });
        original.embeddingVector[0] = 0.75;
        const entry = await pending;
        expect(entry.source.embeddingVector).toBeInstanceOf(Float32Array);
        expect(entry.source.embeddingVector!.buffer).toBeInstanceOf(ArrayBuffer);
        expect(entry.source.embeddingVector![0]).toBe(0.25);
        expect(entry.destination.embeddingVector![0]).toBe(0.25);
    });

    it('rejects mutation of an admitted public payload before native store and preserves its journal', async () => {
        const transitions = await ownedJournal();
        const original = source('capture-public-entry');
        const entry = await transitions.begin(original, { ...original, tier: MemoryTier.MEDIUM });
        const expected = JSON.stringify((await transitions.pending())[0]);
        entry.source.timestamp = 9000;
        await expect(transitions.run(entry)).rejects.toThrow('Transition payload changed after admission');
        expect(JSON.stringify((await transitions.pending())[0])).toBe(expected);
        expect(entry.state).toBe('PENDING');
    });
});


describe('journal rejection does not publish newer in-memory state (real filesystem/store)', () => {
    async function fixture(id: string) {
        const dir = await mkdtemp(join(tmpdir(), 'memory-state-order-'));
        directories.push(dir);
        const transitions = new MemoryTransitions(dir);
        const original = source(id);
        const entry = await transitions.begin(original, { ...original, tier: MemoryTier.MEDIUM });
        return { dir, transitions, original, entry };
    }

    it('keeps PENDING when destination store succeeds but WRITTEN publication is rejected', async () => {
        const { dir, transitions, original, entry } = await fixture('state-written-rejection');
        const canonical = join(dir, `${entry.key}.json`);
        const prior = await readFile(canonical);
        await rm(canonical);
        await mkdir(canonical); // Actual rename-over-directory failure, not a mocked filesystem error.
        try {
            await expect(transitions.run(entry)).rejects.toThrow();
            expect(entry.state).toBe('PENDING');
            expect(await lancedbService.getNodeById(original.id)).toEqual(entry.destination);
        } finally {
            await rm(canonical, { recursive: true, force: true });
            await writeFile(canonical, prior);
        }
        // Restore only the deliberately obstructed fixture journal, then exercise real replay.
        const reopened = new MemoryTransitions(dir);
        const persisted = (await reopened.pending())[0];
        expect(persisted.state).toBe('PENDING');
        expect(persisted.source).toEqual(original);
        await reopened.resume(persisted);
        expect(persisted.state).toBe('COMMITTED');
        expect((await reopened.pending())[0].state).toBe('COMMITTED');
    });

    it('keeps VERIFIED when COMMITTED publication is rejected and permits explicit replay', async () => {
        const { dir, transitions, original, entry } = await fixture('state-commit-rejection');
        await transitions.run(entry); // Genuine destination store/readback and WRITTEN/VERIFIED journal writes.
        expect(entry.state).toBe('VERIFIED');
        const canonical = join(dir, `${entry.key}.json`);
        const prior = await readFile(canonical);
        await rm(canonical);
        await mkdir(canonical);
        try {
            await expect(transitions.commit(entry)).rejects.toThrow();
            expect(entry.state).toBe('VERIFIED');
            expect(await lancedbService.getNodeById(original.id)).toEqual(entry.destination);
        } finally {
            await rm(canonical, { recursive: true, force: true });
            await writeFile(canonical, prior);
        }
        await transitions.commit(entry);
        expect(entry.state).toBe('COMMITTED');
        expect((await transitions.pending())[0].state).toBe('COMMITTED');
        await expect(transitions.commit(entry)).rejects.toThrow('Unverified');
    });
});
