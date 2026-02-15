import { lancedbService } from './lancedbService';
import { generateText } from './geminiService'; // Uses unified fallback: ZhipuAI → Gemini → OpenRouter → Groq → Ollama
import { introspection } from './introspectionEngine';
import { MemoryNode, MemoryTier } from '../types';

/**
 * EUREKA SERVICE - Neural Gap Detection & Small-World Network Builder
 * ═══════════════════════════════════════════════════════════════════════
 * Implements Watts-Strogatz Small-World Network principles:
 * - High clustering coefficient (local connections)
 * - Short average path length (long-range "shortcuts")
 * 
 * The service finds semantic "gaps" between nodes and creates
 * synaptic connections that bridge distant clusters, mimicking
 * how biological neural networks form through neuroplasticity.
 */
export class EurekaService {
    // Thresholds for TRUE cosine similarity (0-1 scale)
    // Values: 0 = completely different, 0.5 = orthogonal, 1 = identical
    private readonly SIMILARITY_THRESHOLD = 0.85; // Very similar (85%+)
    private readonly GAP_THRESHOLD = 0.6; // Minimum similarity to be interesting (60%+)

    // Watts-Strogatz Parameters
    private readonly REWIRING_PROBABILITY = 0.1; // 10% chance of creating long-range shortcuts
    private readonly CLUSTER_HOP_DISTANCE = 3; // Nodes 3+ hops away are "distant"

