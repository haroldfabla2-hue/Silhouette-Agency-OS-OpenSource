import { lexicalMatches, lexicalScore } from "./lexicalMatch.js";
import { atomicWriteFile } from "./utils/atomicWrite.js";
import { MemoryTier } from "../types.js";
import { lancedbService } from "./lancedbService.js";
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerContinuumPersistenceClose } from "./lifecycle/ownedProducers.js";
import { fuseMemories, inScope, scopeSql } from "./memoryRetrieval.js";
import { activation, selectSleepBatch } from "./memoryCognition.js";
import { memoryTransitions, isOutstandingTransition } from "./memoryTransitions.js";
import { quotaLedger } from "./quotaLedger.js";
import { DEFAULT_GEMINI_EMBEDDING_MODEL } from "./llm/defaultModels.js";
import { introspection } from "./introspectionEngine.js";
import { redisClient } from "./redisClient.js";
import * as fs from 'fs/promises';
import * as path from 'path';
import { systemBus } from "./systemBus.js";
import { SystemProtocol } from "../types.js";
import { MemoryNodeSchema } from "./memorySchema.js"; // Added missing import
import { beginStoreRootScope, beginChild } from "./asyncWorkLedger.js"; // [O2-OBSERVE] observation-only ledger (zero product imports)
const SNAPSHOT_PATH = path.join(process.cwd(), 'data', 'memory_snapshot.json');
// --- SILHOUETTE CONTINUUM MEMORY SYSTEM V5.0 (UNIFIED WORKING MEMORY) ---
// Architecture: 4-Tier Hierarchical Storage
// L1: RAM (WORKING - Unified Fast Access)
// L2: LanceDB MEDIUM (Persistent - Frequently accessed)
// L3: LanceDB LONG (Archived)
// L4: Qdrant DEEP (Semantic vectors)
/** Positive integer from env with a documented default (NaN/<=0 falls back). */
function positiveIntEnv(name, fallback) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
class ContinuumMemorySystem {
    assertMutationAdmission() {
        const inherited = this.mutationContext.getStore();
        if (this.persistenceClosing && !(inherited && this.mutationTasks.has(inherited))) {
            throw new Error('CONTINUUM_MUTATION_ADMISSION_CLOSED');
        }
    }
    assertSynchronousMutation() {
        this.assertMutationAdmission();
        if (this.hydrationState === 'failed')
            throw this.hydrationError;
        if (this.hydrationState !== 'ready')
            throw new Error('CONTINUUM_HYDRATION_NOT_READY');
    }
    mutate(operation) {
        try {
            this.assertMutationAdmission();
        }
        catch (error) {
            return Promise.reject(error);
        }
        const ticket = Symbol('continuum-mutation');
        // Register ownership synchronously, before hydration or operation awaits.
        const work = this.mutationContext.run(ticket, async () => {
            await this.hydration;
            return operation();
        });
        this.mutationTasks.set(ticket, work);
        void work.then(() => { this.mutationTasks.delete(ticket); }, error => {
            // Operation rejection belongs to its caller. A missing ID,
            // invalid request or optional provider is not a failed disk write.
            this.mutationTasks.delete(ticket);
        });
        return work;
    }
    /** Fence new mutations, await accepted work and flush the newest state.
     * No timeout, cancellation, provider shutdown or full-app quiescence claim.
     * Callers must stop outside producers first. Failures remain sticky: a
     * second close cannot erase an earlier failed snapshot commit.
     */
    closePersistence() {
        const caller = this.mutationContext.getStore();
        if (caller && this.mutationTasks.has(caller))
            return Promise.reject(new Error('CONTINUUM_CLOSE_FROM_MUTATION'));
        this.persistenceClosing = true;
        if (this.persistenceCloseTask)
            return this.persistenceCloseTask;
        this.persistenceCloseTask = (async () => {
            // Even a load/recovery failure must not return while other already
            // accepted callers are still settling. Startup recovery is tracked.
            await Promise.allSettled([this.hydration]);
            while (this.mutationTasks.size) {
                await Promise.allSettled([...this.mutationTasks.values()]);
            }
            // Already accepted mutations may have enqueued their last save.
            await Promise.allSettled([this.queueSnapshot()]);
            if (this.hydrationState === 'failed')
                throw this.hydrationError;
            if (this.snapshotFailed)
                throw this.snapshotFailure;
        })();
        return this.persistenceCloseTask;
    }
    queueSnapshot() {
        const work = this.snapshotTail.then(async () => {
            await this.hydration;
            // Capture all serializable fields only once this commit owns its
            // turn. Older payloads cannot rename after a newer commit.
            const revision = this.writeRevision;
            const payload = JSON.stringify({ working: this.working, ultraShort: this.working, short: [] }, null, 2);
            try {
                await redisClient.set('continuum:volatile', payload, 3600);
            }
            catch (error) {
                console.warn('[CONTINUUM] Redis snapshot unavailable:', error);
            }
            await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
            await atomicWriteFile(SNAPSHOT_PATH, payload);
            if (this.writeRevision === revision && !this.snapshotFailed)
                this.isDirty = false;
        });
        // Catch keeps the queue usable, but does not fulfill this caller's
        // promise or erase failure history from the close receipt.
        this.snapshotTail = work.then(() => { }, error => {
            if (!this.snapshotFailed)
                this.snapshotFailure = error;
            this.snapshotFailed = true;
            this.isDirty = true;
        });
        return work;
    }
    // Legacy aliases for backward compatibility (both point to working)
    // These getters/setters allow existing code to continue working
    get ultraShort() { return this.working; }
    set ultraShort(value) { this.assertSynchronousMutation(); this.working = structuredClone(value); this.markDirty(); }
    get short() { return this.working; }
    set short(value) { this.assertSynchronousMutation(); this.working = structuredClone(value); this.markDirty(); }
    static { this.LOOP_PATTERNS = [
        /I'm committing this to memory: I'm committing/i,
        /Storing memory: Storing memory/i,
        /memory that is identical to itself/i,
        /I'm aware of: Storing memory/i,
        /NARRATIVE.*NARRATIVE/i
    ]; }
    // [FIX] Identity Re-Perspectiver: Transforms first-person user statements to third-person
    // Prevents Silhouette from confusing user identity with her own
    static { this.IDENTITY_TRANSFORMS = [
        { pattern: /^yo soy ([a-záéíóúñ]+)/gi, replacement: 'El usuario se identifica como $1' },
        { pattern: /^mi nombre es ([a-záéíóúñ]+)/gi, replacement: 'El usuario indica que su nombre es $1' },
        { pattern: /^me llamo ([a-záéíóúñ]+)/gi, replacement: 'El usuario indica que se llama $1' },
        { pattern: /prefiero que me llam(es|en) ([a-záéíóúñ]+)/gi, replacement: 'El usuario prefiere ser llamado $2' },
        { pattern: /puedes llamarme ([a-záéíóúñ]+)/gi, replacement: 'El usuario prefiere ser llamado $1' },
        { pattern: /llámame ([a-záéíóúñ]+)/gi, replacement: 'El usuario desea ser llamado $1' },
        { pattern: /^soy ([a-záéíóúñ]+)/gi, replacement: 'El usuario indica que es $1' },
        { pattern: /mi apodo es ([a-záéíóúñ]+)/gi, replacement: 'El apodo del usuario es $1' },
    ]; }
    checkDirty() {
        const wasDirty = this.isDirty;
        return wasDirty; // Never clear before a durable snapshot succeeds.
    }
    // ...
    async promoteWorking(node, tags = []) {
        return this.mutate(async () => {
            const promoted = { ...node, tier: MemoryTier.MEDIUM, tags: [...node.tags, ...tags] };
            await memoryTransitions.transition(node, promoted);
            // Do not remove a replacement with the same ID that arrived while writing.
            this.working = this.working.filter(n => n !== node);
            this.markDirty();
            await this.saveSnapshot();
        });
    }
    // [NATIVE-RECOVERY] Structured failure reporting: promote failures used to
    // reach console ONLY, so the self-healing channel (incident registry, read
    // every 15 min) never saw the 969k-failure episode. One incident per
    // episode (registry dedupes + bumps occurrences); recovery resolves the
    // SAME incident. 3 consecutive failures debounce transients.
    async notePromoteFailure(nodeId, error) {
        this.consecutivePromoteFailures++;
        console.error(`[CONTINUUM] Failed to promote ${nodeId}`, error);
        if (this.consecutivePromoteFailures >= 3) {
            try {
                const { incidentRegistry } = await import("./incidentRegistry.js");
                incidentRegistry.recordIncident('continuum-promote', 'error', 'memory promotion failing', `consecutive promote failures: ${this.consecutivePromoteFailures}; last error: ${error?.message ?? String(error)}`);
            }
            catch (e) {
                console.warn('[CONTINUUM] incident reporting failed (promotion failure still logged above):', e);
            }
        }
    }
    async notePromoteSuccess() {
        this.consecutivePromoteFailures = 0;
        try {
            const { incidentRegistry } = await import("./incidentRegistry.js");
            incidentRegistry.resolveIncidents('continuum-promote', 'error');
        }
        catch { /* reporting must never break memory flow */ }
    }
    async tickMedium(now) {
        return this.mutate(async () => {
            const toPromote = this.working.filter(node => now - node.timestamp > 900000 || node.accessCount > 10 || node.importance >= 0.95);
            for (const node of toPromote) {
                try {
                    await this.promoteWorking(node);
                    await this.notePromoteSuccess();
                }
                catch (e) {
                    await this.notePromoteFailure(node.id, e);
                }
            }
        });
    }
    constructor() {
        // No hydration needed for LanceDB, it's always on disk.
        // RAM tiers start empty on reboot (Tabula Rasa for short term) UNLESS hydrated explicitly.
        this.hydrationState = 'loading';
        this.snapshotTail = Promise.resolve();
        this.snapshotFailed = false;
        this.mutationContext = new AsyncLocalStorage();
        this.mutationTasks = new Map();
        this.persistenceClosing = false;
        this.persistenceCloseTask = null;
        // === UNIFIED WORKING MEMORY (RAM - Fast Access) ===
        // [REFACTOR 2026-01-07] Merged ultraShort + short into single working array
        // TTL: 30 mins (promoted to MEDIUM if accessed frequently or aged)
        this.working = [];
        // Dirty Flag for Persistence Optimization
        this.isDirty = false;
        // [FIX] Anti-Recursion: Hash-based deduplication to prevent infinite loops
        this.recentHashes = new Set();
        // ...
        this.hippocampus = []; // Holds decayed memories for dreaming
        // Configuration
        this.HIPPOCAMPUS_CAPACITY = 50; // Trigger dream when full
        this.CACHE_TTL = 30000; // 30 Seconds
        this.RAM_HARD_CAP = 600; // [FIX 2026-02] Hard limit — force-consolidate above this
        // [NATIVE-RECOVERY] Self-recovery cadences ride the EXISTING maintenance
        // tick (no new timers). Env-tunable; defaults documented here.
        this.TRANSITION_RECONCILE_INTERVAL_MS = positiveIntEnv('CONTINUUM_RECONCILE_INTERVAL_MS', 15 * 60 * 1000);
        this.EMBEDDING_BACKFILL_INTERVAL_MS = positiveIntEnv('CONTINUUM_EMBEDDING_BACKFILL_INTERVAL_MS', 60 * 60 * 1000);
        this.lastTransitionReconcile = 0;
        this.lastEmbeddingBackfill = 0;
        this.consecutivePromoteFailures = 0;
        // --- MAINTENANCE TICKERS ---
        this.isMaintenanceRunning = false;
        // Stats Cache
        this.cachedStats = null;
        this.lastStatsCacheTime = 0;
        // [R11] write revision: every mutation bumps it, so a stats snapshot is
        // only served from cache while no write happened. Revision + timestamp
        // travel with the snapshot so consumers compare like with like.
        this.writeRevision = 0;
        // [LIFECYCLE] Import must be side-effect free: Redis connects lazily
        // on first operation (redisClient.ensureConnected), and the Dreaming
        // loop starts explicitly at server boot (server/loaders/index.ts) -
        // a fire-and-forget connect here raced test-worker teardown and
        // crashed CI intermittently. Disk/journal recovery never depended on
        // Redis availability.
        registerContinuumPersistenceClose(() => this.closePersistence());
        this.hydration = this.loadSnapshot().then(() => { this.hydrationState = 'ready'; }, error => {
            this.hydrationState = 'failed';
            this.hydrationError = error;
            throw error;
        });
        this.startupRecovery = this.mutate(() => this.reconcileTransitions());
        void this.startupRecovery.catch(err => console.error('[CONTINUUM] Failed to recover memory:', err));
    }
    // --- PUBLIC API ---
    ready() { return this.hydration; }
    /** Apply Janitor's bounded field edits under owner admission, never expose
     * mutable RAM. Non-WORKING IDs are explicitly NOT persisted by this owner.
     * Compare only touched fields against the original read, so concurrent
     * store/recall updates cannot be overwritten by a stale borrowed snapshot.
     */
    applyWorkingEdits(edits, requireAllWorking = false) {
        // Take ownership at entry, before hydration awaits or caller edits.
        const owned = structuredClone(edits);
        return this.mutate(async () => {
            const outsideWorking = [];
            const replacements = new Map();
            const seen = new Set();
            const fields = ['content', 'originalContent', 'tags', 'importance'];
            for (const edit of owned) {
                if (!edit.id || seen.has(edit.id))
                    throw new Error('CONTINUUM_EDIT_IDS_INVALID');
                seen.add(edit.id);
                const node = this.working.find(n => n.id === edit.id);
                if (!node) {
                    outsideWorking.push(edit.id);
                    continue;
                }
                const changes = {};
                for (const key of fields) {
                    if (JSON.stringify(edit.before[key]) === JSON.stringify(edit.after[key]))
                        continue;
                    if (JSON.stringify(node[key]) !== JSON.stringify(edit.before[key]))
                        throw new Error('CONTINUUM_EDIT_CONFLICT');
                    Object.assign(changes, { [key]: edit.after[key] });
                }
                const candidate = { ...node, ...changes };
                if (typeof candidate.content !== 'string' || !Array.isArray(candidate.tags) ||
                    !candidate.tags.every(t => typeof t === 'string') || !Number.isFinite(candidate.importance) ||
                    candidate.importance < 0 || candidate.importance > 1 ||
                    (candidate.originalContent !== undefined && typeof candidate.originalContent !== 'string'))
                    throw new Error('CONTINUUM_EDIT_INVALID');
                if (Object.keys(changes).length)
                    replacements.set(node, candidate);
            }
            // Strict callers cannot partially resolve a cross-owner pair.
            if (requireAllWorking && outsideWorking.length)
                throw new Error('CONTINUUM_EDIT_OWNER_UNSUPPORTED');
            // All checks complete before a single synchronous RAM mutation.
            if (replacements.size) {
                this.working = this.working.map(n => replacements.get(n) || n);
                this.markDirty();
                try {
                    await this.saveSnapshot();
                }
                catch (error) {
                    // RAM was changed, disk is unverified. Callers must not
                    // retry a relative importance/content edit as if unapplied.
                    throw new Error('CONTINUUM_EDIT_COMMIT_FAILED', { cause: error });
                }
            }
            return { updated: [...replacements.values()].map(n => n.id), outsideWorking };
        });
    }
    async forceConsolidation() {
        console.log("[CONTINUUM] 🧠 Forcing Memory Consolidation...");
        return await this.consolidateRamImmediate();
    }
    // --- PERSISTENCE SNAPSHOTS ---
    saveSnapshot() {
        return this.queueSnapshot();
    }
    async loadSnapshot() {
        try {
            let snapshot = null;
            let source = '';
            // Disk is the durable authority; Redis can be stale after a disk failure.
            try {
                snapshot = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf-8'));
                source = 'DISK';
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
                const redisData = await redisClient.get('continuum:volatile');
                if (redisData) {
                    snapshot = JSON.parse(redisData);
                    source = 'REDIS';
                }
            }
            if (!source)
                return;
            if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
                !(Array.isArray(snapshot.working) || Array.isArray(snapshot.ultraShort) || Array.isArray(snapshot.short))) {
                throw new Error('CONTINUUM_SNAPSHOT_SHAPE_INVALID');
            }
            // Validate without rebuilding, truncating or normalizing stored data.
            const loadedNodes = Array.isArray(snapshot.working) ? snapshot.working : [...(snapshot.ultraShort || []), ...(snapshot.short || [])];
            for (const node of loadedNodes) {
                if (!node || typeof node.id !== 'string' || !node.id || typeof node.content !== 'string' ||
                    !Array.isArray(node.tags) || !node.tags.every((t) => typeof t === 'string') ||
                    !Number.isFinite(node.timestamp))
                    throw new Error('CONTINUUM_SNAPSHOT_NODE_INVALID');
            }
            // [REFACTOR 2026-01-07] Handle both V5.0 and legacy formats
            // V5.0 format has 'working' key
            // Legacy format has 'ultraShort' and 'short' keys
            const existingIds = new Set(this.working.map(n => n.id));
            if (snapshot.working && Array.isArray(snapshot.working)) {
                // New V5.0 format - MERGE instead of overwrite to prevent race conditions during boot
                const snapshotNodes = snapshot.working.filter((n) => !existingIds.has(n.id));
                this.working.push(...snapshotNodes);
                console.log(`[CONTINUUM] Restored Memory from ${source} (V5.0 format): ${snapshotNodes.length} merged into WORKING tier`);
            }
            else {
                // Legacy format - merge ultraShort + short into working
                const legacyNodes = [];
                if (snapshot.ultraShort && Array.isArray(snapshot.ultraShort)) {
                    legacyNodes.push(...snapshot.ultraShort.filter((n) => !existingIds.has(n.id)));
                }
                if (snapshot.short && Array.isArray(snapshot.short)) {
                    legacyNodes.push(...snapshot.short.filter((n) => !existingIds.has(n.id)));
                }
                this.working.push(...legacyNodes);
                console.log(`[CONTINUUM] 🔄 MIGRATED Legacy Snapshot from ${source}: ${legacyNodes.length} nodes merged into WORKING tier`);
            }
        }
        catch (error) {
            // The only tolerated ENOENT was the disk read handled above.
            // Redis/parsing/validation failures are never new-store success.
            console.error('[CONTINUUM] Error loading snapshot:', error);
            throw error;
        }
    }
    /**
     * Boot scope 'full' preserves the historical verify-everything pass.
     * Periodic scope 'pending' skips COMMITTED entries: the journal is eternal
     * (nothing is deleted), so re-verifying all of history every cycle would
     * grow without bound - outstanding entries are the only work remaining.
     */
    async reconcileTransitions(scope = 'full') {
        return this.mutate(async () => {
            for (const entry of await memoryTransitions.pending()) {
                if (scope === 'pending' && !isOutstandingTransition(entry))
                    continue;
                try {
                    if (entry.state !== 'COMMITTED') {
                        // Keep a RAM source until the destination is independently verified.
                        if (entry.source.tier === MemoryTier.WORKING && !this.working.some(n => n.id === entry.source.id))
                            this.working.push(entry.source);
                        if (entry.source.tier !== MemoryTier.WORKING) {
                            const current = await lancedbService.getNodeById(entry.source.id);
                            if (!current || (current.tier !== entry.source.tier && current.tier !== entry.destination.tier)) {
                                throw new Error(`Source changed before replay: ${entry.key}`);
                            }
                        }
                        await memoryTransitions.resume(entry);
                    }
                    else {
                        const stored = await lancedbService.getNodeById(entry.destination.id);
                        if (JSON.stringify(stored) !== JSON.stringify(entry.destination)) {
                            throw new Error(`Committed transition missing destination: ${entry.key}`);
                        }
                    }
                    if (entry.source.tier === MemoryTier.WORKING)
                        this.working = this.working.filter(n => n.id !== entry.source.id);
                    this.markDirty();
                    await this.saveSnapshot();
                }
                catch (error) {
                    console.error(`[CONTINUUM] Recovery deferred for ${entry.key}:`, error);
                }
            }
        });
    }
    // --- PERSISTENCE HELPERS ---
    getVolatileState() {
        if (this.hydrationState === 'failed')
            throw this.hydrationError;
        if (this.hydrationState !== 'ready')
            throw new Error('CONTINUUM_HYDRATION_NOT_READY');
        // [REFACTOR 2026-01-07] Return unified working memory
        return structuredClone(this.working);
    }
    hydrateVolatile(nodes) {
        this.assertSynchronousMutation();
        // [REFACTOR 2026-01-07] All nodes go to unified working memory
        // Accept nodes from any tier (WORKING, ULTRA_SHORT, SHORT) for backward compatibility
        this.working = structuredClone(nodes).filter(n => {
            const tierStr = String(n.tier);
            return tierStr === 'WORKING' || tierStr === 'ULTRA_SHORT' || tierStr === 'SHORT';
        });
        console.log(`[CONTINUUM] Hydrated Volatile Memory: ${this.working.length} WORKING nodes`);
        this.markDirty(); // Mark as dirty to trigger save
    }
    // --- FULL SESSION CHAT HISTORY (INFINITE CONTEXT) ---
    getSessionHistory(limit = 1000) {
        if (this.hydrationState === 'failed')
            throw this.hydrationError;
        if (this.hydrationState !== 'ready')
            throw new Error('CONTINUUM_HYDRATION_NOT_READY');
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
    getShortTermMemory() {
        if (this.hydrationState === 'failed')
            throw this.hydrationError;
        if (this.hydrationState !== 'ready')
            throw new Error('CONTINUUM_HYDRATION_NOT_READY');
        return structuredClone(this.working);
    }
    getHippocampus() {
        if (this.hydrationState === 'failed')
            throw this.hydrationError;
        if (this.hydrationState !== 'ready')
            throw new Error('CONTINUUM_HYDRATION_NOT_READY');
        return structuredClone(this.hippocampus);
    }
    async getAllNodes() {
        await this.hydration;
        // 1. RAM Tier (Unified WORKING memory)
        const nodes = {
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
            const { vectorMemory } = await import("./vectorMemoryService.js");
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
                decayHealth: v.decayHealth || 100,
                accessCount: 0,
                lastAccess: Date.now(),
                compressionLevel: 0
            }));
            // Merge Qdrant + LanceDB Archive (Deduplicate by ID, preferring Qdrant)
            const deepMap = new Map();
            deepArchived.forEach(n => deepMap.set(n.id, n));
            deepFromQdrant.forEach(n => deepMap.set(n.id, n));
            nodes[MemoryTier.DEEP] = Array.from(deepMap.values());
        }
        catch (e) {
            console.error("[CONTINUUM] Failed to aggregate nodes:", e);
        }
        return structuredClone(nodes);
    }
    clearHippocampus(nodeIds) {
        this.assertSynchronousMutation();
        this.hippocampus = this.hippocampus.filter(n => !nodeIds.includes(n.id));
    }
    async deleteNode(nodeId) {
        return this.mutate(async () => {
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
            }
            catch (e) {
                console.error(`[CONTINUUM] Failed to delete node ${nodeId} from LanceDB`, e);
            }
        });
    }
    store(content, tier = MemoryTier.ULTRA_SHORT, tags = [], skipIngestion = false, extra) {
        // [O2-OBSERVE] Pure observation: nothing is suppressed, reordered
        // or awaited differently. A non-internal store opens an
        // observational root scope at ENTRY (before internal awaits); the
        // scope ends when the work settles (return, throw or early return
        // are all covered by these handlers). Internal stores
        // (skipIngestion=true) keep no scope: they launch no cascades.
        const scope = skipIngestion ? null : beginStoreRootScope('continuum.store');
        const work = this.storeWithScope(scope, content, tier, tags, skipIngestion, extra);
        if (scope !== null) {
            work.then(() => scope.end('ok'), (err) => scope.end('failed', err));
        }
        return work;
    }
    async storeWithScope(scope, content, tier = MemoryTier.ULTRA_SHORT, tags = [], skipIngestion = false, extra) {
        return this.mutate(async () => {
            // [PR-4c] Boundary coercion: an invalid tier (e.g. an LLM emitting the
            // number 28) must not reach the gatekeeper as a "corruption" event that
            // mobilizes remediation squads in a loop. Coerce loudly to WORKING;
            // the zod gatekeeper remains as the second line of defense.
            if (!Object.values(MemoryTier).includes(tier)) {
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
                const { ingestion } = await import("./ingestionService.js");
                const handled = await ingestion.ingest(content, tags);
                if (handled) {
                    this.recentHashes.add(contentHash);
                    return;
                }
            }
            // L1: RAM Storage (Unified WORKING tier)
            // Cast to string for flexible comparison (handles both enum values and legacy strings)
            const tierStr = String(node.tier);
            if (tierStr === 'WORKING' || tierStr === 'ULTRA_SHORT' || tierStr === 'SHORT') {
                // Save the incoming memory first. Failure to evict an older node may exceed
                // the soft capacity, but must never discard the new memory or its source.
                this.working.push(node);
                this.markDirty();
                await this.saveSnapshot();
                if (this.working.length > this.RAM_HARD_CAP) {
                    const evicted = this.working[0];
                    if (evicted && evicted !== node) {
                        // [O2-OBSERVE] Eviction outcome recorded BEFORE the historical absorb.
                        const evictionChild = scope !== null ? beginChild(scope, 'working-eviction') : null;
                        try {
                            await this.promoteWorking(evicted, ['EVICTED']);
                            evictionChild?.settle('ok');
                        }
                        catch (error) {
                            evictionChild?.fail(error);
                            console.error('[CONTINUUM] Eviction deferred; source remains in RAM:', error);
                        }
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
                };
                try {
                    // [FIX 2026-10-17] TRUE per-vector identity. Before: writes
                    // embedded with Minimax while queries embedded with Gemini (the
                    // identities never crossed, so semantic search never matched),
                    // and identity was labeled from an env var instead of the actual
                    // provider. Now one resolver returns vector + the identity that
                    // truly produced it; lancedbService.store projects per identity.
                    const { generateEmbeddingWithIdentity } = await import("./geminiService.js");
                    const embedded = await generateEmbeddingWithIdentity(content);
                    if (embedded)
                        nodeToStore.embeddingIdentity = embedded.identity;
                    await lancedbService.store(nodeToStore, embedded?.vector); // Canonical copy + automatic per-identity projection.
                    if (!embedded) {
                        console.warn("[CONTINUUM] No embedding provider available; stored canonically without vector (text search only).");
                    }
                    else if (embedded.identity.dimension === 768) {
                        // Optional dual-write: Qdrant only when actually connected
                        // AND the vector meets its 768-dim requirement. Qdrant is
                        // not part of the prod deployment; LanceDB projections are
                        // the deep-memory vector store.
                        try {
                            const { vectorMemory } = await import("./vectorMemoryService.js");
                            if (vectorMemory.isReady()) {
                                await vectorMemory.storeMemory(nodeToStore.id, embedded.vector, {
                                    ...nodeToStore,
                                    type: 'MEMORY_NODE'
                                });
                            }
                        }
                        catch {
                            // Canonical storage and its identified vector already succeeded.
                            // Optional Qdrant failure must not overwrite them without a vector.
                            console.warn('[CONTINUUM] Canonical deep memory retained; optional Qdrant projection unavailable.');
                        }
                    }
                }
                catch (err) {
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
                };
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
                // 4. Notify Dreamer (Event-Driven) - with null check
                // [O2-OBSERVE] Child registered BEFORE the dynamic import starts:
                // import time is observed pending time, not an idle gap. The
                // callback adopts the REAL returned work: a cap-hit dream promise
                // is awaited by the ledger (with its known escapes declared
                // sticky); a synchronous entropy increment completes immediately
                // (state changed: 'sync-completed', not a no-op). The outcome is
                // recorded BEFORE the historical absorbing catch, which still
                // absorbs for the caller exactly as before.
                const dreamerChild = scope !== null ? beginChild(scope, 'dreamer-notify') : null;
                import("./dreamerService.js").then(({ dreamer, DREAM_KNOWN_INCOMPLETE_COVERAGE }) => {
                    if (!dreamer?.notifyNewMemory) {
                        dreamerChild?.settle('producer-noop');
                        return;
                    }
                    const result = dreamer.notifyNewMemory();
                    if (result && typeof result.then === 'function') {
                        // Fulfilled dream is NOT absence of failure: its internal
                        // catch absorbs and its fire-and-forget subgraph is
                        // declared, never claimed closed.
                        DREAM_KNOWN_INCOMPLETE_COVERAGE.forEach(reason => dreamerChild?.noteIncompleteCoverage(`dreamer-notify: ${reason}`));
                        result.then(() => dreamerChild?.settle('ok'), (err) => dreamerChild?.fail(err));
                    }
                    else {
                        dreamerChild?.settle('sync-completed');
                    }
                }).catch((err) => { dreamerChild?.fail(err); /* Dreamer not available */ });
                // 5. [BRAIN] Mirror to the external silhouette-brain 4-Tier memory
                //    (fire-and-forget, no-op when the integration is disabled).
                const brainChild = scope !== null ? beginChild(scope, 'brain-mirror') : null;
                import("./brain/index.js").then(({ brainBridge }) => {
                    // [O2-OBSERVE] Child registered before the import; the real
                    // mirror outcome is returned and classified: 'disabled'/'empty'
                    // are producer no-ops (NOT losses); 'unverified-null'/'not-ok'
                    // are unverified (the client already erased the cause, and no
                    // recovery of it is claimed). Recorded BEFORE the absorbing
                    // catch, which still absorbs for the caller.
                    return brainBridge.mirrorMemory(content, {
                        importance: node.importance,
                        tags: node.tags,
                        tier: (tierStr === 'DEEP' ? 'DEEP' : tierStr === 'MEDIUM' ? 'MEDIUM' : 'WORKING'),
                    });
                }).then((mirrorOutcome) => {
                    if (mirrorOutcome === 'ok')
                        brainChild?.settle('ok');
                    else if (mirrorOutcome === 'disabled' || mirrorOutcome === 'empty')
                        brainChild?.settle('producer-noop');
                    else
                        brainChild?.settle('unverified');
                }).catch((err) => { brainChild?.fail(err); /* Brain integration not available */ });
            }
        });
    }
    async recordMeaningfulRecall(id, now = Date.now()) {
        return this.mutate(async () => {
            const source = this.working.find(n => n.id === id) || await lancedbService.getNodeById(id);
            if (!source)
                throw new Error(`Missing memory ${id}`);
            const { recordSignificantAccess } = await import("./memoryCognition.js");
            const updated = recordSignificantAccess(source, now);
            if (updated === source)
                return;
            await lancedbService.store(updated);
            const index = this.working.findIndex(n => n.id === id);
            if (index >= 0) {
                this.working[index] = updated;
                this.markDirty();
                await this.saveSnapshot();
            }
        });
    }
    /** Recent exact-tag stored observations, without semantic search, ranking
     * budget, access writes or provider use. Ordinary retrieval is unchanged. */
    async getRecentObservations(tag, limit) {
        await this.hydration;
        const tags = Array.isArray(tag) ? tag : [tag];
        if (!tags.length || !tags.every(t => typeof t === 'string' && t.length > 0) || !Number.isInteger(limit) || limit < 1 || limit > 1000)
            throw new Error('Observation tags and bounded limit required');
        const persisted = await lancedbService.getRecentObservations(tag, limit, this.working.map(n => n.id));
        const byId = new Map(persisted.map(n => [n.id, n]));
        for (const node of this.working)
            if (tags.every(t => node.tags.includes(t)))
                byId.set(node.id, node);
        return structuredClone([...byId.values()].sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id)).slice(0, limit));
    }
    async getLatestObservation(tag) {
        return (await this.getRecentObservations(tag, 1))[0] ?? null;
    }
    async retrieve(query, filterTag, agentId) {
        // Use the new Universal Search to get candidates from all tiers (RAM + LanceDB + Qdrant)
        let candidates = await this.search(query, { ownerId: agentId, tag: filterTag });
        // Apply strict filters
        candidates = candidates.filter(n => {
            // Tag Filter
            if (filterTag && !n.tags.some(t => t.includes(filterTag)))
                return false;
            // Owner Check (Privacy/Siloing)
            // If agentId is provided, only show nodes owned by that agent OR public nodes (no owner)
            // But if specific owner logic is needed, modify here. 
            // Current rule: If node has ownerId, it must match agentId. Usage of undefined owner = public.
            if (agentId && n.ownerId && n.ownerId !== agentId)
                return false;
            return true;
        });
        // [VALUE RANKING] Re-rank by multi-signal value (importance, recency,
        // access, provenance). Eternal-memory safe: reorders ONLY — every
        // candidate is returned; superseded nodes are demoted, never removed.
        const { rankByValue } = await import("./memory/valueRanking.js");
        return rankByValue(candidates, Date.now());
    }
    /**
     * [BRAIN INTEGRATION] Unified Context Retrieval
     * Combines recent episodic memory with semantic deep memory.
     * This is the recommended query method for Agents to build their context windows.
     */
    async getCombinedContext(query, semanticLimit = 5, recentLimit = 5, hours = 2) {
        await this.ready();
        // 1. Semantic Search (DEEP memory via VectorStore)
        let semantic = [];
        try {
            const { vectorMemory } = await import("./vectorMemoryService.js");
            // Assuming vectorMemory has query() mapped to semantic search
            // If not, we fallback to generalized search
            if (typeof vectorMemory.searchByContent === 'function') {
                const vectors = await vectorMemory.searchByContent(query, semanticLimit);
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
            }
            else {
                // Fallback: use built-in search and filter for DEEP
                const allSearchResults = await this.search(query);
                semantic = allSearchResults.filter(n => n.tier === MemoryTier.DEEP).slice(0, semanticLimit);
            }
        }
        catch (e) {
            console.warn('[CONTINUUM] Semantic context retrieval failed, using fallback:', e);
            const allSearchResults = await this.search(query);
            semantic = allSearchResults.filter(n => n.tier === MemoryTier.DEEP).slice(0, semanticLimit);
        }
        // 2. Recent Episodic (WORKING / MEDIUM)
        const cutoff = Date.now() - (hours * 3600 * 1000);
        // From RAM
        const recentRam = this.working.filter(n => n.timestamp >= cutoff);
        // From LanceDB (Medium)
        let recentDb = [];
        try {
            const dbNodes = await lancedbService.getAllNodes();
            recentDb = dbNodes.filter(n => (n.tier === MemoryTier.MEDIUM || n.tier === undefined) &&
                n.timestamp >= cutoff);
        }
        catch (e) {
            console.error("[CONTINUUM] Failed to fetch recent DB nodes", e);
        }
        // Merge, sort, and slice recent
        const allRecent = [...recentRam, ...recentDb]
            .sort((a, b) => b.timestamp - a.timestamp) // Descending
            .slice(0, recentLimit);
        return structuredClone({ semantic, recent: allRecent });
    }
    async getIdentityNodes() {
        // Fetch from LanceDB where tags include IDENTITY
        const allDb = await lancedbService.getAllNodes();
        return allDb.filter(n => n.tags.includes('IDENTITY') ||
            n.tags.includes('CORE_BELIEF') ||
            n.tags.includes('SACRED'));
    }
    async runMaintenance() {
        return this.mutate(async () => {
            if (this.isMaintenanceRunning)
                return;
            this.isMaintenanceRunning = true;
            try {
                const now = Date.now();
                // [MEMORY PRESSURE MONITOR] Prevent OOM during long sessions
                const workingSize = this.working.length;
                if (workingSize > 500) {
                    console.warn(`[CONTINUUM] ⚠️ Memory pressure HIGH (${workingSize} nodes). Forcing consolidation...`);
                    await this.consolidateRamImmediate();
                }
                else if (workingSize > 400) {
                    console.log(`[CONTINUUM] 📊 Memory pressure moderate (${workingSize}/500 nodes)`);
                }
                // [OPTIMIZATION] Slowed down from 5s to 30s as per user request
                // Only tick RAM tiers. LanceDB tiers are static until accessed/dreamt.
                if (now % 30000 < 1000) {
                    this.tickFast(now);
                    // Snapshot check (Lazy Persistence)
                    if (this.isDirty) {
                        await this.saveSnapshot();
                        // queueSnapshot clears dirty only if its captured revision is current;
                    }
                }
                if (now % 60000 < 1000)
                    await this.tickMedium(now);
                if (now % 300000 < 1000)
                    await this.tickLong(now); // Check every 5 mins for archival
                if (now % 600000 < 1000)
                    await this.tickDeep(now); // Check every 10 mins for Deep Sleep
                // [NATIVE-RECOVERY] Periodic journal reconcile: boot used to be the
                // ONLY replay pass - a healthy long-lived process never recovered.
                if (now - this.lastTransitionReconcile >= this.TRANSITION_RECONCILE_INTERVAL_MS) {
                    this.lastTransitionReconcile = now;
                    try {
                        await this.reconcileTransitions('pending');
                    }
                    catch (e) {
                        console.error('[CONTINUUM] Periodic transition reconcile failed:', e);
                    }
                }
                // [NATIVE-RECOVERY] Native quota-gated embedding backfill. The
                // method existed with ZERO in-repo callers (only external scripts
                // ever ran it) - pending embeddings accumulated structurally.
                if (now - this.lastEmbeddingBackfill >= this.EMBEDDING_BACKFILL_INTERVAL_MS) {
                    this.lastEmbeddingBackfill = now;
                    try {
                        await this.maybeRunEmbeddingBackfill();
                    }
                    catch (e) {
                        console.error('[CONTINUUM] Embedding backfill pass failed:', e);
                    }
                }
            }
            catch (e) {
                console.error("[CONTINUUM] Maintenance Error", e);
            }
            finally {
                this.isMaintenanceRunning = false;
            }
        });
    }
    tickFast(now) {
        this.assertSynchronousMutation();
        // [FIX 2026-02] Since ultraShort/short are aliases to working, "promoting" between them
        // was silently dropping nodes. Now we just update the tier in-place for frequently
        // accessed nodes and move expired nodes to hippocampus.
        const toKeep = [];
        for (const node of this.working) {
            const age = (now - node.timestamp) / 1000;
            if (age > 900) { // 15 Minutes (Conversation Window) — move to hippocampus
                this.moveToHippocampus(node);
                toKeep.push(node); // Hippocampus is a view, never an unverified eviction.
                this.markDirty();
            }
            else if (node.accessCount >= 2 || node.importance >= 0.8) {
                // Mark as promoted (tier upgrade) but keep in working memory
                node.tier = MemoryTier.WORKING;
                toKeep.push(node);
                this.markDirty();
            }
            else {
                toKeep.push(node);
            }
        }
        this.working = toKeep;
    }
    // ...
    insertRamNode(node, tier) {
        this.assertSynchronousMutation();
        // All RAM tiers now go into unified working memory
        if (tier === MemoryTier.WORKING || tier === 'ULTRA_SHORT' || tier === 'SHORT') {
            this.working.unshift(structuredClone(node));
            this.markDirty();
        }
    }
    promoteToRam(node, tier) {
        this.assertSynchronousMutation();
        node.tier = tier;
        this.insertRamNode(node, tier);
    }
    async tickLong(now) {
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
        }
        catch (e) {
            console.error("[CONTINUUM] tickLong failed", e);
        }
    }
    async tickDeep(now) {
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
                const { dreamer } = await import("./dreamerService.js");
                const archiveId = await dreamer.consolidateLongTerm(batch);
                if (!await lancedbService.getNodeById(archiveId))
                    throw new Error(`Missing archive ${archiveId}`);
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
        }
        catch (e) {
            console.error("[CONTINUUM] tickDeep failed", e);
        }
    }
    moveToHippocampus(node) {
        this.assertSynchronousMutation();
        if (this.hippocampus.find(n => n.id === node.id))
            return;
        this.hippocampus.push(node);
        if (this.hippocampus.length >= this.HIPPOCAMPUS_CAPACITY) {
            import("./dreamerService.js").then(({ dreamer }) => {
                return dreamer.attemptDream();
            }).catch(error => {
                console.error('[CONTINUUM] Capacity-triggered dream failed:', error);
            });
        }
    }
    calculateInitialImportance(content, tags) {
        let score = 0.5;
        if (tags.includes('CRITICAL'))
            score = 1.0;
        if (tags.includes('SACRED'))
            score = 1.0;
        if (tags.includes('IDENTITY'))
            score = 1.0;
        if (tags.includes('user-input'))
            score += 0.4;
        if (content.length > 200)
            score += 0.2;
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
    transformUserPerspective(content, tags) {
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
    markDirty() {
        this.isDirty = true;
        this.writeRevision++;
    }
    async getStats() {
        await this.ready();
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
            const { vectorMemory } = await import("./vectorMemoryService.js");
            vectorStats = await vectorMemory.getStats();
        }
        catch (e) {
            console.error("[CONTINUUM] Failed to fetch stats from Vector Memory", e);
        }
        // Fetch real stats from LanceDB (Medium/Long Tiers)
        let dbNodes = [];
        try {
            dbNodes = await lancedbService.getAllNodes();
        }
        catch (e) {
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
            const { vectorMemory } = await import("./vectorMemoryService.js");
            const deepVectors = await vectorMemory.getAllNodes(100);
            const deepArchived = dbNodes.filter(n => n.tier === MemoryTier.DEEP);
            const deepMap = new Map();
            deepArchived.forEach(n => deepMap.set(n.id, n));
            deepVectors.forEach((v) => deepMap.set(v.id, v));
            deepCount = deepMap.size;
        }
        catch (e) {
            console.error("[CONTINUUM] Failed to dedup deep stats; falling back to raw vector count", e);
        }
        // [FIX 2026-02] Use working.length directly (ultraShort/short are aliases — was double-counting)
        const workingCount = this.working.length;
        // [R11] measured health: average decayHealth over sampled nodes;
        // null (not a fixed 100) when there is nothing to measure.
        const healthSample = [
            ...this.working,
            ...dbNodes.filter(n => typeof n.decayHealth === 'number')
        ];
        const avgHealth = healthSample.length > 0
            ? Math.round(healthSample.reduce((acc, n) => acc + (n.decayHealth ?? 100), 0) / healthSample.length)
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
    async forceSave() {
        return this.mutate(async () => {
            // Persist volatile memory to Redis/Disk immediately
            await this.saveSnapshot();
            console.log("[CONTINUUM] forceSave completed.");
        });
    }
    async debug_forceTick(tier) {
        return this.mutate(async () => {
            const now = Date.now();
            if (tier === 'DEEP') {
                await this.tickDeep(now);
            }
            else {
                this.tickFast(now);
                await this.tickMedium(now);
            }
        });
    }
    debug_ageNode(nodeId, ageMs = 3600000) {
        this.assertSynchronousMutation();
        const node = this.working.find(n => n.id === nodeId);
        if (node) {
            node.timestamp -= ageMs;
            this.markDirty();
        }
    }
    debug_boostNode(nodeId, importance = 1.0, accessCount = 10, addTag = false) {
        this.assertSynchronousMutation();
        const node = this.working.find(n => n.id === nodeId);
        if (node) {
            node.importance = importance;
            node.accessCount += accessCount;
            if (addTag)
                node.tags.push('IDENTITY');
            this.markDirty();
        }
    }
    async search(query, scope = {}) {
        await this.hydration;
        const lists = [];
        // [ROOT CAUSE FIX] Defensive Guard
        if (!query || typeof query !== 'string')
            return [];
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
            const { vectorMemory } = await import("./vectorMemoryService.js");
            const geminiMod = await import("./geminiService.js");
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
            }
            else {
                console.warn("[CONTINUUM] Embedding UNAVAILABLE (no provider configured or provider error) - deep memory served by text search only.");
            }
        }
        catch (e) {
            console.error("[CONTINUUM] Search failed:", e);
        }
        // Deduplicate by ID
        return structuredClone(fuseMemories(lists.map(list => list.sort((a, b) => activation(b).score - activation(a).score)), query));
    }
    /**
     * [NATIVE-RECOVERY] Native embedding-backfill scheduler, gated on the
     * OBSERVABLE quota ledger (same mechanism as PR-K text generation; budgets
     * come from env config, not guessed here). Blocked state is reported
     * honestly as an incident instead of burning provider calls; recovery
     * resolves the same incident. No notification leaves the system.
     */
    async maybeRunEmbeddingBackfill(ledger = quotaLedger, runBackfill = (l) => this.backfillMemoryEmbeddings(l)) {
        return this.mutate(async () => {
            // [QUOTA-COOLDOWN] Real provider 429 (RetryInfo) outranks the local
            // ledger: skip the pass without burning calls or spamming incidents.
            const cooldown = ledger.cooldownUntil('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
            if (cooldown) {
                return { ran: false, reason: `provider cooldown until ${new Date(cooldown).toISOString()} (real 429 RetryInfo); pending embeddings retained` };
            }
            const status = ledger.status('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL);
            const { incidentRegistry } = await import("./incidentRegistry.js");
            if (!status.allowed) {
                incidentRegistry.recordIncident('continuum-embeddings', 'error', 'embedding backfill blocked by quota budget', `local daily budget spent for gemini:${DEFAULT_GEMINI_EMBEDDING_MODEL} (${status.used}/${status.budget} attempts, day ${status.day}). Pending embeddings are retained and retried after quota reset.`);
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
                incidentRegistry.recordIncident('continuum-embeddings', 'error', 'embedding backfill blocked by quota budget', `daily headroom reserved for live writes (${status.used}/${status.budget} used, reserve ${reserve}, day ${status.day}). Pending embeddings are retained and retried after quota reset.`);
                return { ran: false, reason: `headroom reserved for live writes (${status.used}/${status.budget}, reserve ${reserve}, day ${status.day})` };
            }
            const hold = ledger.reserve('gemini', DEFAULT_GEMINI_EMBEDDING_MODEL, batchLimit);
            if (!hold.reserved) {
                return { ran: false, reason: `backfill reservation lost to concurrent consumer (${hold.used}/${hold.budget}); live writes keep priority` };
            }
            const result = await runBackfill(batchLimit);
            if (result.projected > 0) {
                incidentRegistry.resolveIncidents('continuum-embeddings', 'error');
            }
            else if (result.failed > 0) {
                incidentRegistry.recordIncident('continuum-embeddings', 'error', 'embedding backfill pass failed', 'provider rejected every attempt this pass; pending rows retained for the next pass');
            }
            return { ran: true, ...result };
        });
    }
    /**
     * Backfill vector projections for canonical memories still in
     * EMBEDDING_PENDING state (every memory written before per-identity
     * projections existed). Uses the SAME resolver as the live write path, so
     * backfilled and new vectors share one identity space. Failures stay
     * EMBEDDING_PENDING and are retried on the next pass.
     */
    async backfillMemoryEmbeddings(limit = 50) {
        return this.mutate(async () => {
            if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
                throw new Error('Invalid backfill limit');
            const { generateEmbeddingWithIdentity } = await import("./geminiService.js");
            const pending = await lancedbService.pendingEmbeddings(limit);
            let projected = 0, failed = 0;
            for (const node of pending) {
                try {
                    // preReserved: the governor already counted this batch
                    // atomically; per-item recording would double-count.
                    const embedded = await generateEmbeddingWithIdentity(node.content, { allowFallbackIdentity: false, preReserved: true });
                    if (!embedded) {
                        failed++;
                        continue;
                    }
                    await lancedbService.projectEmbedding(node, embedded.vector, embedded.identity);
                    projected++;
                }
                catch (error) {
                    failed++;
                    console.warn(`[CONTINUUM] Backfill failed for ${node.id} (stays pending):`, error?.message || error);
                }
            }
            if (projected || failed)
                console.log(`[CONTINUUM] Embedding backfill: ${projected} projected, ${failed} failed.`);
            return { projected, failed };
        });
    }
    // --- MANUAL CONSOLIDATION VOID ---
    async consolidateRamImmediate() {
        return this.mutate(async () => {
            console.log("[CONTINUUM] 🌪️ FORCE CONSOLIDATION INITIATED");
            let count = 0;
            // [PR-4b] Per-node isolation: a failing promotion must not escape as an
            // unhandled rejection (prod FATAL) nor abort the remaining consolidations.
            let failed = 0;
            for (const node of [...this.working]) {
                try {
                    await this.promoteWorking(node, ['CONSOLIDATED']);
                    count++;
                    await this.notePromoteSuccess();
                }
                catch (error) {
                    failed++;
                    console.error(`[CONTINUUM] Consolidation failed for ${node.id}; source remains in RAM:`, error);
                    await this.notePromoteFailure(node.id, error);
                }
            }
            console.log(`[CONTINUUM] 🌪️ Consolidated ${count} memories to L3 (LanceDB). ${failed > 0 ? `⚠️ ${failed} failed (sources kept in RAM).` : 'RAM is empty.'}`);
            return { promoted: count };
        });
    }
}
export const continuum = new ContinuumMemorySystem();
