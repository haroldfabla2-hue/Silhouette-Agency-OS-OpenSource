import fs from 'node:fs';
import path from 'node:path';

export type PendingNarration = { id: string; source: string; content: string; importance: number; metadata?: unknown };
// JSON must preserve the work exactly. Do not silently drop functions,
// undefined nested fields, nonfinite numbers, cycles, or class instances.
function assertJson(value: unknown, seen = new Set<object>()): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || seen.has(value)) throw new Error('NARRATIVE_PENDING_NOT_JSON');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('NARRATIVE_PENDING_NOT_PLAIN');
    if (Reflect.ownKeys(value).some(k => typeof k === 'symbol')) throw new Error('NARRATIVE_PENDING_SYMBOL');
    if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new Error('NARRATIVE_PENDING_SPARSE');
    if (Object.values(Object.getOwnPropertyDescriptors(value)).some(d => 'get' in d || 'set' in d)) throw new Error('NARRATIVE_PENDING_ACCESSOR');
    seen.add(value);
    for (const item of Object.values(value)) assertJson(item, seen);
    seen.delete(value);
}
// One owner per canonical directory, including independent processes. Never
// infer that an existing lock is stale from PID/age. Crash leaves a lock that
// needs explicit operator recovery, preserving both original journal and lock.
const processLocks = new Map<string, { dev: number; ino: number }>();
process.once('exit', () => {
    for (const [lock, owned] of processLocks) {
        try {
            const current = fs.lstatSync(lock);
            if (current.isDirectory() && current.dev === owned.dev && current.ino === owned.ino) fs.rmdirSync(lock);
        } catch { /* preserve unknown/replaced/nonempty locks */ }
    }
});
export class NarrativePendingStore {
    readonly file: string;
    private loaded = false;
    private blocked = false;
    // No retention deletion is authorized. Completed originals/results are
    // retained without a cap, as before in this candidate. Disk/load cost grows;
    // a retention/archive decision remains open, not silently inferred here.
    private completed: Array<{ item: PendingNarration; narrated: string }> = [];
    constructor(directory: string) { this.file = path.join(directory, 'pending-narrations.json'); }
    load(): PendingNarration[] {
        if (this.blocked) throw new Error('NARRATIVE_PENDING_BLOCKED');
        try { const items = this.read(); this.loaded = true; return items; }
        catch (error) { this.blocked = true; throw error; }
    }
    private assertOwnership(): void {
        const directory = path.dirname(this.file);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const lock = path.join(fs.realpathSync(directory), '.pending-narrations.owner');
        const owned = processLocks.get(lock);
        if (owned) {
            const current = fs.lstatSync(lock);
            if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino) throw new Error('NARRATIVE_OWNER_CHANGED');
            return;
        }
        try { fs.mkdirSync(lock, { mode: 0o700 }); }
        catch { throw new Error('NARRATIVE_OWNER_UNAVAILABLE'); }
        const stat = fs.lstatSync(lock);
        processLocks.set(lock, { dev: stat.dev, ino: stat.ino });
    }
    private read(): PendingNarration[] {
        this.assertOwnership();
        if (!fs.existsSync(this.file)) return [];
        const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (value?.version !== 1 || !Array.isArray(value.items)) throw new Error('NARRATIVE_PENDING_INVALID');
        const ids = new Set<string>();
        for (const item of value.items) {
            if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)
                || typeof item.source !== 'string' || typeof item.content !== 'string'
                || typeof item.importance !== 'number' || !Number.isFinite(item.importance)) throw new Error('NARRATIVE_PENDING_INVALID');
            assertJson(item);
            ids.add(item.id);
        }
        if (value.completed !== undefined) {
            if (!Array.isArray(value.completed) || value.completed.some((entry: any) =>
                !entry || typeof entry.narrated !== 'string' || typeof entry.item?.id !== 'string')) throw new Error('NARRATIVE_COMPLETED_INVALID');
            assertJson(value.completed);
            this.completed = value.completed;
        }
        return value.items;
    }
    // Ack is a single atomic journal transition: retain the original work AND
    // full provider result durably before removing it from the pending set.
    // Emission can repeat after a crash before this transition (at-least-once).
    complete(batch: PendingNarration[], outputs: string[], remaining: PendingNarration[]): void {
        if (batch.length !== outputs.length || outputs.some(v => typeof v !== 'string' || !v)) throw new Error('NARRATIVE_ACK_INVALID');
        if (!this.loaded) this.load();
        const before = this.completed;
        const ids = new Set(batch.map(item => item.id));
        this.completed = [...before.filter(entry => !ids.has(entry.item.id)), ...batch.map((item, i) => ({ item, narrated: outputs[i] }))];
        try { this.save(remaining); }
        catch (error) { this.completed = before; throw error; }
    }
    // Atomic replacement + fsync file and POSIX directory. Original bytes stay
    // untouched until rename. Windows has no equivalent directory fsync here;
    // that weaker power-loss guarantee is explicit in the stop receipt.
    save(items: PendingNarration[]): void {
        if (this.blocked) throw new Error('NARRATIVE_PENDING_BLOCKED');
        this.assertOwnership();
        if (!this.loaded) this.load();
        assertJson(items);
        assertJson(this.completed);
        const bytes = JSON.stringify({ version: 1, items, completed: this.completed });
        const directory = path.dirname(this.file);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
            const fd = fs.openSync(temporary, 'wx', 0o600);
            try { fs.writeFileSync(fd, bytes, 'utf8'); fs.fsyncSync(fd); }
            finally { fs.closeSync(fd); }
            fs.renameSync(temporary, this.file);
            if (process.platform !== 'win32') {
                const dir = fs.openSync(directory, 'r');
                try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
            }
        } finally {
            // Only our temporary file. Never delete the pending journal.
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }
}
