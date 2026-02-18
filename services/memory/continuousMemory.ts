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
import { agentFileSystem } from '../agents/agentFileSystem';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const WAL_DIR = path.resolve(process.cwd(), 'data', 'wal');
const WAL_FILE = path.join(WAL_DIR, 'memory_wal.json');

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
    status: 'PENDING' | 'COMMITTED';
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

    /**
     * Initialize the service. Call on system startup.
     * Replays any pending WAL entries from a previous crash.
     */
    public initialize(): void {
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

        // Start periodic consolidation (every 30 seconds)
        this.consolidationInterval = setInterval(() => {
            this.periodicConsolidation();
        }, 30000);

        console.log(`[CONTINUOUS_MEM] ✅ Continuous Memory Service initialized`);
    }

    /**
     * Shutdown cleanly — flush all pending entries.
     */
    public shutdown(): void {
        if (this.consolidationInterval) {
            clearInterval(this.consolidationInterval);
            this.consolidationInterval = null;
        }

        // Final flush
        this.flushAll();
        console.log(`[CONTINUOUS_MEM] 🛑 Shutdown complete. All memories flushed.`);
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
        const entry: WALEntry = {
            id: `wal-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            timestamp: Date.now(),
            agentId,
            type,
            data,
            status: 'PENDING'
        };

        this.wal.push(entry);
        this.persistWAL();

        return entry.id;
    }

    /**
     * Commit a WAL entry after successful processing.
     * This triggers micro-consolidation.
     */
    public commitEntry(walId: string, output?: string): void {
        const entry = this.wal.find(e => e.id === walId);
        if (!entry) return;

        entry.status = 'COMMITTED';
        if (output) {
            entry.data.output = output;
        }

        // Micro-consolidation: save to agent's MEMORY.md immediately
        this.microConsolidate(entry);
        this.persistWAL();
    }

    /**
     * Micro-consolidation: persist a summary of the completed entry to the agent's memory.
     */
    private microConsolidate(entry: WALEntry): void {
        try {
            if (entry.type === 'TASK_COMPLETED' || entry.type === 'MESSAGE_RECEIVED') {
                const summary = this.buildMemorySummary(entry);
                if (summary) {
                    agentFileSystem.appendMemory(entry.agentId, summary);
                    this.stats.memoriesSaved++;
                }
            }
            this.stats.entriesProcessed++;
        } catch (error) {
            console.error(`[CONTINUOUS_MEM] ⚠️ Micro-consolidation failed for ${entry.id}:`, error);
        }
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
                return `**Message Processed**\n${input.length > 200 ? input.substring(0, 200) + '...' : input}`;

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
        const before = this.wal.length;
        this.wal = this.wal.filter(e => {
            // Keep pending entries always
            if (e.status === 'PENDING') return true;
            // Keep recent committed entries (< 5 min old)
            return e.timestamp > fiveMinAgo;
        });

        const cleaned = before - this.wal.length;
        if (cleaned > 0) {
            this.stats.walEntriesCleaned += cleaned;
            this.persistWAL();
        }

        this.stats.lastConsolidation = Date.now();
    }

    /**
     * Flush all pending entries as committed (used during shutdown).
     */
    private flushAll(): void {
        for (const entry of this.wal) {
            if (entry.status === 'PENDING') {
                entry.status = 'COMMITTED';
                this.microConsolidate(entry);
            }
        }
        this.persistWAL();
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
            console.log(`[CONTINUOUS_MEM] Replaying WAL entry: ${entry.type} for agent ${entry.agentId}`);

            // Log recovery to the agent's memory
            agentFileSystem.appendMemory(
                entry.agentId,
                `**⚠️ Recovery**: Previous session ended unexpectedly during ${entry.type}. ` +
                `Task: ${entry.data.taskDescription || 'Unknown'}. Status: Recovered from WAL.`
            );

            // Mark as committed (we can't re-execute, but we can log it)
            entry.status = 'COMMITTED';
            this.stats.entriesProcessed++;
        }

        this.persistWAL();
    }

    // ───────────────────────────────────────────────────────────
    // WAL PERSISTENCE
    // ───────────────────────────────────────────────────────────

    private loadWAL(): void {
        try {
            if (fs.existsSync(WAL_FILE)) {
                const raw = fs.readFileSync(WAL_FILE, 'utf-8');
                this.wal = JSON.parse(raw);
            }
        } catch (error) {
            console.error('[CONTINUOUS_MEM] Failed to load WAL, starting fresh:', error);
            this.wal = [];
        }
    }

    private persistWAL(): void {
        try {
            fs.writeFileSync(WAL_FILE, JSON.stringify(this.wal, null, 2), 'utf-8');
        } catch (error) {
            console.error('[CONTINUOUS_MEM] ⚠️ Failed to persist WAL:', error);
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
