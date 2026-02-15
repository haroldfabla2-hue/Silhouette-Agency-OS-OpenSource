import { MemoryNode, MemoryTier } from "../types";
import { lancedbService } from './lancedbService';
import { introspection } from './introspectionEngine';
import { redisClient } from './redisClient';
import * as fs from 'fs/promises';
import * as path from 'path';
import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';
import { MemoryNodeSchema } from './memorySchema'; // Added missing import

const SNAPSHOT_PATH = path.join(process.cwd(), 'data', 'memory_snapshot.json');

// --- SILHOUETTE CONTINUUM MEMORY SYSTEM V5.0 (UNIFIED WORKING MEMORY) ---
// Architecture: 4-Tier Hierarchical Storage
// L1: RAM (WORKING - Unified Fast Access)
// L2: LanceDB MEDIUM (Persistent - Frequently accessed)
// L3: LanceDB LONG (Archived)
// L4: Qdrant DEEP (Semantic vectors)

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
        this.isDirty = false; // Reset on check (assuming caller will save)
        return wasDirty;
    }


    // ...

    private async tickMedium(now: number) {
        // L2 -> L3 (LanceDB)
        // Only promote if it's old enough (15m) OR very critical
        const toPromote = this.short.filter(node => {
            const ageMs = now - node.timestamp;
            const isOldEnough = ageMs > 900000; // 15 Minutes
            return isOldEnough || node.accessCount > 10 || node.importance >= 0.95;
        });

        for (const node of toPromote) {
            try {
                // Promote to Persistent Storage
                // We create a copy with the new tier to store, but keep the original in RAM until confirmed
                const promotedNode = { ...node, tier: MemoryTier.MEDIUM };
                await lancedbService.store(promotedNode);

                // Success: Remove from RAM
                this.short = this.short.filter(n => n.id !== node.id);
            } catch (e) {
                console.error(`[CONTINUUM] Failed to promote node ${node.id} to MEDIUM`, e);
                // Keep in SHORT for retry
            }
        }
    }

    // ...


    private hippocampus: MemoryNode[] = []; // Holds decayed memories for dreaming

    // Configuration
    private readonly HIPPOCAMPUS_CAPACITY = 50; // Trigger dream when full
    private readonly CACHE_TTL = 30000; // 30 Seconds

    constructor() {
        // No hydration needed for LanceDB, it's always on disk.
        // RAM tiers start empty on reboot (Tabula Rasa for short term) UNLESS hydrated explicitly.

        // Connect to Redis (Hybrid Persistence Layer)
        redisClient.connect().then(() => {
            // Restore Volatile Memory (Redis -> Disk Fallback)
            this.loadSnapshot().catch(err => console.error("[CONTINUUM] Failed to load snapshot:", err));
        });

        // Start Dreaming Protocol (Subconscious)
        import('./dreamerService').then(({ dreamer }) => {
            dreamer.startDreamingLoop();
        });
    }

    // --- PUBLIC API ---
    public async forceConsolidation() {
        console.log("[CONTINUUM] 🧠 Forcing Memory Consolidation...");
        return await this.consolidateRamImmediate();
    }

    // --- PERSISTENCE SNAPSHOTS ---
    private async saveSnapshot() {
        try {
            // [REFACTOR 2026-01-07] Use unified 'working' key for new format
            // Also save legacy keys for backward compatibility with older code
            const data = {
                working: this.working,
                // Legacy keys (for backward compatibility if rollback needed)
                ultraShort: this.working,
                short: []
            };
            const payload = JSON.stringify(data, null, 2);

            // 1. Primary: Redis (Fast, Distributed)
            await redisClient.set('continuum:volatile', payload, 3600); // 1h TTL for cache

            // 2. Secondary: Disk (Permanent, Local)
            await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
            await fs.writeFile(SNAPSHOT_PATH, payload);

            // console.log("[CONTINUUM] Volatile memory snapshot saved (V5.0 format).");
        } catch (error) {
            console.error("[CONTINUUM] Failed to save snapshot:", error);
        }
    }

    private async loadSnapshot() {
        try {
            let snapshot: any = null;
            let source = '';

            // 1. Try Redis First
            const redisData = await redisClient.get('continuum:volatile');
            if (redisData) {
                snapshot = JSON.parse(redisData);
                source = 'REDIS';
            } else {
                // 2. Fallback to Disk
                const data = await fs.readFile(SNAPSHOT_PATH, 'utf-8');
                snapshot = JSON.parse(data);
                source = 'DISK';
            }

            if (!snapshot) return;

            // [REFACTOR 2026-01-07] Handle both V5.0 and legacy formats
            // V5.0 format has 'working' key
            // Legacy format has 'ultraShort' and 'short' keys
            if (snapshot.working && Array.isArray(snapshot.working)) {
                // New V5.0 format
                this.working = snapshot.working;
                console.log(`[CONTINUUM] Restored Memory from ${source} (V5.0 format): ${this.working.length} WORKING nodes`);
            } else {
                // Legacy format - merge ultraShort + short into working
                const legacyNodes: MemoryNode[] = [];
                if (snapshot.ultraShort && Array.isArray(snapshot.ultraShort)) {
                    legacyNodes.push(...snapshot.ultraShort);
                }
                if (snapshot.short && Array.isArray(snapshot.short)) {
                    legacyNodes.push(...snapshot.short);
                }
                this.working = legacyNodes;
                console.log(`[CONTINUUM] 🔄 MIGRATED Legacy Snapshot from ${source}: ${legacyNodes.length} nodes merged into WORKING tier`);
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error("[CONTINUUM] Error loading snapshot:", error);
            }
        }
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
        this.isDirty = true; // Mark as dirty to trigger save
    }

    // --- FULL SESSION CHAT HISTORY (INFINITE CONTEXT) ---
    public getSessionHistory(limit: number = 1000): { role: string; content: string }[] {
        // Filter Ultra-Short memory for conversation turns
        // We look for tags 'USER_MESSAGE' and 'AGENT_RESPONSE'
        // Sorted by timestamp ascending (oldest first)

        // Combine UltraShort and Short to ensure we capture the whole session even if it gets promoted
        const allRam = [...this.short, ...this.ultraShort];

        const history = allRam
            .filter(n => n.tags.includes('USER_MESSAGE') || n.tags.includes('AGENT_RESPONSE'))
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-limit) // Take last N (default 1000 is effectively infinite for a day)
            .map(n => ({
                role: n.tags.includes('USER_MESSAGE') ? 'user' : 'model',
                content: n.content
            }));

        return history;
    }

    // --- PUBLIC API ---

    public getShortTermMemory(): MemoryNode[] {
        return this.short;
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
        // 1. Remove from RAM tiers
        const originalLen = this.ultraShort.length + this.short.length;
        this.ultraShort = this.ultraShort.filter(n => n.id !== nodeId);
        this.short = this.short.filter(n => n.id !== nodeId);

        // 2. Remove from Hippocampus
        this.hippocampus = this.hippocampus.filter(n => n.id !== nodeId);

        const newLen = this.ultraShort.length + this.short.length;
        if (originalLen !== newLen) {
            console.log(`[CONTINUUM] 🗑️ Deleted node ${nodeId} from RAM.`);
            this.isDirty = true;
        }

        // 3. Remove from Persistent Storage (LanceDB)
        try {
            await lancedbService.deleteNode(nodeId);
        } catch (e) {
            console.error(`[CONTINUUM] Failed to delete node ${nodeId} from LanceDB`, e);
        }
    }

    public async store(content: string, tier: MemoryTier = MemoryTier.ULTRA_SHORT, tags: string[] = [], skipIngestion: boolean = false): Promise<void> {
        // [FIX] Anti-Recursion Guard 1: Block self-referential/recursive content patterns
        for (const pattern of ContinuumMemorySystem.LOOP_PATTERNS) {
            if (pattern.test(content)) {
                console.warn(`[CONTINUUM] 🔄 Blocked recursive content: "${content.substring(0, 50)}..."`);
                return;
            }
        }

        // [FIX] Anti-Recursion Guard 2: Hash-based recent deduplication
        const contentHash = content.length > 10 ?
            Buffer.from(content.slice(0, 100)).toString('base64').slice(0, 16) :
            content;
        if (this.recentHashes.has(contentHash)) {
            console.log(`[CONTINUUM] ♻️ Deduplicated recent content`);
            return;
        }
        this.recentHashes.add(contentHash);
        // Keep only last 100 hashes to prevent memory bloat
        if (this.recentHashes.size > 100) {
            const arr = Array.from(this.recentHashes);
            this.recentHashes = new Set(arr.slice(-50));
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
            if (handled) return;
        }

        // L1: RAM Storage (Unified WORKING tier)
        // Note: ULTRA_SHORT and SHORT now map to WORKING for backward compatibility
        // Cast to string for flexible comparison (handles both enum values and legacy strings)
        const tierStr = String(node.tier);
        if (tierStr === 'WORKING' || tierStr === 'ULTRA_SHORT' || tierStr === 'SHORT') {
            this.working.push(node as MemoryNode);
            this.isDirty = true;
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
                // [CHANGED] Use Minimax for Embeddings (Unified Provider)
                const { minimaxService } = await import('./minimaxService');
                const { vectorMemory } = await import('./vectorMemoryService');

                // Fallback to Gemini if Minimax not configured? No, user explicitly wants Minimax.
                // But we should check if it's available.
                let vector: number[] | null = null;

                if (minimaxService.isAvailable()) {
                    vector = await minimaxService.getEmbedding(content);
                } else {
                    // Fallback to Gemini if Minimax key missing
                    const { generateEmbedding } = await import('./geminiService');
                    vector = await generateEmbedding(content);
                }

                if (vector) {
                    await vectorMemory.storeMemory(nodeToStore.id, vector, {
                        ...nodeToStore,
                        type: 'MEMORY_NODE'
                    });
                } else {
                    console.warn("[CONTINUUM] Failed to generate embedding for DEEP memory. Storing in LanceDB as fallback.");
                    await lancedbService.store(nodeToStore);
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

        // [FIX] Anti-Recursion Guard 3: Only notify introspection/dreamer for non-internal stores
        // skipIngestion=true indicates this is an internal/narrative store that should not cascade
        if (!skipIngestion) {
            // 3. Update Introspection about new thought (but NOT for narrative persistence)
            introspection.setRecentThoughts([`Storing memory: ${content.substring(0, 30)}...`]);

            // 4. Notify Dreamer (Event-Driven) - with null check
            import('./dreamerService').then(({ dreamer }) => {
                if (dreamer?.notifyNewMemory) dreamer.notifyNewMemory();
            }).catch(() => { /* Dreamer not available */ });
        }
    }

    public async retrieve(query: string, filterTag?: string, agentId?: string): Promise<MemoryNode[]> {
        // Use the new Universal Search to get candidates from all tiers (RAM + LanceDB + Qdrant)
        let candidates = await this.search(query);

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

        // Sort by timestamp (Newest first) and limit
        // Sort by timestamp (Newest first) and limit
        // [PHASE 16] Massive Context: 500 items (~100k tokens). Covers near-total database.
        return candidates.sort((a, b) => b.timestamp - a.timestamp).slice(0, 500);
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
                if (this.checkDirty()) {
                    await this.saveSnapshot();
                }
            }
            if (now % 60000 < 1000) await this.tickMedium(now);
            if (now % 300000 < 1000) await this.tickLong(now); // Check every 5 mins for archival
            if (now % 600000 < 1000) await this.tickDeep(now); // Check every 10 mins for Deep Sleep
        } catch (e) {
            console.error("[CONTINUUM] Maintenance Error", e);
        } finally {
            this.isMaintenanceRunning = false;
        }
    }

    private tickFast(now: number) {
        // L1 -> L2
        this.ultraShort = this.ultraShort.filter(node => {
            const age = (now - node.timestamp) / 1000;
            if (node.accessCount >= 2 || node.importance >= 0.8) {
                this.promoteToRam(node, MemoryTier.SHORT);
                this.isDirty = true; // RAM Changed
                return false;
            }
            if (age > 900) { // 15 Minutes (Conversation Window)
                this.moveToHippocampus(node);
                return false;
            }
            return true;
        });
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
                if (ageMs > 900000 && node.accessCount < 5) {
                    // console.log(`[CONTINUUM] Archiving node ${node.id} to LONG tier.`);
                    const archivedNode = { ...node, tier: MemoryTier.LONG, compressionLevel: 1 };
                    await lancedbService.store(archivedNode);
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
                return ageMs > 60000; // 1 Minute old (Accelerated for debugging/flow)
            });

            console.log(`[CONTINUUM] 🔍 Deep Sleep Check: Found ${candidates.length} candidates (Threshold: 3)`);

            if (candidates.length >= 3) {
                const batch = candidates.slice(0, 5); // Process 5 at a time
                console.log(`[CONTINUUM] 💤 Triggering Deep Sleep for ${batch.length} nodes...`);

                // Dynamic import to avoid circular dependency
                const { dreamer } = await import('./dreamerService');
                await dreamer.consolidateLongTerm(batch);

                // If successful, delete them from LONG (LanceDB)
                // LanceDB currently doesn't have a reliable 'deleteMany', so we 'soft delete' or just move them?
                // Actually lancedbService.store can overwrite.
                // But efficient cleanup requires deletion.
                // Let's implement a 'drop' or 'delete' in lancedbService for IDs, OR
                // simpler: Mark them as TIER: DEEP in LanceDB too (as a backup/log) but filter them out in UI.

                for (const node of batch) {
                    // Option A: Hard Delete (Best for cleanup) -> Need delete support in Service
                    // Option B: Soft Delete (Tier = DEEP or ARCHIVED)
                    const archived = { ...node, tier: MemoryTier.DEEP, tags: [...node.tags, 'ARCHIVED'] };
                    await lancedbService.store(archived);
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

    public async getStats() {
        const now = Date.now();
        if (this.cachedStats && (now - this.lastStatsCacheTime < this.CACHE_TTL)) {
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

        this.cachedStats = {
            ultra: this.ultraShort.length,
            short: this.short.length,
            medium: mediumCount,
            long: longCount,
            deep: vectorStats.count,
            total: this.ultraShort.length + this.short.length + mediumCount + longCount + vectorStats.count,
            avgHealth: 100,
            archivedNodes: longCount
        };
        this.lastStatsCacheTime = now;

        return this.cachedStats;
    }



    // --- DEBUG / ADMIN METHODS ---
    public async forceSave() {
        // Persist volatile memory to Redis/Disk immediately
        await this.saveSnapshot();
        console.log("[CONTINUUM] forceSave completed.");
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
        const node = this.ultraShort.find(n => n.id === nodeId) || this.short.find(n => n.id === nodeId);
        if (node) {
            node.timestamp -= ageMs;
        }
    }

    public debug_boostNode(nodeId: string, importance: number = 1.0, accessCount: number = 10, addTag: boolean = false) {
        const node = this.ultraShort.find(n => n.id === nodeId) || this.short.find(n => n.id === nodeId);
        if (node) {
            node.importance = importance;
            node.accessCount += accessCount;
            if (addTag) node.tags.push('IDENTITY');
        }
    }
    public async search(query: string): Promise<MemoryNode[]> {
        const results: MemoryNode[] = [];

        // [ROOT CAUSE FIX] Defensive Guard
        if (!query || typeof query !== 'string') return [];

        const queryLower = query.toLowerCase();

        // 1. Search RAM (Exact Match / Simple Filter) - Always fast
        const ramResults = [...this.ultraShort, ...this.short].filter(n => (n.content || "").toLowerCase().includes(queryLower));
        results.push(...ramResults);

        try {
            // 2. Search LanceDB (Semantic or Text)
            // For now, still text based fallback for LanceDB until we add embedding there too
            const dbResults = await lancedbService.searchByContent(query, 50);
            results.push(...dbResults);

            // 3. Search Deep Memory (SEMANTIC / VECTOR)
            // Dynamic import to avoid circular dependency
            const { vectorMemory } = await import('./vectorMemoryService');
            const { geminiService } = await import('./geminiService');

            // Generate Embedding for Query
            const embedding = await geminiService.generateEmbedding(query);

            let deepVectors: any[] = [];

            if (embedding) {
                // Semantic Search
                console.log(`[CONTINUUM] Performing Semantic Search for: "${query}"`);
                deepVectors = await vectorMemory.searchMemory(embedding, 50);
            } else {
                // Fallback to Text Search if embedding fails
                console.warn("[CONTINUUM] Embedding failed, falling back to text search for Deep Memory.");
                deepVectors = await vectorMemory.searchByContent(query, 50);
            }

            const deepNodes = deepVectors.map(v => ({
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
            results.push(...deepNodes);

        } catch (e) {
            console.error("[CONTINUUM] Search failed:", e);
        }

        // Deduplicate by ID
        const unique = new Map<string, MemoryNode>();
        results.forEach(n => unique.set(n.id, n));
        return Array.from(unique.values());
    }
    // --- MANUAL CONSOLIDATION VOID ---
    public async consolidateRamImmediate(): Promise<{ promoted: number }> {
        console.log("[CONTINUUM] 🌪️ FORCE CONSOLIDATION INITIATED");
        let count = 0;

        // 1. Promote ALL Ultra-Short to Medium
        for (const node of this.ultraShort) {
            const promoted = { ...node, tier: MemoryTier.MEDIUM, tags: [...node.tags, 'CONSOLIDATED'] };
            await lancedbService.store(promoted);
            count++;
        }
        this.ultraShort = [];

        // 2. Promote ALL Short to Medium
        for (const node of this.short) {
            const promoted = { ...node, tier: MemoryTier.MEDIUM, tags: [...node.tags, 'CONSOLIDATED'] };
            await lancedbService.store(promoted);
            count++;
        }
        this.short = [];

        this.isDirty = true; // Ram cleared, need to save snapshot (empty)
        await this.saveSnapshot();

        console.log(`[CONTINUUM] 🌪️ Consolidated ${count} memories to L3 (LanceDB). RAM is empty.`);
        return { promoted: count };
    }
}

export const continuum = new ContinuumMemorySystem();