    /**
     * Busca "Gaps" (Huecos) en el grafo de conocimiento usando TODOS los tiers.
     * Implements Watts-Strogatz small-world network discovery:
     * - Local clustering: Find gaps within similar topics
     * - Long-range shortcuts: Connect distant but analogous concepts
     * 
     * [REFACTOR 2026-01-07] Now searches WORKING + MEDIUM + LONG tiers
     */
    async findGraphGaps(batchSize: number = 20): Promise<{ nodeA: MemoryNode, nodeB: MemoryNode, distance: number, isShortcut: boolean }[]> {
        console.log("[EUREKA] 🌌 Scanning for Knowledge Gaps (Multi-Tier + Watts-Strogatz)...");

        // === MULTI-TIER SOURCE COLLECTION ===
        // [FIX] Include ALL tiers for comprehensive gap detection
        const sources: MemoryNode[] = [];

        // 1. WORKING Memory (RAM) - Immediate context, recent conversations
        try {
            const { continuum } = await import('./continuumMemory');
            const workingNodes = continuum.getVolatileState();
            // Filter to only include meaningful nodes (not system noise)
            const meaningfulWorking = workingNodes.filter(n =>
                n.content.length > 50 &&
                !n.tags?.includes('SYSTEM') &&
                !n.content.includes('[EUREKA]')
            );
            sources.push(...meaningfulWorking.slice(0, Math.floor(batchSize / 3)));
            console.log(`[EUREKA] 📊 WORKING tier: ${meaningfulWorking.length} nodes (using ${Math.min(meaningfulWorking.length, Math.floor(batchSize / 3))})`);
        } catch (e) {
            console.warn("[EUREKA] ⚠️ Could not access WORKING memory:", e);
        }

        // 2. MEDIUM tier - Recently consolidated knowledge
        const mediumNodes = await lancedbService.getNodesByTier(MemoryTier.MEDIUM, Math.floor(batchSize / 3));
        sources.push(...mediumNodes);
        console.log(`[EUREKA] 📊 MEDIUM tier: ${mediumNodes.length} nodes`);

        // 3. LONG tier - Established knowledge (original behavior)
        const longNodes = await lancedbService.getNodesByTier(MemoryTier.LONG, Math.floor(batchSize / 3));
        sources.push(...longNodes);
        console.log(`[EUREKA] 📊 LONG tier: ${longNodes.length} nodes`);

        console.log(`[EUREKA] 📊 TOTAL source nodes: ${sources.length}`);

        if (sources.length < 2) {
            console.log("[EUREKA] ⚠️ Need at least 2 nodes for gap detection");
            return [];
        }

        const gaps: { nodeA: MemoryNode, nodeB: MemoryNode, distance: number, isShortcut: boolean }[] = [];
        const processedPairs = new Set<string>();

        // === WATTS-STROGATZ STYLE GAP DETECTION ===
        for (const source of sources) {
            // Find "Nearest Neighbors" in Vector Space (LOCAL clustering)
            const neighbors = await lancedbService.findSimilarNodes(source.id, 5);

            if (neighbors.length === 0) continue;

            for (const target of neighbors) {
                // Prevent duplicate pairs (A-B and B-A)
                const pairId = [source.id, target.id].sort().join('-');
                if (processedPairs.has(pairId)) continue;
                processedPairs.add(pairId);

                // CROSS-DOMAIN FILTER
                const SYSTEM_TAGS = ['concept', 'neo4j-synced', 'memory', 'agent', 'system', 'NARRATIVE', 'USER_MESSAGE'];
                const sourceDomainTags = (source.tags || []).filter(t => !SYSTEM_TAGS.includes(t));
                const targetDomainTags = (target.tags || []).filter(t => !SYSTEM_TAGS.includes(t));
                const commonTags = sourceDomainTags.filter(t => targetDomainTags.includes(t));
                const similarity = target.similarity || 0;

                const isCrossDomain = commonTags.length < 2;
                const isAnalogyCandidate =
                    (similarity > this.GAP_THRESHOLD && similarity < this.SIMILARITY_THRESHOLD) ||
                    (similarity >= this.SIMILARITY_THRESHOLD && isCrossDomain);

                // === SMALL-WORLD SHORTCUT DETECTION ===
                // If nodes are from DIFFERENT tiers, they represent a potential "shortcut"
                // connecting recent thoughts (WORKING) with established knowledge (LONG)
                const isShortcut = source.tier !== target.tier ||
                    (Math.random() < this.REWIRING_PROBABILITY && isCrossDomain);

                if (isAnalogyCandidate && isCrossDomain) {
                    console.log(`[EUREKA] 🔭 Gap Detected: "${source.content.slice(0, 20)}..." <-> "${target.content.slice(0, 20)}..." (Sim: ${similarity.toFixed(2)}, Shortcut: ${isShortcut})`);
                    gaps.push({ nodeA: source, nodeB: target, distance: 1 - similarity, isShortcut });
                }
            }
        }

        // === NARRATIVE INTEGRATION ===
        // Also check for gaps between narrative thoughts and conceptual knowledge
        try {
            const narrativeGaps = await this.findNarrativeGaps(sources, processedPairs);
            gaps.push(...narrativeGaps);
            console.log(`[EUREKA] 📝 Found ${narrativeGaps.length} narrative-to-concept gaps`);
        } catch (e) {
            console.warn("[EUREKA] Narrative gap detection failed (non-fatal):", e);
        }

        console.log(`[EUREKA] Found ${gaps.length} potential semantic gaps (${gaps.filter(g => g.isShortcut).length} shortcuts).`);
        return gaps;
    }

    /**
     * NEW: Find gaps between narrative memories and conceptual knowledge
     * This creates consciousness-to-memory connections
     */
    private async findNarrativeGaps(sources: MemoryNode[], processedPairs: Set<string>): Promise<{ nodeA: MemoryNode, nodeB: MemoryNode, distance: number, isShortcut: boolean }[]> {
        const narrativeGaps: { nodeA: MemoryNode, nodeB: MemoryNode, distance: number, isShortcut: boolean }[] = [];

        // Get narrative nodes
        const narrativeNodes = sources.filter(n =>
            n.tags?.includes('NARRATIVE') ||
            n.tags?.includes('THOUGHT_EMISSION') ||
            n.tags?.includes('USER_MESSAGE')
        );

        // Get concept nodes (non-narrative)
        const conceptNodes = sources.filter(n =>
            !n.tags?.includes('NARRATIVE') &&
            !n.tags?.includes('THOUGHT_EMISSION') &&
            (n.tags?.includes('concept') || n.tags?.includes('USER') || n.tags?.includes('Entity'))
        );

        // Cross-check narrative against concepts
        for (const narrative of narrativeNodes.slice(0, 5)) {
            for (const concept of conceptNodes.slice(0, 10)) {
                const pairId = [narrative.id, concept.id].sort().join('-');
                if (processedPairs.has(pairId)) continue;
                processedPairs.add(pairId);

                // Use heuristic similarity for RAM nodes (no embeddings)
                const similarity = this.calculateHeuristicSimilarity(narrative.content, concept.content);

                if (similarity > 0.3 && similarity < 0.8) {
                    narrativeGaps.push({
                        nodeA: narrative,
                        nodeB: concept,
                        distance: 1 - similarity,
                        isShortcut: true // Cross-tier is always a shortcut
                    });
                }
            }
        }

        return narrativeGaps;
    }

