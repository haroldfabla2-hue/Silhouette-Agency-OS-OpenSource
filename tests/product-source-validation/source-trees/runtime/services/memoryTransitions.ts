import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MemoryNode } from '../types';
import { lancedbService } from './lancedbService';
import { MEMORY_TRANSITIONS_DIR_OVERRIDE } from './memoryStoragePaths';

export type TransitionState = 'PENDING' | 'WRITTEN' | 'VERIFIED' | 'COMMITTED';
export interface MemoryTransition {
    key: string;
    source: MemoryNode;
    destination: MemoryNode;
    state: TransitionState;
}

/** Durable local journal: a failed or interrupted transition always retains its source. */
type LanceLike = Pick<typeof lancedbService, 'store' | 'getNodeById'>;

/** A transition whose journal entry still needs recovery work (periodic reconcile scope). */
export const isOutstandingTransition = (e: MemoryTransition): boolean => e.state !== 'COMMITTED';

export class MemoryTransitions {
    constructor(
        private readonly directory = MEMORY_TRANSITIONS_DIR_OVERRIDE ?? path.join(process.cwd(), 'data', 'memory-transitions'),
        private readonly lance: LanceLike = lancedbService,
    ) { }

    private key(source: MemoryNode, destination: MemoryNode): string {
        return createHash('sha256').update(JSON.stringify([source.id, source.timestamp, source.tier, destination.tier])).digest('hex');
    }

    private file(key: string): string { return path.join(this.directory, `${key}.json`); }

    private async write(entry: MemoryTransition): Promise<void> {
        const firstCreated = await fs.mkdir(this.directory, { recursive: true });
        const file = this.file(entry.key);
        const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
        // Return only after file and containing-directory durability boundaries.
        let directoryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
        let temporaryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
        let created = false;
        let renamed = false;
        let failed = false;
        let primary: unknown;
        const cleanupErrors: unknown[] = [];
        try {
            directoryHandle = await fs.open(this.directory, 'r');
            // Recursive mkdir may create several directory entries. Persist
            // each child before its parent, including the parent of the first
            // created directory. A leaf-only sync would not cover that chain.
            if (firstCreated !== undefined) {
                await directoryHandle.sync();
                const stop = path.dirname(path.resolve(firstCreated));
                let current = path.dirname(path.resolve(this.directory));
                for (;;) {
                    const parentHandle = await fs.open(current, 'r');
                    let syncFailed = false;
                    let syncFailure: unknown;
                    try { await parentHandle.sync(); }
                    catch (error) { syncFailed = true; syncFailure = error; }
                    try { await parentHandle.close(); }
                    catch (error) {
                        if (syncFailed) {
                            throw Object.assign(new Error('Transition directory sync and close failed', { cause: syncFailure }), { cleanupErrors: [error] });
                        }
                        throw error;
                    }
                    if (syncFailed) throw syncFailure;
                    if (current === stop) break;
                    const parent = path.dirname(current);
                    if (parent === current) throw new Error('Transition directory creation ancestry mismatch');
                    current = parent;
                }
            }
            temporaryHandle = await fs.open(temporary, 'wx', 0o600);
            created = true;
            await temporaryHandle.writeFile(JSON.stringify(entry), 'utf8');
            await temporaryHandle.sync();
            // Do not retry close on a descriptor the OS might have released.
            const written = temporaryHandle;
            temporaryHandle = undefined;
            await written.close();
            await fs.rename(temporary, file);
            renamed = true;
            await directoryHandle.sync();
        } catch (error) {
            failed = true;
            primary = error;
        } finally {
            if (temporaryHandle) {
                const handle = temporaryHandle;
                temporaryHandle = undefined;
                try { await handle.close(); } catch (error) { cleanupErrors.push(error); }
            }
            if (created && !renamed) {
                try { await fs.rm(temporary, { force: true }); } catch (error) { cleanupErrors.push(error); }
            }
            if (directoryHandle) {
                const handle = directoryHandle;
                directoryHandle = undefined;
                try { await handle.close(); } catch (error) { cleanupErrors.push(error); }
            }
        }
        if (failed) {
            if (cleanupErrors.length) {
                throw Object.assign(new Error('Transition journal publication and cleanup failed', { cause: primary }), { cleanupErrors });
            }
            throw primary;
        }
        if (cleanupErrors.length) {
            throw Object.assign(new Error('Transition journal cleanup failed', { cause: cleanupErrors[0] }), { cleanupErrors });
        }
    }

