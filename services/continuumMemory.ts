import { lexicalMatches, lexicalScore } from './lexicalMatch';
import { atomicWriteFile } from './utils/atomicWrite';
import { MemoryNode, MemoryTier } from "../types";
import { lancedbService } from './lancedbService';
import { createHash } from 'node:crypto';
import { fuseMemories, inScope, scopeSql, type MemoryScope } from './memoryRetrieval';
import { activation, selectSleepBatch } from './memoryCognition';
import { memoryTransitions, isOutstandingTransition } from './memoryTransitions';
import { quotaLedger, QuotaLedger } from './quotaLedger';
import { DEFAULT_GEMINI_EMBEDDING_MODEL } from './llm/defaultModels';
import { introspection } from './introspectionEngine';
import { redisClient } from './redisClient';
import * as fs from 'fs/promises';
import * as path from 'path';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';
import { MemoryNodeSchema } from './memorySchema'; // Added missing import

const SNAPSHOT_PATH = path.join(process.cwd(), 'data', 'memory_snapshot.json');

export interface CoreRecoveryReport {
    outcome: 'COMPLETE' | 'DEGRADED' | 'FAILED';
    source: 'DISK' | 'REDIS' | 'EMPTY';
    snapshotLoaded: boolean;
    journalVerified: number;
    unresolved: { key: string; sourceRetained: boolean; error: string }[];
    errors: string[];
}

export interface SnapshotReceipt {
    sequence: number;
    dirtyRevision: number;
    checksum: string;
    disk: 'CONFIRMED';
    redis: 'SETTLED_UNVERIFIED' | 'FAILED';
    redisError?: string;
}

export interface MemoryEffectReceipt {
    operationId: string;
    nodeId: string;
    state: 'COMPLETE' | 'FAILED';
    dreamer: { state: 'COMPLETE' | 'FAILED'; error?: string };
    brain: { state: 'COMPLETE' | 'FAILED'; error?: string };
}
export interface MemoryStoreCompletion {
    // Historical store() can skip/deduplicate. This is NOT a canonical receipt.
    storeReturned: true;
    effects?: { operationId: string; nodeId: string; completion: Promise<MemoryEffectReceipt> };
}

export interface SnapshotOperation {
    sequence: number;
    dirtyRevision: number;
    checksum: string;
    state: 'PENDING' | 'FAILED';
    error?: string;
}

const recoveryError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

// --- SILHOUETTE CONTINUUM MEMORY SYSTEM V5.0 (UNIFIED WORKING MEMORY) ---
// Architecture: 4-Tier Hierarchical Storage
// L1: RAM (WORKING - Unified Fast Access)
// L2: LanceDB MEDIUM (Persistent - Frequently accessed)
// L3: LanceDB LONG (Archived)
// L4: Qdrant DEEP (Semantic vectors)

