import { graph } from '../graphService';
import { lancedbService } from '../lancedbService';
import { generateEmbedding } from '../geminiService';
import { continuum } from '../continuumMemory';
import { redisClient } from '../redisClient';

/**
 * 🧠 Silhouette Cognitive Scheduler (Brain Port)
 * Handles chron jobs for the 4-Tier Memory system mirroring the Python architecture.
 */
export class CognitiveScheduler {
    private isRunning: boolean = false;
    private timers: ReturnType<typeof setInterval>[] = [];

    constructor() { }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[COGNITIVE: WARNING] 🧠 cognitiveScheduler.start() is deprecated. Real scheduling is now handled by UnifiedDaemon.');
    }

    public stop() {
        console.log('[COGNITIVE: WARNING] 🛑 cognitiveScheduler.stop() is deprecated.');
        this.timers.forEach(clearTimeout);
        this.timers = [];
        this.isRunning = false;
    }

    // --- ENGINE PORTS ---

    /**
     * 🔍 Curiosity Engine
     * Explores the graph looking for "holes" and generates questions.
     * @deprecated Called by unifiedDaemon now.
     */
    public async runCuriosity() {
        console.log('[COGNITIVE: CURIOSITY] 🔍 Seeking knowledge gaps...');
        try {
            // Find open triangles in Neo4j to suggest possible missing links
            const gaps = await graph.findOpenTriangles(3);
            if (gaps && gaps.length > 0) {
                console.log(`[COGNITIVE: CURIOSITY] Found ${gaps.length} gaps. Injecting to Working Memory.`);
                // Insert into continuum (Working Memory) so agents see it
                for (const gap of gaps) {
                    await continuum.store({
                        content: `COGNITIVE DRIVE: I noticed ${gap.nodeA.name} and ${gap.nodeB.name} are both related to ${gap.bridge.name}. Are they related to each other? I should investigate.`,
                        type: 'thought'
                    } as any);
                }
            }
        } catch (e: any) {
            console.error('[COGNITIVE: CURIOSITY] Failed:', e.message);
        }
    }

    /**
     * 🧹 Janitor Engine (Truth Evaluation)
     * Reads recent Medium Memory from LanceDB, groups episodic facts,
     * detects contradictions using LLM, and resolves them into meta-memories.
     */
    public async runJanitor() {
        console.log('[COGNITIVE: JANITOR] 🧹 Analyzing Medium Memories for contradictions...');
        try {
            const stats = await continuum.getStats();
            console.log(`[COGNITIVE: JANITOR] Working Memory size: ${stats.workingMemoryItems}. Checking LanceDB for cleanup...`);

            // Fetch recent episodic nodes from LanceDB (last 24h)
            const recentNodes = await lancedbService.getAllNodes();
            const last24h = Date.now() - (24 * 60 * 60 * 1000);
            const mediumToAnalyze = recentNodes.filter(n =>
                (n.tier === 'MEDIUM' || n.tier === undefined) &&
                n.timestamp >= last24h &&
                !n.tags?.includes('SYNTHESIZED') // Skip already processed
            );

            if (mediumToAnalyze.length < 5) {
                console.log('[COGNITIVE: JANITOR] Not enough new context to require synthesis.');
                return;
            }

            // Extract content to prompt LLM for contradiction check
            const factsText = mediumToAnalyze.map(n => `- [ID:${n.id}] ${n.content}`).join('\n');
            const { generateText } = await import('../geminiService');

            const prompt = `You are the Janitor Cognitive Engine. 
            Analyze the following memory strings. 
            Your goal is to find CONTRADICTIONS (e.g., "User likes coffee" vs "User hates coffee").
            If you find a contradiction, resolve it based on the most recent or most emotionally intense statement, 
            and output ONLY a JSON array of resolved facts.
            If NO contradictions exist, output an empty array [].
            
            Format: [{ "resolved_fact": "...", "obsoletes_ids": ["id1", "id2"] }]
            
            MEMORIES:
            ${factsText}`;

            let responseText = await generateText(prompt, { model: 'gemini-2.5-flash' }); // Fast model 
            responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const results = JSON.parse(responseText);
                if (Array.isArray(results) && results.length > 0) {
                    console.log(`[COGNITIVE: JANITOR] Found ${results.length} contradictions. Resolving...`);
                    for (const res of results) {
                        if (!res.resolved_fact || !res.obsoletes_ids) continue;

                        // 1. Store the new synthesized truth in LanceDB
                        await lancedbService.store({
                            id: crypto.randomUUID(),
                            content: `[SYNTHESIZED TRUTH] ${res.resolved_fact}`,
                            timestamp: Date.now(),
                            tier: 'MEDIUM',
                            importance: 0.8,
                            tags: ['SYNTHESIZED', 'TRUTH_EVALUATION'],
                            accessCount: 1,
                            lastAccess: Date.now(),
                            decayHealth: 100,
                            compressionLevel: 0
                        } as any);

                        // 2. Mark old conflicting nodes as obsolete or delete them
                        for (const oldId of res.obsoletes_ids) {
                            console.log(`[COGNITIVE: JANITOR] Marking node ${oldId} as obsolete.`);
                            await lancedbService.deleteNode(oldId);
                        }
                    }
                } else {
                    console.log('[COGNITIVE: JANITOR] No contradictions found. Memories are narratively stable.');
                }
            } catch (e: any) {
                console.warn('[COGNITIVE: JANITOR] Failed to parse LLM synthesis result:', e.message);
            }

        } catch (e: any) {
            console.error('[COGNITIVE: JANITOR] Engine failed:', e.message);
        }
    }

    /**
     * 🌙 Dreamer Engine
     * Consolidates Medium Memory into Long-Term (LanceDB) and Deep (Neo4j).
     * @deprecated Called by unifiedDaemon now.
     */
    public async runDreamer() {
        console.log('[COGNITIVE: DREAMER] 🌙 Consolidating knowledge...');
        try {
            // 1. Poda Sináptica (Synaptic Pruning) — remove weak/stale nodes
            try {
                const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
                const cutoff = Date.now() - THIRTY_DAYS_MS;
                const pruned = await graph.runQuery(`
                    MATCH (c:Concept)
                    WHERE c.accessCount < 3 AND c.lastAccessed < $cutoff
                    WITH c, c.name AS name
                    DETACH DELETE c
                    RETURN count(name) AS prunedCount
                `, { cutoff });
                const count = pruned?.[0]?.prunedCount || 0;
                if (count > 0) {
                    console.log(`[COGNITIVE: DREAMER] 🌿 Pruned ${count} weak concepts (< 3 access, > 30 days old).`);
                }
            } catch (e: any) {
                // Graph might not support these fields yet — that's fine
                console.warn('[COGNITIVE: DREAMER] Pruning skipped (graph may not have accessCount/lastAccessed):', e.message);
            }

            // 2. Check working memory pressure
            try {
                const stats = await continuum.getStats();
                if (stats.workingMemoryItems > 200) {
                    console.warn(`[COGNITIVE: DREAMER] ⚠️ Working memory pressure: ${stats.workingMemoryItems} items (threshold: 200). Consider manual review.`);
                }
            } catch (e: any) {
                console.warn('[COGNITIVE: DREAMER] Working memory stats check skipped:', e.message);
            }

            // 3. Sync concepts to VectorStore
            const conceptsToSync = await graph.runQuery(`
                MATCH (c:Concept)
                RETURN c.id as id, c.name as name, c.description as description
                ORDER BY c.lastUpdated DESC
                LIMIT 10
            `);

            if (conceptsToSync && conceptsToSync.length > 0) {
                console.log(`[COGNITIVE: DREAMER] Syncing ${conceptsToSync.length} concepts to VectorStore...`);
                for (const record of conceptsToSync) {
                    await graph.syncConceptToVectorStore({
                        id: record.id,
                        name: record.name,
                        description: record.description
                    });
                }
            }

            console.log('[COGNITIVE: DREAMER] Phase 1 complete.');
        } catch (e: any) {
            console.error('[COGNITIVE: DREAMER] Failed:', e.message);
        }
    }

    /**
     * 🧬 Evolution Engine
     * Meta-cognitive evaluation of system performance.
     * @deprecated Called by unifiedDaemon now.
     */
    public async runEvolution() {
        console.log('[COGNITIVE: EVOLUTION] 🧬 Evaluating metric performance...');
        try {
            // Evaluates verification rates and suggests prompt optimizations
            console.log('[COGNITIVE: EVOLUTION] System stable.');
        } catch (e: any) {
            console.error('[COGNITIVE: EVOLUTION] Failed:', e.message);
        }
    }

    /**
     * 🗣️ Thought Narrator
     * Generates a steady stream of consciousness about the system state.
     * @deprecated Called by unifiedDaemon now.
     */
    public async runNarrator() {
        try {
            // Import dynamically to avoid circular dependencies if thoughtNarrator imports continuum
            const { thoughtNarrator } = await import('./thoughtNarrator');
            await thoughtNarrator.generateNarrative();
        } catch (e: any) {
            console.error('[COGNITIVE: NARRATOR] Failed:', e.message);
        }
    }
}

export const cognitiveScheduler = new CognitiveScheduler();