    public async begin(source: MemoryNode, destination: MemoryNode): Promise<MemoryTransition> {
        if (source.id !== destination.id) throw new Error('A tier transition must preserve the memory ID');
        const key = this.key(source, destination);
        try {
            const entry = JSON.parse(await fs.readFile(this.file(key), 'utf8')) as MemoryTransition;
            if (JSON.stringify(entry.destination) !== JSON.stringify(destination)) {
                // [PR-4b] Divergence limited to volatile metadata (tags/access counters)
                // is the prod case: concurrent promoters (EVICTED vs CONSOLIDATED vs
                // plain) race the same node. The journaled transition is durable and
                // replay is idempotent, so adopt it and continue loudly instead of
                // throwing into an unhandled rejection (prod FATAL x33). A divergence
                // in real content still rejects (P0 tamper contract kept).
                const volatile = ({ accessCount, lastAccess, tags, ...rest }: any) => rest;
                if (JSON.stringify(volatile(entry.destination)) !== JSON.stringify(volatile(destination))) {
                    throw new Error(`Conflicting transition for ${source.id}`);
                }
                console.warn(`[MEMORY_TRANSITIONS] Volatile-only conflict for ${source.id}; adopting journaled transition ${entry.key} (divergent metadata dropped).`);
            }
            return entry;
        } catch (error: any) {
            if (error.code !== 'ENOENT') throw error;
        }
        const entry: MemoryTransition = { key, source, destination, state: 'PENDING' };
        await this.write(entry);
        return entry;
    }

    public async run(entry: MemoryTransition): Promise<MemoryTransition> {
        if (entry.state === 'COMMITTED') return entry;
        // Replay is safe: LanceDB's merge by ID is atomic and idempotent.
        await this.lance.store(entry.destination);
        await this.write({ ...entry, state: 'WRITTEN' });
        entry.state = 'WRITTEN';
        const stored = await this.lance.getNodeById(entry.destination.id);
        if (JSON.stringify(stored) !== JSON.stringify(entry.destination)) {
            throw new Error(`Destination verification failed for ${entry.destination.id}`);
        }
        await this.write({ ...entry, state: 'VERIFIED' });
        entry.state = 'VERIFIED';
        return entry;
    }

    private chains = new Map<string, Promise<unknown>>();

    private enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.chains.get(id) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        // The stored chain must survive individual failures so later work is not blocked.
        this.chains.set(id, next.catch(() => undefined));
        return next;
    }

    /**
     * [PR-4b] Serialized begin -> run -> commit per memory id. Concurrent promoters
     * of the same node used to interleave journal reads/writes and crash the process
     * with an unhandled 'Conflicting transition' rejection.
     */
    public async transition(source: MemoryNode, destination: MemoryNode): Promise<void> {
        return this.enqueue(source.id, async () => {
            const entry = await this.begin(source, destination);
            await this.run(entry);
            await this.commit(entry);
        });
    }

    /** [PR-4b] Crash-recovery replay, serialized against live transitions of the same id. */
    public async resume(entry: MemoryTransition): Promise<void> {
        return this.enqueue(entry.source.id, async () => {
            await this.run(entry);
            await this.commit(entry);
        });
    }

    public async commit(entry: MemoryTransition): Promise<void> {
        if (entry.state !== 'VERIFIED') throw new Error(`Unverified transition: ${entry.key}`);
        await this.write({ ...entry, state: 'COMMITTED' });
        entry.state = 'COMMITTED';
    }

    public async pending(): Promise<MemoryTransition[]> {
        let names: string[];
        try {
            names = await fs.readdir(this.directory);
        } catch (error: any) {
            // Only an absent directory means an empty journal. A disappeared
            // entry after enumeration is unknown recovery state, never empty.
            if (error.code === 'ENOENT') return [];
            throw error;
        }
        return await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
            try {
                return JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8'));
            } catch (cause) {
                throw new Error(`Cannot read transition entry ${name}`, { cause });
            }
        }));
    }
}

export const memoryTransitions = new MemoryTransitions();
