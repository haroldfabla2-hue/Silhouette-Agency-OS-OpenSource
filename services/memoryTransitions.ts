import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MemoryNode } from '../types';
import { lancedbService } from './lancedbService';

export type TransitionState = 'PENDING' | 'WRITTEN' | 'VERIFIED' | 'COMMITTED';
export interface MemoryTransition {
    key: string;
    source: MemoryNode;
    destination: MemoryNode;
    state: TransitionState;
}

/** Durable local journal: a failed or interrupted transition always retains its source. */
export class MemoryTransitions {
    constructor(private readonly directory = path.join(process.cwd(), 'data', 'memory-transitions')) { }

    private key(source: MemoryNode, destination: MemoryNode): string {
        return createHash('sha256').update(JSON.stringify([source.id, source.timestamp, source.tier, destination.tier])).digest('hex');
    }

    private file(key: string): string { return path.join(this.directory, `${key}.json`); }

    private async write(entry: MemoryTransition): Promise<void> {
        await fs.mkdir(this.directory, { recursive: true });
        const file = this.file(entry.key);
        const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, JSON.stringify(entry));
            await fs.rename(temporary, file);
        } finally {
            await fs.rm(temporary, { force: true });
        }
    }

    public async begin(source: MemoryNode, destination: MemoryNode): Promise<MemoryTransition> {
        if (source.id !== destination.id) throw new Error('A tier transition must preserve the memory ID');
        const key = this.key(source, destination);
        try {
            const entry = JSON.parse(await fs.readFile(this.file(key), 'utf8')) as MemoryTransition;
            if (JSON.stringify(entry.destination) !== JSON.stringify(destination)) {
                // [PR-4b] Same source state, divergent destination wish (e.g. different
                // tag sets from concurrent promoters). The journaled transition is
                // durable and replay is idempotent, so adopt it and continue loudly
                // instead of throwing into an unhandled rejection (prod FATAL x33).
                console.warn(`[MEMORY_TRANSITIONS] Conflicting destination for ${source.id}; adopting journaled transition ${entry.key} (divergent wish dropped).`);
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
        await lancedbService.store(entry.destination);
        entry.state = 'WRITTEN';
        await this.write(entry);
        const stored = await lancedbService.getNodeById(entry.destination.id);
        if (JSON.stringify(stored) !== JSON.stringify(entry.destination)) {
            throw new Error(`Destination verification failed for ${entry.destination.id}`);
        }
        entry.state = 'VERIFIED';
        await this.write(entry);
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
        entry.state = 'COMMITTED';
        await this.write(entry);
    }

    public async pending(): Promise<MemoryTransition[]> {
        try {
            const names = (await fs.readdir(this.directory)).filter(n => n.endsWith('.json'));
            return await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8'))));
        } catch (error: any) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    }
}

export const memoryTransitions = new MemoryTransitions();