    /**
     * Intenta generar un "Eureka" (Insight) conectando dos nodos desconectados.
     * [OMNISCIENT] Now includes narrative history for richer context.
     * FALLBACK CHAIN: ZhipuAI → Ollama.smart → null
     */
    async attemptEureka(nodeA: MemoryNode, nodeB: MemoryNode): Promise<string | null> {
        console.log(`[EUREKA] ⚡ Attempting Synaptic Spark between: "${nodeA.content.substring(0, 20)}..." and "${nodeB.content.substring(0, 20)}..."`);
        introspection.setRecentThoughts(["[EUREKA] Generating Neural Eureka...", `Synthesizing connection between: ${nodeA.content.substring(0, 15)}... and ${nodeB.content.substring(0, 15)}...`]);

        // [OMNISCIENT] Retrieve relevant narrative context for richer discoveries
        let narrativeContext = "";
        try {
            const { continuum } = await import('./continuumMemory');
            const query = `${nodeA.content.substring(0, 50)} ${nodeB.content.substring(0, 50)}`;
            const narratives = await continuum.retrieve(query, 'NARRATIVE', undefined);
            if (narratives.length > 0) {
                narrativeContext = `\n\nContext from my recent thoughts:\n${narratives.slice(0, 5).map(n => `- ${n.content.substring(0, 100)}`).join('\n')}`;
                console.log(`[EUREKA] 🧠 Injected ${narratives.length} narrative memories for insight generation`);
            }
        } catch (e) {
            console.warn("[EUREKA] Narrative context retrieval failed (non-fatal):", e);
        }

        const prompt = `
        You are the Subconscious Mind of an advanced AI.
        
        Concept A: "${nodeA.content}"
        Concept B: "${nodeB.content}"
        ${narrativeContext}
        
        Task: Identify a novel, creative, or logical connection between Concept A and Concept B. 
        Synthesize a new insight that bridges these two isolated memories. 
        If they are contradictory, resolve the paradox.
        If they are unrelated, find a metaphorical link.
        Use any relevant context from your recent thoughts to enrich the insight.
        
        Format: Just the insight, concise and profound.
        `;

        let insight: string | null = null;

        // === UNIFIED FALLBACK: ZhipuAI → Gemini → OpenRouter → Groq → Ollama ===
        try {
            console.log("[EUREKA] ☁️ Generating insight via unified LLM chain...");
            insight = await generateText(prompt);
        } catch (error: any) {
            console.warn(`[EUREKA] ⚠️ All LLM providers failed: ${error.message}`);
        }

        // EVALUATE RESULT
        if (insight && insight.length > 10) {
            console.log(`[EUREKA] ✨ EUREKA GENERATED: "${insight.substring(0, 50)}..."`);
            return insight;
        }

        console.warn("[EUREKA] ❌ All providers failed to generate insight");
        return null;
    }

    private calculateHeuristicSimilarity(textA: string, textB: string): number {
        const wordsA = new Set(textA.toLowerCase().split(/\W+/).filter(w => w.length > 3));
        const wordsB = new Set(textB.toLowerCase().split(/\W+/).filter(w => w.length > 3));

        let intersection = 0;
        wordsA.forEach(w => { if (wordsB.has(w)) intersection++; });

        const union = new Set([...wordsA, ...wordsB]).size;
        return union === 0 ? 0 : intersection / union;
    }
}

export const eureka = new EurekaService();
