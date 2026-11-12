/**
 * CONTINUOUS MEMORY SERVICE
 * 
 * Provides event-driven memory consolidation with crash recovery.
 * Unlike the existing idle-only consolidation, this service:
 * 
 * 1. Write-Ahead Log (WAL): Before processing any message, saves state
 * 2. Micro-consolidation: After each agent response, persists a summary
 * 3. Crash Recovery: On startup, replays unfinished WAL entries
 * 4. Incremental Flush: Consolidates progressively, not just on idle
 * 
 * Works WITH the existing Continuum memory system, not replacing it.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { agentFileSystem } from '../agents/agentFileSystem';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const WAL_DIR = path.resolve(process.cwd(), 'data', 'wal');
const WAL_FILE = path.join(WAL_DIR, 'memory_wal.json');
const WAL_MAX_ENTRIES = 500; // [FIX 2026-02] Hard cap to prevent unbounded WAL growth

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface WALEntry {
    id: string;
    timestamp: number;
    agentId: string;
    type: 'MESSAGE_RECEIVED' | 'TASK_STARTED' | 'TASK_COMPLETED' | 'SESSION_CREATED' | 'CHECKPOINT';
    data: {
        input?: string;
        output?: string;
        sessionId?: string;
        taskDescription?: string;
        metadata?: Record<string, any>;
    };
    status: 'PENDING' | 'COMMITTED' | 'INTERRUPTED';
    interruption?: { detectedAt: number; reason: string };
}

export interface ConsolidationStats {
    entriesProcessed: number;
    memoriesSaved: number;
    walEntriesCleaned: number;
    lastConsolidation: number;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class ContinuousMemoryService {
    private wal: WALEntry[] = [];
    private stats: ConsolidationStats = {
        entriesProcessed: 0,
        memoriesSaved: 0,
        walEntriesCleaned: 0,
        lastConsolidation: Date.now()
    };
    private consolidationInterval: ReturnType<typeof setInterval> | null = null;
    private initialized = false;
    private closed = false;
    private storageError: Error | null = null;

    /**
     * Initialize the service. Call on system startup.
     * Replays any pending WAL entries from a previous crash.
     */
    public initialize(): void {
        this.assertStorageUsable();
        if (this.initialized) return;
        // Ensure WAL directory exists
        if (!fs.existsSync(WAL_DIR)) {
            fs.mkdirSync(WAL_DIR, { recursive: true });
        }

        // Load existing WAL (crash recovery)
        this.loadWAL();
        const pendingEntries = this.wal.filter(e => e.status === 'PENDING');

        if (pendingEntries.length > 0) {
            console.log(`[CONTINUOUS_MEM] 🔄 Recovering ${pendingEntries.length} pending WAL entries from previous session...`);
            this.replayPendingEntries(pendingEntries);
        }

        this.initialized = true;

        // Start periodic consolidation (every 30 seconds)
        this.consolidationInterval = setInterval(() => {
            try { this.periodicConsolidation(); } catch (error) {
                console.error('[CONTINUOUS_MEM] Consolidation persistence failed; writes blocked:', error);
            }
        }, 30000);

        console.log(`[CONTINUOUS_MEM] ✅ Continuous Memory Service initialized`);
    }

    /**
     * Shutdown cleanly — flush all pending entries.
     */
    public shutdown(): void {
        if (this.closed) return;
        try { this.ensureReady(); } catch (error) {
            if (this.consolidationInterval) clearInterval(this.consolidationInterval);
            this.consolidationInterval = null;
            throw error;
        }
        if (this.consolidationInterval) {
            clearInterval(this.consolidationInterval);
            this.consolidationInterval = null;
        }

        // Shutdown is not evidence of completed processing. Preserve pending
        // payloads synchronously for honest recovery in the next process.
        this.persistWAL();
        this.closed = true;
        console.log(`[CONTINUOUS_MEM] Shutdown persisted; ${this.wal.filter(e => e.status !== 'COMMITTED').length} unfinished entries retained.`);
    }

    // ───────────────────────────────────────────────────────────
    // WRITE-AHEAD LOG
    // ───────────────────────────────────────────────────────────

    /**
     * Log a WAL entry BEFORE processing begins.
     * Returns the entry ID for later commit/rollback.
     */
    public logBeforeProcessing(
        agentId: string,
        type: WALEntry['type'],
        data: WALEntry['data']
    ): string {
        this.ensureReady();
        const previous = [...this.wal];
        const entry: WALEntry = {
            id: `wal-${crypto.randomUUID()}`,
            timestamp: Date.now(),
            agentId,
            type,
            data: JSON.parse(JSON.stringify(data)), // freeze the durable input, not a caller-owned mutable object
            status: 'PENDING'
        };

        if (!this.validRecord(entry)) throw new Error('Invalid WAL entry');
        this.wal.push(entry);

        // [FIX 2026-02] Enforce WAL size cap — evict oldest committed entries first
        if (this.wal.length > WAL_MAX_ENTRIES) {
            const committed = this.wal.filter(e => e.status === 'COMMITTED');
            if (committed.length > 0) {
                const toRemove = committed.slice(0, this.wal.length - WAL_MAX_ENTRIES);
                const removeIds = new Set(toRemove.map(e => e.id));
                this.wal = this.wal.filter(e => !removeIds.has(e.id));
            }
        }

        try { this.persistWAL(); } catch (error) { this.wal = previous; throw error; }

        return entry.id;
    }

    /**
     * Commit a WAL entry after successful processing.
     * This triggers micro-consolidation.
     */
    public commitEntry(walId: string, output?: string, deliveryReceipt?: {id:string;transport:string}): void {
        this.ensureReady();
        const entry = this.wal.find(e => e.id === walId);
        if (!entry) throw new Error(`Unknown WAL entry ${walId}`);
        if (deliveryReceipt && (!deliveryReceipt.id || !deliveryReceipt.transport)) throw new Error('Invalid delivery receipt');
        if (entry.status === 'COMMITTED') {
            if (deliveryReceipt && (entry.data.metadata?.deliveryReceipt?.id !== deliveryReceipt.id || entry.data.metadata?.deliveryReceipt?.transport !== deliveryReceipt.transport)) throw new Error('Conflicting delivery receipt retry');
            if (output !== undefined && output !== entry.data.output) throw new Error('Conflicting WAL commit retry');
            return;
        }
        const previous = JSON.parse(JSON.stringify(entry)) as WALEntry;
        try {
            if (output !== undefined) entry.data.output = output;
            if (deliveryReceipt) entry.data.metadata = {...entry.data.metadata, deliveryReceipt:{...deliveryReceipt}};
            this.microConsolidate(entry);
            entry.status = 'COMMITTED';
            this.persistWAL();
        } catch (error) { Object.assign(entry, previous); throw error; }
    }

    private appendVerified(entry: WALEntry, text: string, kind: 'COMMIT' | 'INTERRUPTION'): void {
        const marker = `<!-- WAL_${kind}:${entry.id} -->`;
        const receipt = `${marker}\n${text}`;
        const before = agentFileSystem.readFile(entry.agentId, 'MEMORY.md');
        if (!before.includes(receipt)) agentFileSystem.appendMemory(entry.agentId, receipt);
        if (!agentFileSystem.readFile(entry.agentId, 'MEMORY.md').includes(receipt)) {
            throw new Error(`WAL memory receipt unverified for ${entry.id}`);
        }
    }

    /** Persist the caller's completion receipt, not independent task correctness. */
    private microConsolidate(entry: WALEntry): void {
        if (entry.type === 'TASK_COMPLETED' || entry.type === 'MESSAGE_RECEIVED') {
            const summary = this.buildMemorySummary(entry);
            if (summary) { this.appendVerified(entry, summary, 'COMMIT'); this.stats.memoriesSaved++; }
        }
        this.stats.entriesProcessed++;
    }

    /**
     * Build a concise memory summary from a WAL entry.
     */
    private buildMemorySummary(entry: WALEntry): string | null {
        switch (entry.type) {
            case 'TASK_COMPLETED':
                const taskDesc = entry.data.taskDescription || 'Unknown task';
                const result = entry.data.output
                    ? (entry.data.output.length > 300 ? entry.data.output.substring(0, 300) + '...' : entry.data.output)
                    : 'No output recorded';
                return `**Task Completed**\nTask: ${taskDesc}\nResult: ${result}`;

            case 'MESSAGE_RECEIVED':
                const input = entry.data.input || 'No input';
                return `**Message Processed**\n${input.length > 200 ? input.substring(0, 200) + '...' : input}${entry.data.metadata?.deliveryReceipt ? `\nDelivery receipt: ${entry.data.metadata.deliveryReceipt.transport}:${entry.data.metadata.deliveryReceipt.id}` : ''}`;

            case 'SESSION_CREATED':
                return `**Session Created**: ${entry.data.sessionId || 'Unknown session'}`;

            default:
                return null;
        }
    }

    // ───────────────────────────────────────────────────────────
    // PERIODIC CONSOLIDATION
    // ───────────────────────────────────────────────────────────

    /**
     * Periodic consolidation (called every 30s).
     * Cleans committed entries from the WAL.
     */
    private periodicConsolidation(): void {
        const committed = this.wal.filter(e => e.status === 'COMMITTED');
        if (committed.length === 0) return;

        // Remove committed entries older than 5 minutes
        const fiveMinAgo = Date.now() - 5 * 60 * 1000;
        const previous = [...this.wal];
        const before = this.wal.length;
        this.wal = this.wal.filter(e => {
            // Keep pending and interrupted entries always
            if (e.status !== 'COMMITTED') return true; // interrupted work is still unresolved
            // Keep recent committed entries (< 5 min old)
            return e.timestamp > fiveMinAgo;
        });

        const cleaned = before - this.wal.length;
        if (cleaned > 0) {
            try { this.persistWAL(); } catch (error) { this.wal = previous; throw error; }
            this.stats.walEntriesCleaned += cleaned;
        }

        this.stats.lastConsolidation = Date.now();
    }

    // ───────────────────────────────────────────────────────────
    // CRASH RECOVERY
    // ───────────────────────────────────────────────────────────

    /**
     * Replay pending WAL entries from a previous session.
     * These represent work that was started but not completed.
     */
    private replayPendingEntries(entries: WALEntry[]): void {
        for (const entry of entries) {
            // A recovery notice is not a task result. Never invent COMMITTED
            // merely because startup noticed unfinished work.
            this.appendVerified(entry,
                `**Interrupted work**: Previous session ended during ${entry.type}. ` +
                `Task: ${entry.data.taskDescription || 'Unknown'}. Not re-executed; completion unverified.`, 'INTERRUPTION');
            entry.status = 'INTERRUPTED';
            entry.interruption = { detectedAt: Date.now(), reason: 'executor ended before a durable commit' };
        }
        this.persistWAL();
    }

    // ───────────────────────────────────────────────────────────
    // WAL PERSISTENCE
    // ───────────────────────────────────────────────────────────

    private assertStorageUsable(): void {
        if (this.storageError) throw this.storageError;
        if (this.closed) throw new Error('Continuous memory is shut down');
    }

    private ensureReady(): void {
        this.assertStorageUsable();
        if (!this.initialized) this.initialize();
    }

    private validRecord(entry: any): entry is WALEntry {
        const base = path.resolve(process.cwd(), 'data', 'agents');
        const agentPath = typeof entry?.agentId === 'string' ? path.resolve(base, entry.agentId) : base;
        return !!entry && typeof entry.id === 'string' && !!entry.id
            && agentPath.startsWith(base + path.sep) && Number.isFinite(entry.timestamp) && entry.timestamp > 0
            && ['MESSAGE_RECEIVED','TASK_STARTED','TASK_COMPLETED','SESSION_CREATED','CHECKPOINT'].includes(entry.type)
            && !!entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)
            && ['PENDING','COMMITTED','INTERRUPTED'].includes(entry.status);
    }

    private loadWAL(): void {
        try {
            if (!fs.existsSync(WAL_FILE)) { this.wal = []; return; }
            const records = JSON.parse(fs.readFileSync(WAL_FILE, 'utf-8'));
            if (!Array.isArray(records) || !records.every(e => this.validRecord(e))
                || new Set(records.map(e => e.id)).size !== records.length) throw new Error('Invalid WAL records');
            this.wal = records;
        } catch (error) {
            this.storageError = error instanceof Error ? error : new Error(String(error));
            console.error('[CONTINUOUS_MEM] WAL unreadable; original preserved and writes refused:', this.storageError);
            throw this.storageError;
        }
    }

    /** Write-ahead means the write is durable before the caller receives its ID.
     * The synchronous API cannot defer durability to a microtask. */
    private persistWAL(): void {
        this.assertStorageUsable();
        const temporary = `${WAL_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
            fs.mkdirSync(WAL_DIR, { recursive: true });
            const fd = fs.openSync(temporary, 'wx', 0o600);
            try { fs.writeFileSync(fd, JSON.stringify(this.wal, null, 2), 'utf8'); fs.fsyncSync(fd); }
            finally { fs.closeSync(fd); }
            fs.renameSync(temporary, WAL_FILE);
            // Directory fsync is supported on POSIX; Windows does not expose
            // an equivalent directory handle through this API.
            if (process.platform !== 'win32') {
                const directory = fs.openSync(WAL_DIR, 'r');
                try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
            }
        } catch (error) {
            this.storageError = error instanceof Error ? error : new Error(String(error));
            throw this.storageError;
        } finally {
            try { fs.unlinkSync(temporary); } catch { /* renamed or failed before creation */ }
        }
    }

    // ───────────────────────────────────────────────────────────
    // STATS
    // ───────────────────────────────────────────────────────────

    public getStats(): ConsolidationStats {
        return { ...this.stats };
    }

    public getWALSize(): number {
        return this.wal.length;
    }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

export const continuousMemory = new ContinuousMemoryService();