/** Positive integer from env with a documented default (NaN/<=0 falls back). */
function positiveIntEnv(name: string, fallback: number): number {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

class ContinuumMemorySystem {
    // === UNIFIED WORKING MEMORY (RAM - Fast Access) ===
    // [REFACTOR 2026-01-07] Merged ultraShort + short into single working array
    // TTL: 30 mins (promoted to MEDIUM if accessed frequently or aged)
    private working: MemoryNode[] = [];

    // Legacy aliases for backward compatibility (both point to working)
    // These getters/setters allow existing code to continue working
    private get ultraShort(): MemoryNode[] { return this.working; }
    private set ultraShort(value: MemoryNode[]) { this.working = value; }
    private get short(): MemoryNode[] { return this.working; }
    private set short(value: MemoryNode[]) { this.working = value; }

    // Dirty Flag for Persistence Optimization
    private isDirty: boolean = false;
    private dirtyRevision = 0;
    private readonly coreRecovery: Promise<CoreRecoveryReport>;
    private readonly hydrationOwner: Promise<void>;
    private hydrationState: 'PENDING' | 'VALID' | 'FAILED' = 'PENDING';
    private coreRecoveryReport: CoreRecoveryReport | undefined;
    private snapshotSequence = 0;
    private snapshotTail: Promise<void> = Promise.resolve();
    private readonly snapshotOperations = new Map<number, SnapshotOperation & { payload: string }>();
    private readonly SNAPSHOT_OPERATION_LIMIT = 128;
    private lastSnapshotReceipt: SnapshotReceipt | undefined;
    private readonly memoryEffectLimit = 128;
    private effectReservations = 0;
    private readonly memoryEffectOwners = new Map<string, {
        nodeId: string; completion: Promise<MemoryEffectReceipt>; receipt?: MemoryEffectReceipt;
    }>();

    public getMemoryEffectOperations() {
        return Array.from(this.memoryEffectOwners, ([operationId, value]) => ({
            operationId, nodeId: value.nodeId,
            state: value.receipt?.state ?? 'PENDING',
            receipt: value.receipt ? structuredClone(value.receipt) : undefined
        }));
    }

    /** Current accepted-set only. No future-admission barrier or global drain. */
    public settleMemoryEffects(): Promise<MemoryEffectReceipt[]> {
        return Promise.all(Array.from(this.memoryEffectOwners.values(), value => value.completion));
    }

    /** Explicitly acknowledge ONE exact observed failure, not retry or recovery.
     * Caller must have handled the partial effect. Does not repeat dream entropy
     * or external Brain writes and never marks an unknown outcome successful. */
    public acknowledgeMemoryEffectFailure(operationId: string, expected: MemoryEffectReceipt): boolean {
        const record = this.memoryEffectOwners.get(operationId);
        if (!record?.receipt || record.receipt.state !== 'FAILED'
            || JSON.stringify(record.receipt) !== JSON.stringify(expected)) return false;
        this.memoryEffectOwners.delete(operationId);
        return true;
    }

    // [FIX] Anti-Recursion: Hash-based deduplication to prevent infinite loops
    private recentHashes: Set<string> = new Set();
    private static readonly LOOP_PATTERNS = [
        /I'm committing this to memory: I'm committing/i,
        /Storing memory: Storing memory/i,
        /memory that is identical to itself/i,
        /I'm aware of: Storing memory/i,
        /NARRATIVE.*NARRATIVE/i
    ];

    // [FIX] Identity Re-Perspectiver: Transforms first-person user statements to third-person
    // Prevents Silhouette from confusing user identity with her own
    private static readonly IDENTITY_TRANSFORMS: Array<{ pattern: RegExp, replacement: string }> = [
        { pattern: /^yo soy ([a-záéíóúñ]+)/gi, replacement: 'El usuario se identifica como $1' },
        { pattern: /^mi nombre es ([a-záéíóúñ]+)/gi, replacement: 'El usuario indica que su nombre es $1' },
        { pattern: /^me llamo ([a-záéíóúñ]+)/gi, replacement: 'El usuario indica que se llama $1' },
        { pattern: /prefiero que me llam(es|en) ([a-záéíóúñ]+)/gi, replacement: 'El usuario prefiere ser llamado $2' },
        { pattern: /puedes llamarme ([a-záéíóúñ]+)/gi, replacement: 'El usuario prefiere ser llamado $1' },
        { pattern: /llámame ([a-záéíóúñ]+)/gi, replacement: 'El usuario desea ser llamado $1' },
        { pattern: /^soy ([a-záéíóúñ]+)/gi, replacement: 'El usuario indica que es $1' },
        { pattern: /mi apodo es ([a-záéíóúñ]+)/gi, replacement: 'El apodo del usuario es $1' },
    ];

    public checkDirty(): boolean {
        const wasDirty = this.isDirty;
        return wasDirty; // Never clear before a durable snapshot succeeds.
    }


    // ...

    private async promoteWorking(node: MemoryNode, tags: string[] = []): Promise<void> {
        const promoted = { ...node, tier: MemoryTier.MEDIUM, tags: [...node.tags, ...tags] };
        await memoryTransitions.transition(node, promoted);
        // Do not remove a replacement with the same ID that arrived while writing.
        this.working = this.working.filter(n => n !== node);
        this.markDirty();
        await this.saveSnapshot();
    }

    // [NATIVE-RECOVERY] Structured failure reporting: promote failures used to
    // reach console ONLY, so the self-healing channel (incident registry, read
    // every 15 min) never saw the 969k-failure episode. One incident per
    // episode (registry dedupes + bumps occurrences); recovery resolves the
    // SAME incident. 3 consecutive failures debounce transients.
    private async notePromoteFailure(nodeId: string, error: unknown): Promise<void> {
        this.consecutivePromoteFailures++;
        console.error(`[CONTINUUM] Failed to promote ${nodeId}`, error);
        if (this.consecutivePromoteFailures >= 3) {
            try {
                const { incidentRegistry } = await import('./incidentRegistry');
                incidentRegistry.recordIncident('continuum-promote', 'error', 'memory promotion failing',
                    `consecutive promote failures: ${this.consecutivePromoteFailures}; last error: ${(error as any)?.message ?? String(error)}`);
            } catch (e) { console.warn('[CONTINUUM] incident reporting failed (promotion failure still logged above):', e); }
        }
    }

    private async notePromoteSuccess(): Promise<void> {
        this.consecutivePromoteFailures = 0;
        try {
            const { incidentRegistry } = await import('./incidentRegistry');
            incidentRegistry.resolveIncidents('continuum-promote', 'error');
        } catch { /* reporting must never break memory flow */ }
    }

    private async tickMedium(now: number) {
        const toPromote = this.working.filter(node =>
            now - node.timestamp > 900000 || node.accessCount > 10 || node.importance >= 0.95
        );
        for (const node of toPromote) {
            try { await this.promoteWorking(node); await this.notePromoteSuccess(); }
            catch (e) { await this.notePromoteFailure(node.id, e); }
        }
    }

    // ...


    private hippocampus: MemoryNode[] = []; // Holds decayed memories for dreaming

    // Configuration
    private readonly HIPPOCAMPUS_CAPACITY = 50; // Trigger dream when full
    private readonly CACHE_TTL = 30000; // 30 Seconds
    private readonly RAM_HARD_CAP = 600; // [FIX 2026-02] Hard limit — force-consolidate above this

    // [NATIVE-RECOVERY] Self-recovery cadences ride the EXISTING maintenance
    // tick (no new timers). Env-tunable; defaults documented here.
    private readonly TRANSITION_RECONCILE_INTERVAL_MS = positiveIntEnv('CONTINUUM_RECONCILE_INTERVAL_MS', 15 * 60 * 1000);
    private readonly EMBEDDING_BACKFILL_INTERVAL_MS = positiveIntEnv('CONTINUUM_EMBEDDING_BACKFILL_INTERVAL_MS', 60 * 60 * 1000);
    private lastTransitionReconcile = 0;
    private lastEmbeddingBackfill = 0;
    private consecutivePromoteFailures = 0;

    constructor() {
        // No hydration needed for LanceDB, it's always on disk.
        // RAM tiers start empty on reboot (Tabula Rasa for short term) UNLESS hydrated explicitly.

        // Retain constructor autostart, now with an observable original owner.
        // A missing disk can consult Redis; this is not import-purity or a
        // global startup/drain barrier. Dreaming still starts at server boot.
        const report: CoreRecoveryReport = {
            outcome: 'COMPLETE', source: 'EMPTY', snapshotLoaded: false,
            journalVerified: 0, unresolved: [], errors: []
        };
        this.hydrationOwner = this.loadSnapshot(report).then(() => {
            this.hydrationState = 'VALID';
        }, error => {
            this.hydrationState = 'FAILED';
            throw error;
        });
        this.coreRecovery = this.recoverCore(report);
        // Observe immediately; retain the original rejecting owner for callers.
        void this.coreRecovery.catch(err => console.error('[CONTINUUM] Failed to recover memory:', err));
    }

    // --- PUBLIC API ---
    public async forceConsolidation() {
        console.log("[CONTINUUM] 🧠 Forcing Memory Consolidation...");
        return await this.consolidateRamImmediate();
    }

    // --- PERSISTENCE SNAPSHOTS ---
    /** Core recovery only: settlement, outcome and later writes are distinct. */
    public readyCore(): Promise<CoreRecoveryReport> {
        return this.coreRecovery;
    }

    public getCoreRecoveryReport(): CoreRecoveryReport | undefined {
        if (!this.coreRecoveryReport) return undefined;
        return {
            ...this.coreRecoveryReport,
            unresolved: this.coreRecoveryReport.unresolved.map(entry => ({ ...entry })),
            errors: [...this.coreRecoveryReport.errors]
        };
    }

    private async recoverCore(report: CoreRecoveryReport): Promise<CoreRecoveryReport> {
        try {
            await this.hydrationOwner;
            const journal = await this.reconcileTransitions();
            report.journalVerified = journal.verified;
            report.unresolved = journal.unresolved;
            if (journal.unresolved.length || report.errors.length) report.outcome = 'DEGRADED';
            this.coreRecoveryReport = report;
            return this.getCoreRecoveryReport()!;
        } catch (error) {
            report.outcome = 'FAILED';
            report.errors.push(recoveryError(error));
            this.coreRecoveryReport = report;
            throw error;
        }
    }

    public getSnapshotOperations(): SnapshotOperation[] {
        return Array.from(this.snapshotOperations.values(), ({ payload: _payload, ...entry }) => ({ ...entry }));
    }

    public getLastSnapshotReceipt(): SnapshotReceipt | undefined {
        return this.lastSnapshotReceipt ? { ...this.lastSnapshotReceipt } : undefined;
    }

    /** Explicit acknowledgement removes only an already terminal failure. */
    public acknowledgeSnapshotFailure(sequence: number): boolean {
        if (this.snapshotOperations.get(sequence)?.state !== 'FAILED') return false;
        return this.snapshotOperations.delete(sequence);
    }

    private snapshotPayload(): string {
        return JSON.stringify({ working: this.working, ultraShort: this.working, short: [] }, null, 2);
    }

    private snapshotFingerprint(): string {
        return createHash('sha256').update(this.snapshotPayload()).digest('hex');
    }

    private snapshotAdmissionError(): Error | undefined {
        if (this.hydrationState !== 'VALID') {
            return new Error(`Snapshot rejected before admission: hydration ${this.hydrationState}`);
        }
        if (this.coreRecoveryReport?.outcome === 'FAILED') {
            return new Error('Snapshot rejected: failed core recovery requires explicit repair outside this cut');
        }
        return undefined;
    }

    private saveSnapshot(): Promise<SnapshotReceipt> {
        const error = this.snapshotAdmissionError();
        if (error) return Promise.reject(error);
        return this.captureSnapshot();
    }

    private saveRecoverySnapshot(): Promise<SnapshotReceipt> {
        // Recovery cannot await its own readyCore. Hydration must already be valid.
        if (this.hydrationState !== 'VALID' || this.coreRecoveryReport?.outcome === 'FAILED') {
            return Promise.reject(new Error('Recovery snapshot rejected: hydration/core recovery not valid'));
        }
        return this.captureSnapshot();
    }

    private captureSnapshot(): Promise<SnapshotReceipt> {
        // Capacity is checked before sequence admission or any backend operation.
        if (this.snapshotOperations.size >= this.SNAPSHOT_OPERATION_LIMIT) {
            return Promise.reject(new Error('Snapshot admission full: acknowledge retained failures first'));
        }
        // Serialize now, not when the queued worker runs: no mutable node alias.
        const payload = this.snapshotPayload();
        const checksum = createHash('sha256').update(payload).digest('hex');
        const sequence = ++this.snapshotSequence;
        const dirtyRevision = this.dirtyRevision;
        const record: SnapshotOperation & { payload: string } = { sequence, dirtyRevision, checksum, state: 'PENDING', payload };
        this.snapshotOperations.set(sequence, record);
        return this.enqueueSnapshot(record);
    }

    public retrySnapshotFailure(sequence: number): Promise<SnapshotReceipt> {
        const admissionError = this.snapshotAdmissionError();
        if (admissionError) return Promise.reject(admissionError);
        const record = this.snapshotOperations.get(sequence);
        if (!record || record.state !== 'FAILED') {
            return Promise.reject(new Error('No retained failed snapshot for explicit retry'));
        }
        if (sequence !== this.snapshotSequence || record.dirtyRevision !== this.dirtyRevision
            || record.checksum !== this.snapshotFingerprint()) {
            this.isDirty = true;
            return Promise.reject(new Error('Retry would regress newer state; use forceSave for current data'));
        }
        record.state = 'PENDING';
        delete record.error;
        return this.enqueueSnapshot(record);
    }

    private enqueueSnapshot(record: SnapshotOperation & { payload: string }): Promise<SnapshotReceipt> {
        const { sequence, dirtyRevision, checksum, payload } = record;
        const task = this.snapshotTail.then(async (): Promise<SnapshotReceipt> => {
            const admissionError = this.snapshotAdmissionError();
            if (admissionError) throw admissionError;
            let redis: SnapshotReceipt['redis'] = 'SETTLED_UNVERIFIED';
            let redisError: string | undefined;
            // Preserve historical Redis -> disk ordering, per captured payload.
            try { await redisClient.set('continuum:volatile', payload, 3600); }
            catch (error) {
                redis = 'FAILED';
                redisError = recoveryError(error);
                console.warn('[CONTINUUM] Redis snapshot unavailable:', error);
            }
            const commitError = this.snapshotAdmissionError();
            if (commitError) throw commitError;
            await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
            await atomicWriteFile(SNAPSHOT_PATH, payload);
            const readback = await fs.readFile(SNAPSHOT_PATH);
            if (createHash('sha256').update(readback).digest('hex') !== checksum) {
                throw new Error(`Snapshot read-back mismatch for sequence ${sequence}`);
            }
            const receipt: SnapshotReceipt = {
                sequence, dirtyRevision, checksum, disk: 'CONFIRMED', redis, redisError
            };
            const payloadStillCurrent = this.snapshotFingerprint() === checksum;
            this.lastSnapshotReceipt = receipt;
            this.snapshotOperations.delete(sequence);
            if (!payloadStillCurrent) this.isDirty = true;
            if (payloadStillCurrent && this.dirtyRevision === dirtyRevision
                && !Array.from(this.snapshotOperations.values()).some(entry => entry.state === 'FAILED')) {
                this.isDirty = false;
            }
            return { ...receipt };
        });
        // The queue survives failure; the original task still rejects visibly.
        this.snapshotTail = task.then(() => undefined, error => {
            this.isDirty = true;
            record.state = 'FAILED';
            record.error = recoveryError(error);
            console.error('[CONTINUUM] Failed to save snapshot:', error);
        });
        return task;
    }

    private async loadSnapshot(report: CoreRecoveryReport): Promise<void> {
        let snapshot: any;
        let payload: string | null;
        report.source = 'DISK';
        try {
            payload = await fs.readFile(SNAPSHOT_PATH, 'utf-8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            // Redis is consulted ONLY when disk is absent, never corrupt/unreadable.
            report.source = 'REDIS';
            payload = await redisClient.get('continuum:volatile');
            report.source = payload === null ? 'EMPTY' : 'REDIS';
            if (redisClient.isMockMode()) {
                report.errors.push('Disk absent; Redis is volatile in-memory fallback, not durable recovery evidence');
            }
        }
        if (payload === null) return;
        snapshot = JSON.parse(payload);
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
            throw new Error('Malformed memory snapshot');
        }
        for (const key of ['working', 'ultraShort', 'short']) {
            if (snapshot[key] !== undefined && !Array.isArray(snapshot[key])) {
                throw new Error('Malformed memory snapshot tier array');
            }
        }
        let nodes: MemoryNode[];
        if (Array.isArray(snapshot.working)) nodes = snapshot.working;
        else if (Array.isArray(snapshot.ultraShort) || Array.isArray(snapshot.short)) {
            nodes = [...(snapshot.ultraShort ?? []), ...(snapshot.short ?? [])];
        } else throw new Error('Memory snapshot has no recognized tier arrays');
        for (const node of nodes) {
            if (!this.isRecoveryNode(node)) throw new Error('Malformed memory snapshot node');
        }
        const existingIds = new Set(this.working.map(node => node.id));
        let merged = 0;
        for (const node of nodes) {
            if (existingIds.has(node.id)) continue;
            this.working.push(node);
            existingIds.add(node.id);
            merged++;
        }
        if (merged > 0) this.markDirty();
        report.snapshotLoaded = true;
        console.log(`[CONTINUUM] Restored Memory from ${report.source}: ${merged} merged into WORKING tier`);
    }

    private isRecoveryNode(node: any): node is MemoryNode {
        // Validate shape without rewriting legacy fields or embedding metadata.
        return !!node && typeof node.id === 'string' && node.id.length > 0
            && typeof node.content === 'string' && Number.isFinite(node.timestamp)
            && typeof node.tier === 'string' && Array.isArray(node.tags)
            && node.tags.every((tag: unknown) => typeof tag === 'string');
    }

    /**
     * Boot scope 'full' preserves the historical verify-everything pass.
     * Periodic scope 'pending' skips COMMITTED entries: the journal is eternal
     * (nothing is deleted), so re-verifying all of history every cycle would
     * grow without bound - outstanding entries are the only work remaining.
     */
    public async reconcileTransitions(scope: 'full' | 'pending' = 'full'): Promise<{
        verified: number;
        unresolved: CoreRecoveryReport['unresolved'];
    }> {
        if (this.hydrationState !== 'VALID') throw new Error('Reconcile requires valid hydration');
        const entries = await memoryTransitions.pending();
        // Reject the whole malformed journal before replay mutates any entry.
        for (const entry of entries) {
            if (!entry || !this.isRecoveryNode(entry.source) || !this.isRecoveryNode(entry.destination)
                || entry.source.id !== entry.destination.id
                || !['PENDING', 'WRITTEN', 'VERIFIED', 'COMMITTED'].includes(entry.state)) {
                throw new Error('Malformed memory transition journal');
            }
            const expectedKey = createHash('sha256').update(JSON.stringify([
                entry.source.id, entry.source.timestamp, entry.source.tier, entry.destination.tier
            ])).digest('hex');
            if (entry.key !== expectedKey) throw new Error('Malformed memory transition key');
        }
        const result: { verified: number; unresolved: CoreRecoveryReport['unresolved'] } = {
            verified: 0, unresolved: []
        };
        for (const entry of entries) {
            if (scope === 'pending' && !isOutstandingTransition(entry)) continue;
            try {
                if (entry.state !== 'COMMITTED') {
                    if (entry.source.tier === MemoryTier.WORKING && !this.working.some(n => n.id === entry.source.id)) {
                        this.working.push(entry.source);
                    }
                    if (entry.source.tier !== MemoryTier.WORKING) {
                        const current = await lancedbService.getNodeById(entry.source.id);
                        if (!current || (current.tier !== entry.source.tier && current.tier !== entry.destination.tier)) {
                            throw new Error(`Source changed before replay: ${entry.key}`);
                        }
                    }
                    await memoryTransitions.resume(entry);
                } else {
                    const stored = await lancedbService.getNodeById(entry.destination.id);
                    if (JSON.stringify(stored) !== JSON.stringify(entry.destination)) {
                        throw new Error(`Committed transition missing destination: ${entry.key}`);
                    }
                }
                if (entry.source.tier === MemoryTier.WORKING) this.working = this.working.filter(n => n.id !== entry.source.id);
                this.markDirty();
                await this.saveRecoverySnapshot();
                result.verified++;
            } catch (error) {
                // Preserve the journal's original source payload even for a
                // COMMITTED record whose destination can no longer be verified.
                if (entry.source.tier === MemoryTier.WORKING && !this.working.some(n => n.id === entry.source.id)) {
                    this.working.push(entry.source);
                    this.markDirty();
                }
                // sourceRetained refers to the unchanged journal source, not
                // a claim that a non-WORKING canonical row was restored.
                result.unresolved.push({ key: entry.key, sourceRetained: true, error: recoveryError(error) });
                console.error(`[CONTINUUM] Recovery deferred for ${entry.key}:`, error);
            }
        }
        return result;
    }

    // --- PERSISTENCE HELPERS ---
    public getVolatileState(): MemoryNode[] {
        // [REFACTOR 2026-01-07] Return unified working memory
        return [...this.working];
    }

    public hydrateVolatile(nodes: MemoryNode[]) {
        // [REFACTOR 2026-01-07] All nodes go to unified working memory
        // Accept nodes from any tier (WORKING, ULTRA_SHORT, SHORT) for backward compatibility
        this.working = nodes.filter(n => {
            const tierStr = String(n.tier);
            return tierStr === 'WORKING' || tierStr === 'ULTRA_SHORT' || tierStr === 'SHORT';
        });
        console.log(`[CONTINUUM] Hydrated Volatile Memory: ${this.working.length} WORKING nodes`);
        this.markDirty(); // Mark as dirty to trigger save
    }

    // --- FULL SESSION CHAT HISTORY (INFINITE CONTEXT) ---
    public getSessionHistory(limit: number = 1000): { role: string; content: string }[] {
        // [FIX 2026-02] Use unified working array directly (ultraShort/short are aliases to working)
        const history = this.working
            .filter(n => n.tags.includes('USER_MESSAGE') || n.tags.includes('AGENT_RESPONSE'))
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-limit)
            .map(n => ({
                role: n.tags.includes('USER_MESSAGE') ? 'user' : 'model',
                content: n.content
            }));

        return history;
    }

    // --- PUBLIC API ---

    public getShortTermMemory(): MemoryNode[] {
        return this.working;
    }

    public getHippocampus(): MemoryNode[] {
        return this.hippocampus;
    }

    public async getAllNodes(): Promise<Record<MemoryTier, MemoryNode[]>> {
        // 1. RAM Tier (Unified WORKING memory)
        const nodes: Record<MemoryTier, MemoryNode[]> = {
            [MemoryTier.WORKING]: [...this.working],
            [MemoryTier.MEDIUM]: [],
            [MemoryTier.LONG]: [],
            [MemoryTier.DEEP]: []
        };

        try {
            // 2. Persistent Tiers (LanceDB)
            const dbNodes = await lancedbService.getAllNodes(); // Returns all nodes from LanceDB
            nodes[MemoryTier.MEDIUM] = dbNodes.filter(n => n.tier === MemoryTier.MEDIUM || n.tier === undefined);
            nodes[MemoryTier.LONG] = dbNodes.filter(n => n.tier === MemoryTier.LONG);

            // 3. Deep Tier (Hybrid: Qdrant + LanceDB Archive)
            // Fetch live vectors from Qdrant
            const { vectorMemory } = await import('./vectorMemoryService');
            const deepVectors = await vectorMemory.getAllNodes(100);

            // Fetch archived DEEP nodes from LanceDB (that were moved from LONG)
            const deepArchived = dbNodes.filter(n => n.tier === MemoryTier.DEEP);

            // Map Qdrant points
            const deepFromQdrant = deepVectors.map(v => ({
                id: v.id,
                content: v.content,
                tier: MemoryTier.DEEP,
                timestamp: v.timestamp,
                tags: v.tags,
                importance: v.importance,
                decayHealth: (v as any).decayHealth || 100,
                accessCount: 0,
                lastAccess: Date.now(),
                compressionLevel: 0
            }));

            // Merge Qdrant + LanceDB Archive (Deduplicate by ID, preferring Qdrant)
            const deepMap = new Map<string, MemoryNode>();
            deepArchived.forEach(n => deepMap.set(n.id, n));
            deepFromQdrant.forEach(n => deepMap.set(n.id, n));

            nodes[MemoryTier.DEEP] = Array.from(deepMap.values());
        } catch (e) {
            console.error("[CONTINUUM] Failed to aggregate nodes:", e);
        }

        return nodes;
    }

    public clearHippocampus(nodeIds: string[]) {
        this.hippocampus = this.hippocampus.filter(n => !nodeIds.includes(n.id));
    }

    public async deleteNode(nodeId: string) {
        // [FIX 2026-02] Use working directly (ultraShort/short are aliases)
        const originalLen = this.working.length;
        this.working = this.working.filter(n => n.id !== nodeId);

        // 2. Remove from Hippocampus
        this.hippocampus = this.hippocampus.filter(n => n.id !== nodeId);

        if (originalLen !== this.working.length) {
            console.log(`[CONTINUUM] 🗑️ Deleted node ${nodeId} from RAM.`);
            this.markDirty();
        }

        // 3. Remove from Persistent Storage (LanceDB)
        try {
            await lancedbService.deleteNode(nodeId);
        } catch (e) {
            console.error(`[CONTINUUM] Failed to delete node ${nodeId} from LanceDB`, e);
        }
    }

    /** Compatibility: return means historical store completion/skip, NOT effect success. */
    public async store(content: string, tier: MemoryTier = MemoryTier.ULTRA_SHORT, tags: string[] = [], skipIngestion: boolean = false, extra?: { parentIds?: string[]; affect?: { valence: number; activation: number; at: number } }): Promise<void> {
        await this.storeWithEffectReceipt(content, tier, tags, skipIngestion, extra);
    }

    public async storeWithEffectReceipt(content: string, tier: MemoryTier = MemoryTier.ULTRA_SHORT, tags: string[] = [], skipIngestion: boolean = false, extra?: { parentIds?: string[]; affect?: { valence: number; activation: number; at: number } }): Promise<MemoryStoreCompletion> {
        // Reserve before any canonical mutation or child effect admission.
        // Completed-success records are released; failed records require exact acknowledgement.
        if (!skipIngestion && this.memoryEffectOwners.size + this.effectReservations >= this.memoryEffectLimit) {
            throw new Error('Memory effect admission full; canonical store not attempted');
        }
        const completion: MemoryStoreCompletion = { storeReturned: true };
        if (!skipIngestion) this.effectReservations++;
        try {
            await this.storeCanonical(content, tier, tags, skipIngestion, extra, completion);
            return completion;
        } finally {
            if (!skipIngestion) this.effectReservations--;
        }
    }

    private async storeCanonical(content: string, tier: MemoryTier = MemoryTier.ULTRA_SHORT, tags: string[] = [], skipIngestion: boolean = false, extra?: { parentIds?: string[]; affect?: { valence: number; activation: number; at: number } }, completion?: MemoryStoreCompletion): Promise<void> {
        // [PR-4c] Boundary coercion: an invalid tier (e.g. an LLM emitting the
        // number 28) must not reach the gatekeeper as a "corruption" event that
        // mobilizes remediation squads in a loop. Coerce loudly to WORKING;
        // the zod gatekeeper remains as the second line of defense.
        if (!(Object.values(MemoryTier) as string[]).includes(tier as unknown as string)) {
            console.warn(`[CONTINUUM] ⚠️ Invalid memory tier (${JSON.stringify(tier)}) coerced to WORKING. Content prefix: "${String(content).substring(0, 60)}"`);
            tier = MemoryTier.WORKING;
        }

        // [FIX] Anti-Recursion Guard 1: Block self-referential/recursive content patterns
        for (const pattern of ContinuumMemorySystem.LOOP_PATTERNS) {
            if (pattern.test(content)) {
                console.warn(`[CONTINUUM] 🔄 Blocked recursive content: "${content.substring(0, 50)}..."`);
                return;
            }
        }

        // [FIX] Anti-Recursion Guard 2: Hash-based recent deduplication.
        // [R11-FOLLOWUP] Hash the FULL content: base64 of a 100-char prefix
        // truncated to 16 chars only encoded the first 12 bytes, so any two
        // memories sharing a 12-char prefix collided and the later write was
        // silently dropped (real data loss observed on r11-marker-* retries).
        const contentHash = content.length > 10 ?
            createHash('sha256').update(content).digest('base64').slice(0, 16) :
            content;
        if (this.recentHashes.has(contentHash)) {
            console.log(`[CONTINUUM] ♻️ Deduplicated recent content`);
            return;
        }


        // [FIX] Identity Re-Perspectiver: Transform user first-person statements
        const transformedContent = this.transformUserPerspective(content, tags);

        const timestamp = Date.now();

        const rawNode = {
            id: crypto.randomUUID(),
            content: transformedContent, // Use transformed content
            originalContent: content, // Keep original for reference
            timestamp: timestamp,
            tier: tier,
            importance: this.calculateInitialImportance(content, tags),
            tags: tags,
            ownerId: tags.find(t => t.startsWith('owner:'))?.split(':')[1],
            parentIds: extra?.parentIds?.length ? extra.parentIds : undefined,
            affect: extra?.affect,
            accessCount: 1,
            lastAccess: timestamp,
            decayHealth: 100,
            compressionLevel: 0
        };

        // 🛡️ DATA IMMUNE SYSTEM: INPUT VALIDATION
        const validation = MemoryNodeSchema.safeParse(rawNode);

        if (!validation.success) {
            console.error(`[CONTINUUM] 🛑 BLOCKED CORRUPT MEMORY WRITE:`, validation.error.format());

            systemBus.emit(SystemProtocol.DATA_CORRUPTION, {
                source: 'CONTINUUM_GATEKEEPER',
                details: `Input Validation Failed: ${JSON.stringify(validation.error.flatten().fieldErrors)}`,
                nodeId: 'BLOCKED_AT_GATE'
            });

            return; // Reject the write
        }

        const node = validation.data; // Use validated data

        // Emit Real-time Event for UI
        systemBus.emit(SystemProtocol.MEMORY_CREATED, {
            nodeId: node.id,
            tier: tier,
            content: node.content
        }, 'ContinuumMemory');

        if (!skipIngestion) {
            // Check for Large Content Ingestion
            // Dynamic import to avoid circular dependency if any
            const { ingestion } = await import('./ingestionService');
            const handled = await ingestion.ingest(content, tags);
            if (handled) { this.recentHashes.add(contentHash); return; }
        }

        // L1: RAM Storage (Unified WORKING tier)
        // Cast to string for flexible comparison (handles both enum values and legacy strings)
        const tierStr = String(node.tier);
        if (tierStr === 'WORKING' || tierStr === 'ULTRA_SHORT' || tierStr === 'SHORT') {
            // Save the incoming memory first. Failure to evict an older node may exceed
            // the soft capacity, but must never discard the new memory or its source.
            this.working.push(node as MemoryNode);
            this.markDirty();
            await this.saveSnapshot();
            if (this.working.length > this.RAM_HARD_CAP) {
                const evicted = this.working[0];
                if (evicted && evicted !== node) {
                    try { await this.promoteWorking(evicted, ['EVICTED']); }
                    catch (error) { console.error('[CONTINUUM] Eviction deferred; source remains in RAM:', error); }
                }
            }
        }
        // L5: Deep / Vector Storage
        else if (node.tier === MemoryTier.DEEP) {
            const nodeToStore = {
                ...node,
                id: node.id || crypto.randomUUID(),
                tags: node.tags || [],
                timestamp: node.timestamp || Date.now()
            } as MemoryNode;

            try {
                // [FIX 2026-10-17] TRUE per-vector identity. Before: writes
                // embedded with Minimax while queries embedded with Gemini (the
                // identities never crossed, so semantic search never matched),
                // and identity was labeled from an env var instead of the actual
                // provider. Now one resolver returns vector + the identity that
                // truly produced it; lancedbService.store projects per identity.
                const { generateEmbeddingWithIdentity } = await import('./geminiService');
                const embedded = await generateEmbeddingWithIdentity(content);
                if (embedded) nodeToStore.embeddingIdentity = embedded.identity;
                await lancedbService.store(nodeToStore, embedded?.vector); // Canonical copy + automatic per-identity projection.
                if (!embedded) {
                    console.warn("[CONTINUUM] No embedding provider available; stored canonically without vector (text search only).");
                } else if (embedded.identity.dimension === 768) {
                    // Optional dual-write: Qdrant only when actually connected
                    // AND the vector meets its 768-dim requirement. Qdrant is
                    // not part of the prod deployment; LanceDB projections are
                    // the deep-memory vector store.
                    try {
                        const { vectorMemory } = await import('./vectorMemoryService');
                        if (vectorMemory.isReady()) {
                            await vectorMemory.storeMemory(nodeToStore.id, embedded.vector, {
                                ...nodeToStore,
                                type: 'MEMORY_NODE'
                            });
                        }
                    } catch {
                        // Canonical storage and its identified vector already succeeded.
                        // Optional Qdrant failure must not overwrite them without a vector.
                        console.warn('[CONTINUUM] Canonical deep memory retained; optional Qdrant projection unavailable.');
                    }
                }
            } catch (err) {
                console.error("[CONTINUUM] Deep storage failed:", err);
                await lancedbService.store(nodeToStore);
            }
        }
        // L3/L4: LanceDB Persistence
        else {
            const nodeToStore = {
                ...node,
                id: node.id || crypto.randomUUID(),
                tags: node.tags || [],
                timestamp: node.timestamp || Date.now()
            } as MemoryNode;
            await lancedbService.store(nodeToStore);
        }

        // [R11] every persisted write (any tier) bumps the revision so stats
        // snapshots invalidate immediately. The working-tier path already
        // bumped via markDirty(); this covers the LanceDB/vector branches.
        this.writeRevision++;

        // A failed write must never poison deduplication and suppress a retry.
        this.recentHashes.add(contentHash);
        if (this.recentHashes.size > 100) {
            this.recentHashes = new Set(Array.from(this.recentHashes).slice(-50));
        }

        // [FIX] Anti-Recursion Guard 3: Only notify introspection/dreamer for non-internal stores
        // skipIngestion=true indicates this is an internal/narrative store that should not cascade
        if (!skipIngestion) {
            // 3. Update Introspection about new thought (but NOT for narrative persistence)
            introspection.setRecentThoughts([`Storing memory: ${content.substring(0, 30)}...`]);

            const operationId = crypto.randomUUID();
            // Distinct from canonical completion. Always resolves a typed receipt;
            // disabled Brain is settled local no-op, not remote persistence proof.
            const effectCompletion: Promise<MemoryEffectReceipt> = Promise.allSettled([
                import('./dreamerService').then(({ dreamer }) => dreamer.notifyNewMemory()),
                import('./brain').then(({ brainBridge }) => brainBridge.mirrorMemory(content, {
                    importance: node.importance, tags: node.tags,
                    tier: (tierStr === 'DEEP' ? 'DEEP' : tierStr === 'MEDIUM' ? 'MEDIUM' : 'WORKING'),
                }))
            ]).then(results => {
                const result = (value: PromiseSettledResult<void>): MemoryEffectReceipt['dreamer'] =>
                    value.status === 'fulfilled' ? { state: 'COMPLETE' }
                        : { state: 'FAILED', error: recoveryError(value.reason) };
                const dreamer = result(results[0]), brain = result(results[1]);
                return { operationId, nodeId: node.id,
                    state: dreamer.state === 'COMPLETE' && brain.state === 'COMPLETE' ? 'COMPLETE' : 'FAILED',
                    dreamer, brain };
            });
            const record: { nodeId: string; completion: Promise<MemoryEffectReceipt>; receipt?: MemoryEffectReceipt } =
                { nodeId: node.id, completion: effectCompletion };
            this.memoryEffectOwners.set(operationId, record);
            // Original completion is returned and retained; no rejecting promise is orphaned.
            void effectCompletion.then(receipt => {
                record.receipt = structuredClone(receipt);
                if (receipt.state === 'COMPLETE') this.memoryEffectOwners.delete(operationId);
                else console.error('[CONTINUUM] Post-store effects failed:', receipt);
            });
            if (completion) completion.effects = { operationId, nodeId: node.id, completion: effectCompletion };
            // Do not reject/rollback canonical store for a later notification failure.

        }
    }

    public async recordMeaningfulRecall(id: string, now = Date.now()): Promise<void> {
        const source = this.working.find(n => n.id === id) || await lancedbService.getNodeById(id);
        if (!source) throw new Error(`Missing memory ${id}`);
        const { recordSignificantAccess } = await import('./memoryCognition');
        const updated = recordSignificantAccess(source, now);
        if (updated === source) return;
        await lancedbService.store(updated);
        const index = this.working.findIndex(n => n.id === id);
        if (index >= 0) { this.working[index] = updated; this.markDirty(); await this.saveSnapshot(); }
    }

    /** Recent exact-tag stored observations, without semantic search, ranking
     * budget, access writes or provider use. Ordinary retrieval is unchanged. */
    public async getRecentObservations(tag:string|string[],limit:number):Promise<MemoryNode[]>{
        const tags=Array.isArray(tag)?tag:[tag];
        if(!tags.length || !tags.every(t=>typeof t==='string' && t.length>0) || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Observation tags and bounded limit required');
        const persisted=await lancedbService.getRecentObservations(tag,limit,this.working.map(n=>n.id));
        const byId=new Map<string,MemoryNode>(persisted.map(n=>[n.id,n]));
        for(const node of this.working)if(tags.every(t=>node.tags.includes(t)))byId.set(node.id,node);
        return [...byId.values()].sort((a,b)=>b.timestamp-a.timestamp||a.id.localeCompare(b.id)).slice(0,limit);
    }

    public async getLatestObservation(tag:string):Promise<MemoryNode|null>{
        return (await this.getRecentObservations(tag,1))[0]??null;
    }

    public async retrieve(query: string, filterTag?: string, agentId?: string): Promise<MemoryNode[]> {
        // Use the new Universal Search to get candidates from all tiers (RAM + LanceDB + Qdrant)
        let candidates = await this.search(query, { ownerId: agentId, tag: filterTag });

        // Apply strict filters
        candidates = candidates.filter(n => {
            // Tag Filter
            if (filterTag && !n.tags.some(t => t.includes(filterTag))) return false;

            // Owner Check (Privacy/Siloing)
            // If agentId is provided, only show nodes owned by that agent OR public nodes (no owner)
            // But if specific owner logic is needed, modify here. 
            // Current rule: If node has ownerId, it must match agentId. Usage of undefined owner = public.
            if (agentId && n.ownerId && n.ownerId !== agentId) return false;

            return true;
        });

        // [VALUE RANKING] Re-rank by multi-signal value (importance, recency,
        // access, provenance). Eternal-memory safe: reorders ONLY — every
        // candidate is returned; superseded nodes are demoted, never removed.
        const { rankByValue } = await import('./memory/valueRanking');
        return rankByValue(candidates, Date.now());
    }

    /**
     * [BRAIN INTEGRATION] Unified Context Retrieval
     * Combines recent episodic memory with semantic deep memory.
     * This is the recommended query method for Agents to build their context windows.
     */
    public async getCombinedContext(
        query: string,
        semanticLimit: number = 5,
        recentLimit: number = 5,
        hours: number = 2
    ): Promise<{ semantic: MemoryNode[], recent: MemoryNode[] }> {
        // 1. Semantic Search (DEEP memory via VectorStore)
        let semantic: MemoryNode[] = [];
        try {
            const { vectorMemory } = await import('./vectorMemoryService');
            // Assuming vectorMemory has query() mapped to semantic search
            // If not, we fallback to generalized search
            if (typeof (vectorMemory as any).searchByContent === 'function') {
                const vectors = await (vectorMemory as any).searchByContent(query, semanticLimit);
                semantic = vectors.map(v => ({
                    id: v.id,
                    content: v.payload?.content || v.content,
                    tier: MemoryTier.DEEP,
                    timestamp: v.payload?.timestamp || Date.now(),
                    tags: v.payload?.tags || [],
                    importance: v.payload?.importance || 0.5,
                    accessCount: 1,
                    lastAccess: Date.now(),
                    decayHealth: 100,
                    compressionLevel: 0
                }));
            } else {
                // Fallback: use built-in search and filter for DEEP
                const allSearchResults = await this.search(query);
                semantic = allSearchResults.filter(n => n.tier === MemoryTier.DEEP).slice(0, semanticLimit);
            }
        } catch (e) {
            console.warn('[CONTINUUM] Semantic context retrieval failed, using fallback:', e);
            const allSearchResults = await this.search(query);
            semantic = allSearchResults.filter(n => n.tier === MemoryTier.DEEP).slice(0, semanticLimit);
        }

        // 2. Recent Episodic (WORKING / MEDIUM)
        const cutoff = Date.now() - (hours * 3600 * 1000);

        // From RAM
        const recentRam = this.working.filter(n => n.timestamp >= cutoff);

        // From LanceDB (Medium)
        let recentDb: MemoryNode[] = [];
        try {
            const dbNodes = await lancedbService.getAllNodes();
            recentDb = dbNodes.filter(n =>
                (n.tier === MemoryTier.MEDIUM || n.tier === undefined) &&
                n.timestamp >= cutoff
            );
        } catch (e) {
            console.error("[CONTINUUM] Failed to fetch recent DB nodes", e);
        }

        // Merge, sort, and slice recent
        const allRecent = [...recentRam, ...recentDb]
            .sort((a, b) => b.timestamp - a.timestamp) // Descending
            .slice(0, recentLimit);

        return { semantic, recent: allRecent };
    }

    public async getIdentityNodes(): Promise<MemoryNode[]> {
        // Fetch from LanceDB where tags include IDENTITY
        const allDb = await lancedbService.getAllNodes();
        return allDb.filter(n =>
            n.tags.includes('IDENTITY') ||
            n.tags.includes('CORE_BELIEF') ||
            n.tags.includes('SACRED')
        );
    }

    // --- MAINTENANCE TICKERS ---

    private isMaintenanceRunning = false;

    public async runMaintenance() {
        if (this.isMaintenanceRunning) return;
        this.isMaintenanceRunning = true;

        try {
            const now = Date.now();

            // [MEMORY PRESSURE MONITOR] Prevent OOM during long sessions
            const workingSize = this.working.length;
            if (workingSize > 500) {
                console.warn(`[CONTINUUM] ⚠️ Memory pressure HIGH (${workingSize} nodes). Forcing consolidation...`);
                await this.consolidateRamImmediate();
            } else if (workingSize > 400) {
                console.log(`[CONTINUUM] 📊 Memory pressure moderate (${workingSize}/500 nodes)`);
            }

            // [OPTIMIZATION] Slowed down from 5s to 30s as per user request
            // Only tick RAM tiers. LanceDB tiers are static until accessed/dreamt.
            if (now % 30000 < 1000) {
                this.tickFast(now);
                // Snapshot check (Lazy Persistence)
                if (this.isDirty) {
                    await this.saveSnapshot();
                }
            }
            if (now % 60000 < 1000) await this.tickMedium(now);
            if (now % 300000 < 1000) await this.tickLong(now); // Check every 5 mins for archival
            if (now % 600000 < 1000) await this.tickDeep(now); // Check every 10 mins for Deep Sleep

            // [NATIVE-RECOVERY] Periodic journal reconcile: boot used to be the
            // ONLY replay pass - a healthy long-lived process never recovered.
            if (now - this.lastTransitionReconcile >= this.TRANSITION_RECONCILE_INTERVAL_MS) {
                this.lastTransitionReconcile = now;
                try { await this.reconcileTransitions('pending'); }
                catch (e) { console.error('[CONTINUUM] Periodic transition reconcile failed:', e); }
            }

            // [NATIVE-RECOVERY] Native quota-gated embedding backfill. The
            // method existed with ZERO in-repo callers (only external scripts
            // ever ran it) - pending embeddings accumulated structurally.
            if (now - this.lastEmbeddingBackfill >= this.EMBEDDING_BACKFILL_INTERVAL_MS) {
                this.lastEmbeddingBackfill = now;
                try { await this.maybeRunEmbeddingBackfill(); }
                catch (e) { console.error('[CONTINUUM] Embedding backfill pass failed:', e); }
            }
        } catch (e) {
            console.error("[CONTINUUM] Maintenance Error", e);
        } finally {
            this.isMaintenanceRunning = false;
        }
    }

    private tickFast(now: number) {
        // [FIX 2026-02] Since ultraShort/short are aliases to working, "promoting" between them
        // was silently dropping nodes. Now we just update the tier in-place for frequently
        // accessed nodes and move expired nodes to hippocampus.
        const toKeep: MemoryNode[] = [];
        for (const node of this.working) {
            const age = (now - node.timestamp) / 1000;
            if (age > 900) { // 15 Minutes (Conversation Window) — move to hippocampus
                this.moveToHippocampus(node);
                toKeep.push(node); // Hippocampus is a view, never an unverified eviction.
                this.markDirty();
            } else if (node.accessCount >= 2 || node.importance >= 0.8) {
                // Mark as promoted (tier upgrade) but keep in working memory
                node.tier = MemoryTier.WORKING;
                toKeep.push(node);
                this.markDirty();
            } else {
                toKeep.push(node);
            }
        }
        this.working = toKeep;
    }

    // ...

    private insertRamNode(node: MemoryNode, tier: MemoryTier) {
        // All RAM tiers now go into unified working memory
        if (tier === MemoryTier.WORKING || tier as string === 'ULTRA_SHORT' || tier as string === 'SHORT') {
            this.working.unshift(node);
        }
    }

    private promoteToRam(node: MemoryNode, tier: MemoryTier) {
        node.tier = tier;
        this.insertRamNode(node, tier);
    }

    private async tickLong(now: number) {
        // L3 -> L4 (Medium -> Long/Archived)
        try {
            // OPTIMIZED: Fetch only MEDIUM nodes for archival check
            const mediumNodes = await lancedbService.getNodesByTier(MemoryTier.MEDIUM, 1000);

            let archivedCount = 0;
            for (const node of mediumNodes) {
                const ageMs = now - node.timestamp;
                // Demo: 15 minutes (900000ms) - Increased for better context
                if (ageMs > 30 * 24 * 60 * 60 * 1000 && node.accessCount < 5) {
                    // console.log(`[CONTINUUM] Archiving node ${node.id} to LONG tier.`);
                    const archivedNode = { ...node, tier: MemoryTier.LONG, compressionLevel: 1 };
                    await memoryTransitions.transition(node, archivedNode);
                    archivedCount++;
                }
            }
            if (archivedCount > 0) {
                console.log(`[CONTINUUM] Archived ${archivedCount} nodes to LONG tier.`);
            }
        } catch (e) {
            console.error("[CONTINUUM] tickLong failed", e);
        }
    }

    private async tickDeep(now: number) {
        // L4 -> L5 (Long -> Deep/Vector)
        // This is the "Deep Sleep" Protocol to prevent LONG tier accumulation.
        try {
            // Fetch LONG nodes that are "Old" (> 24h simulated, or 10 mins for demo)
            // For immediate cleanup as requested by user, we'll set a shorter threshold or checking logic.
            const longNodes = await lancedbService.getNodesByTier(MemoryTier.LONG, 1000);

            // Consolidate in chunks of 5 (Lowered for responsiveness)
            const candidates = longNodes.filter(n => {
                const ageMs = now - n.timestamp;
                return ageMs > 90 * 24 * 60 * 60 * 1000; // 90 days in normal operation
            });

            console.log(`[CONTINUUM] 🔍 Deep Sleep Check: Found ${candidates.length} candidates (Threshold: 3)`);

            if (candidates.length >= 3) {
                const batch = selectSleepBatch(candidates, 5); // Process 5 at a time
                console.log(`[CONTINUUM] 💤 Triggering Deep Sleep for ${batch.length} nodes...`);

                // Dynamic import to avoid circular dependency
                const { dreamer } = await import('./dreamerService');
                const archiveId = await dreamer.consolidateLongTerm(batch);
                if (!await lancedbService.getNodeById(archiveId)) throw new Error(`Missing archive ${archiveId}`);

                // If successful, delete them from LONG (LanceDB)
                // LanceDB currently doesn't have a reliable 'deleteMany', so we 'soft delete' or just move them?
                // Actually lancedbService.store can overwrite.
                // But efficient cleanup requires deletion.
                // Let's implement a 'drop' or 'delete' in lancedbService for IDs, OR
                // simpler: Mark them as TIER: DEEP in LanceDB too (as a backup/log) but filter them out in UI.

                for (const node of batch) {
                    const archived = { ...node, tier: MemoryTier.DEEP, tags: [...new Set([...node.tags, 'ARCHIVED', `archive:${archiveId}`])] };
                    await memoryTransitions.transition(node, archived);
                }
            }

        } catch (e) {
            console.error("[CONTINUUM] tickDeep failed", e);
        }
    }


    private moveToHippocampus(node: MemoryNode) {
        if (this.hippocampus.find(n => n.id === node.id)) return;
        this.hippocampus.push(node);
        if (this.hippocampus.length >= this.HIPPOCAMPUS_CAPACITY) {
            import('./dreamerService').then(({ dreamer }) => {
                dreamer.attemptDream();
            });
        }
    }

    private calculateInitialImportance(content: string, tags: string[]): number {
        let score = 0.5;
        if (tags.includes('CRITICAL')) score = 1.0;
        if (tags.includes('SACRED')) score = 1.0;
        if (tags.includes('IDENTITY')) score = 1.0;
        if (tags.includes('user-input')) score += 0.4;
        if (content.length > 200) score += 0.2;
        return Math.min(score, 1.0);
    }

    /**
     * [FIX] Identity Re-Perspectiver
     * Transforms first-person user statements to third-person before storage.
     * Prevents Silhouette from confusing user identity with her own.
     * 
     * Example: "Yo soy Alberto" → "El usuario se identifica como Alberto"
     * 
     * CRITICAL: Must NOT transform Silhouette's own responses!
     */
    private transformUserPerspective(content: string, tags: string[]): string {
        // EXPLICIT EXCLUSION: Never transform Silhouette's own responses
        const isAssistantMessage = tags.some(t => {
            const lower = t.toLowerCase();
            return lower.includes('assistant') ||
                lower.includes('silhouette') ||
                lower.includes('agent') ||
                lower.includes('system') ||
                lower.includes('narrative') ||
                lower.includes('response');
        });

        if (isAssistantMessage) {
            return content; // Don't transform Silhouette's messages
        }

        // Content-based detection: If it mentions Silhouette by name, it's her response
        const lowerContent = content.toLowerCase();
        if (lowerContent.includes('soy silhouette') ||
            lowerContent.includes('silhouette,') ||
            lowerContent.includes('soy silu') ||
            lowerContent.includes('como silhouette')) {
            return content; // Silhouette is talking about herself
        }

        // Only transform if explicitly tagged as user input
        const isUserMessage = tags.some(t => {
            const lower = t.toLowerCase();
            return lower === 'user' ||
                lower === 'user_message' ||
                lower === 'user_input' ||
                lower.includes('input');
        });

        if (!isUserMessage) {
            return content;
        }

        let transformed = content;
        for (const { pattern, replacement } of ContinuumMemorySystem.IDENTITY_TRANSFORMS) {
            // Reset lastIndex for global regex
            pattern.lastIndex = 0;
            transformed = transformed.replace(pattern, replacement);
        }

        if (transformed !== content) {
            console.log(`[CONTINUUM] 🔄 Identity Re-Perspectived: "${content.substring(0, 40)}..." → "${transformed.substring(0, 40)}..."`);
        }
        return transformed;
    }

    // Stats Cache
    private cachedStats: any = null;
    private lastStatsCacheTime = 0;
    // [R11] write revision: every mutation bumps it, so a stats snapshot is
    // only served from cache while no write happened. Revision + timestamp
    // travel with the snapshot so consumers compare like with like.
    private writeRevision = 0;
    private markDirty() {
        this.isDirty = true;
        this.dirtyRevision++;
        this.writeRevision++;
    }

    public async getStats() {
        const now = Date.now();
        // [R11] cache is valid only while NO write happened (revision match);
        // the 30s TTL alone served stale counts after writes.
        if (this.cachedStats && this.cachedStats.revision === this.writeRevision
            && (now - this.lastStatsCacheTime < this.CACHE_TTL)) {
            return this.cachedStats;
        }

        // Fetch real stats from Vector Memory (Deep Tier)
        let vectorStats = { count: 0, vectorsCount: 0 };
        try {
            // Dynamic import to avoid circular dependencies
            const { vectorMemory } = await import('./vectorMemoryService');
            vectorStats = await vectorMemory.getStats();
        } catch (e) {
            console.error("[CONTINUUM] Failed to fetch stats from Vector Memory", e);
        }

        // Fetch real stats from LanceDB (Medium/Long Tiers)
        let dbNodes: MemoryNode[] = [];
        try {
            dbNodes = await lancedbService.getAllNodes();
        } catch (e) {
            console.error("[CONTINUUM] Failed to fetch stats from LanceDB", e);
        }

        const mediumCount = dbNodes.filter(n => n.tier === MemoryTier.MEDIUM || !n.tier).length;
        const longCount = dbNodes.filter(n => n.tier === MemoryTier.LONG).length;

        // [R11] deep counted from the SAME dedup merge getAllNodes uses
        // (Qdrant live vectors + LanceDB archived DEEP, dedup by id), so the
        // stats and the node listing can never disagree. deepVectors keeps the
        // raw Qdrant total visible for transparency.
        let deepCount = vectorStats.count;
        try {
            const { vectorMemory } = await import('./vectorMemoryService');
            const deepVectors = await vectorMemory.getAllNodes(100);
            const deepArchived = dbNodes.filter(n => n.tier === MemoryTier.DEEP);
            const deepMap = new Map<string, any>();
            deepArchived.forEach(n => deepMap.set(n.id, n));
            deepVectors.forEach((v: any) => deepMap.set(v.id, v));
            deepCount = deepMap.size;
        } catch (e) {
            console.error("[CONTINUUM] Failed to dedup deep stats; falling back to raw vector count", e);
        }

        // [FIX 2026-02] Use working.length directly (ultraShort/short are aliases — was double-counting)
        const workingCount = this.working.length;

        // [R11] measured health: average decayHealth over sampled nodes;
        // null (not a fixed 100) when there is nothing to measure.
        const healthSample = [
            ...this.working,
            ...dbNodes.filter(n => typeof (n as any).decayHealth === 'number')
        ];
        const avgHealth = healthSample.length > 0
            ? Math.round(healthSample.reduce((acc, n) => acc + ((n as any).decayHealth ?? 100), 0) / healthSample.length)
            : null;

        this.cachedStats = {
            revision: this.writeRevision,
            timestamp: now,
            working: workingCount,
            // Legacy fields (kept for backward compat, both report the unified count)
            ultra: workingCount,
            short: 0,
            medium: mediumCount,
            long: longCount,
            deep: deepCount,
            deepVectors: vectorStats.count,
            total: workingCount + mediumCount + longCount + deepCount,
            avgHealth,
            archivedNodes: longCount
        };
        this.lastStatsCacheTime = now;

        return this.cachedStats;
    }



    // --- DEBUG / ADMIN METHODS ---
    public async forceSave() {
        // Persist volatile memory to Redis/Disk immediately
        const receipt = await this.saveSnapshot();
        console.log("[CONTINUUM] forceSave completed.");
        return receipt;
    }

    public async debug_forceTick(tier?: string) {
        const now = Date.now();
        if (tier === 'DEEP') {
            await this.tickDeep(now);
        } else {
            this.tickFast(now);
            await this.tickMedium(now);
        }
    }

    public debug_ageNode(nodeId: string, ageMs: number = 3600000) {
        const node = this.working.find(n => n.id === nodeId);
        if (node) {
            node.timestamp -= ageMs;
        }
    }

    public debug_boostNode(nodeId: string, importance: number = 1.0, accessCount: number = 10, addTag: boolean = false) {
        const node = this.working.find(n => n.id === nodeId);
        if (node) {
            node.importance = importance;
            node.accessCount += accessCount;
            if (addTag) node.tags.push('IDENTITY');
        }
    }
    public async search(query: string, scope: MemoryScope = {}): Promise<MemoryNode[]> {
        const lists: MemoryNode[][] = [];

        // [ROOT CAUSE FIX] Defensive Guard
        if (!query || typeof query !== 'string') return [];


        // [FIX 2026-02] Use working directly (ultraShort/short are aliases to same array)
        // Tokenized lexical match (all query tokens, any order, accent/case-insensitive); exact phrase ranks first.
        const ramResults = this.working
            .filter(n => inScope(n, scope) && lexicalMatches(n.content || "", query))
            .sort((a, b) => lexicalScore(b.content || "", query) - lexicalScore(a.content || "", query));
        lists.push(ramResults);

        try {
            // 2. Search LanceDB (Semantic or Text)
            // For now, still text based fallback for LanceDB until we add embedding there too
            const dbResults = await lancedbService.searchByContent(query, 50, scope);
            lists.push(dbResults);

            // 3. Deep Memory (SEMANTIC / VECTOR)
            // [FIX 2026-10-17] The query embeds with the SAME resolver as the
            // write path and searches the per-identity LanceDB projection
            // matching the vector actually produced - no env var can make write
            // and query identities diverge again. Qdrant is queried only when
            // actually connected and the dimension matches its 768 requirement.
            const { vectorMemory } = await import('./vectorMemoryService');
            const geminiMod = await import('./geminiService');
            const embedWithIdentity = geminiMod.geminiService?.generateEmbeddingWithIdentity || geminiMod.generateEmbeddingWithIdentity;
            const embedded = typeof embedWithIdentity === 'function' ? await embedWithIdentity(query) : null;

            if (embedded) {
                console.log(`[CONTINUUM] Semantic search via ${embedded.identity.model} (${embedded.identity.dimension}d)`);
                lists.push((await lancedbService.search(embedded.vector, 50, scopeSql(scope), embedded.identity)).filter(n => inScope(n, scope)));

                if (embedded.identity.dimension === 768 && vectorMemory.isReady()) {
                    const deepVectors = await vectorMemory.searchMemory(embedded.vector, 50, scope.ownerId ? { ownerId: scope.ownerId } : undefined);
                    const deepNodes = deepVectors.map(v => ({
                        ...v.payload,
                        id: v.id,
                        content: v.payload?.content || "Vector Result",
                        tier: MemoryTier.DEEP,
                        timestamp: v.payload?.timestamp || Date.now(),
                        tags: v.payload?.tags || [],
                        importance: v.payload?.importance || (v.score ? v.score : 1), // Use vector score if available
                        decayHealth: 100,
                        accessCount: 0,
                        lastAccess: Date.now(),
                        compressionLevel: 0
                    }));
                    lists.push(deepNodes.filter(n => inScope(n, scope)));
                }
            } else {
                console.warn("[CONTINUUM] Embedding UNAVAILABLE (no provider configured or provider error) - deep memory served by text search only.");
            }

        } catch (e) {
            console.error("[CONTINUUM] Search failed:", e);
        }

        // Deduplicate by ID
        return fuseMemories(lists.map(list => list.sort((a, b) => activation(b).score - activation(a).score)), query);
    }
    /**
     * [NATIVE-RECOVERY] Native embedding-backfill scheduler, gated on the
     * OBSERVABLE quota ledger (same mechanism as PR-K text generation; budgets
     * come from env config, not guessed here). Blocked state is reported
     * honestly as an incident instead of burning provider calls; recovery
     * resolves the same incident. No notification leaves the system.
     */
    public async maybeRunEmbeddingBackfill(
        ledger: QuotaLedger = quotaLedger,
        runBackfill: (limit: number) => Promise<{ projected: number; failed: number }> = (l) => this.backfillMemoryEmbeddings(l),
    ): Promise<{ ran: boolean; reason?: string; projected?: number; failed?: number }> {
        // [QUOTA-COOLDOWN] Real provider 429 (RetryInfo) outranks the local
        // ledger: skip the pass without burning calls or spamming incidents.
        const cooldown = ledger.cooldownUntil('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
        if (cooldown) {
            return { ran: false, reason: `provider cooldown until ${new Date(cooldown).toISOString()} (real 429 RetryInfo); pending embeddings retained` };
        }
        const status = ledger.status('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
        const { incidentRegistry } = await import('./incidentRegistry');
        if (!status.allowed) {
            incidentRegistry.recordIncident('continuum-embeddings', 'error', 'embedding backfill blocked by quota budget',
                `local daily budget spent for gemini:${DEFAULT_GEMINI_EMBEDDING_MODEL} (${status.used}/${status.budget} attempts, day ${status.day}). Pending embeddings are retained and retried after quota reset.`);
            return { ran: false, reason: `quota budget spent (${status.used}/${status.budget}, day ${status.day})` };
        }
        // [BACKFILL-GOVERNOR] Budget-aware pacing: the backfill shares the
        // daily budget with LIVE writes/searches (new memories must always
        // embed). Without a reserve, a large backlog alone can drain the
        // whole daily provider cap (observed 2026-10-23: cap hit mid-day).
        // The 20% live reserve is an INITIAL CONFIGURABLE POLICY
        // (BACKFILL_LIVE_RESERVE), not a user-approved budget. One backfill
        // item = one provider attempt in this path (no batching).
        // The batch is RESERVED ATOMICALLY (quotaLedger.reserve) so a
        // concurrent live write cannot over-assign the same headroom; the
        // backfill path then skips per-item ledger recording (preReserved)
        // so attempts are counted exactly once, failures included.
        const reserve = Number(process.env.BACKFILL_LIVE_RESERVE ?? Math.ceil(status.budget * 0.2));
        const batchLimit = Math.min(50, Math.max(0, status.budget - status.used - reserve));
        if (batchLimit <= 0) {
            incidentRegistry.recordIncident('continuum-embeddings', 'error', 'embedding backfill blocked by quota budget',
                `daily headroom reserved for live writes (${status.used}/${status.budget} used, reserve ${reserve}, day ${status.day}). Pending embeddings are retained and retried after quota reset.`);
            return { ran: false, reason: `headroom reserved for live writes (${status.used}/${status.budget}, reserve ${reserve}, day ${status.day})` };
        }
        const hold = ledger.reserve('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL, batchLimit);
        if (!hold.reserved) {
            return { ran: false, reason: `backfill reservation lost to concurrent consumer (${hold.used}/${hold.budget}); live writes keep priority` };
        }
        const result = await runBackfill(batchLimit);
        if (result.projected > 0) {
            incidentRegistry.resolveIncidents('continuum-embeddings', 'error');
        } else if (result.failed > 0) {
            incidentRegistry.recordIncident('continuum-embeddings', 'error', 'embedding backfill pass failed',
                'provider rejected every attempt this pass; pending rows retained for the next pass');
        }
        return { ran: true, ...result };
    }

    /**
     * Backfill vector projections for canonical memories still in
     * EMBEDDING_PENDING state (every memory written before per-identity
     * projections existed). Uses the SAME resolver as the live write path, so
     * backfilled and new vectors share one identity space. Failures stay
     * EMBEDDING_PENDING and are retried on the next pass.
     */
    public async backfillMemoryEmbeddings(limit = 50): Promise<{ projected: number; failed: number }> {
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid backfill limit');
        const { generateEmbeddingWithIdentity } = await import('./geminiService');
        const pending = await lancedbService.pendingEmbeddings(limit);
        let projected = 0, failed = 0;
        for (const node of pending) {
            try {
                // preReserved: the governor already counted this batch
                // atomically; per-item recording would double-count.
                const embedded = await generateEmbeddingWithIdentity(node.content, { allowFallbackIdentity: false, preReserved: true });
                if (!embedded) { failed++; continue; }
                await lancedbService.projectEmbedding(node, embedded.vector, embedded.identity);
                projected++;
            } catch (error: any) {
                failed++;
                console.warn(`[CONTINUUM] Backfill failed for ${node.id} (stays pending):`, error?.message || error);
            }
        }
        if (projected || failed) console.log(`[CONTINUUM] Embedding backfill: ${projected} projected, ${failed} failed.`);
        return { projected, failed };
    }

    // --- MANUAL CONSOLIDATION VOID ---
    public async consolidateRamImmediate(): Promise<{ promoted: number }> {
        console.log("[CONTINUUM] 🌪️ FORCE CONSOLIDATION INITIATED");
        let count = 0;

        // [PR-4b] Per-node isolation: a failing promotion must not escape as an
        // unhandled rejection (prod FATAL) nor abort the remaining consolidations.
        let failed = 0;
        for (const node of [...this.working]) {
            try { await this.promoteWorking(node, ['CONSOLIDATED']); count++; await this.notePromoteSuccess(); }
            catch (error) { failed++; console.error(`[CONTINUUM] Consolidation failed for ${node.id}; source remains in RAM:`, error); await this.notePromoteFailure(node.id, error); }
        }

        console.log(`[CONTINUUM] 🌪️ Consolidated ${count} memories to L3 (LanceDB). ${failed > 0 ? `⚠️ ${failed} failed (sources kept in RAM).` : 'RAM is empty.'}`);
        return { promoted: count };
    }
}

export const continuum = new ContinuumMemorySystem();
