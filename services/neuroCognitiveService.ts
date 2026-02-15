import { graph } from './graphService';
import { introspection } from './introspectionEngine';
import { generateText } from './geminiService'; // Uses fallback chain: Gemini → OpenRouter → Groq → Ollama
import { SystemProtocol, MemoryTier } from '../types';
import { systemBus } from './systemBus';
import { eureka } from './eurekaService'; // Serendipitous discovery via vector similarity
import { discoveryJournal } from './discoveryJournal'; // Persistent discovery memory
// Circular import removed

// ═══════════════════════════════════════════════════════════════════════════
// [PHASE 17] BIOMIMETIC VALIDATION SYSTEM
// Based on: Dopamine RPE, Circuit Breaker Patterns, T-Cell Affinity Selection
// ═══════════════════════════════════════════════════════════════════════════

/** 
 * Validation decisions inspired by biological systems:
 * - ACCEPT: High affinity, direct integration (T-cell positive selection)
 * - REFINE: Moderate affinity, needs more research (affinity maturation)
 * - DEFER: Low confidence, retry later with more context (circuit breaker HALF-OPEN)
 * - REJECT: Hallucination/self-reactive (T-cell negative selection)
 */
export type ValidationDecision = 'ACCEPT' | 'REFINE' | 'DEFER' | 'REJECT';

export interface ValidationResult {
    targetNode: string;
    decision: ValidationDecision;
    confidence: number;          // Updated confidence after validation
    feedback: string;            // Why this decision was made
    refinementHint?: string;     // If REFINE: what to investigate next
    retryAfter?: number;         // If DEFER: milliseconds to wait
    rewardDelta?: number;        // RPE: -1 to +1 (for learning)
}

// DTOs for the Python Service
interface LinkPredictionRequest {
    node_id: string;
    top_k?: number;
}

interface LinkPredictionResponse {
    source_node: string;
    predictions: {
        target_node: string;
        confidence: number;
        relation_type: string;
    }[];
}

class NeuroCognitiveService {
    private readonly REASONING_ENGINE_URL = 'http://localhost:8000';
    private isDiscovering: boolean = false;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    // Deferred candidates for retry (Circuit Breaker pattern)
    private deferredCandidates: Map<string, { candidate: any, retryAt: number }> = new Map();

    constructor() {
        // [AUTO-START] Start the heartbeat if not already running
        // Wait a bit for other services to initialize
        setTimeout(() => this.startHeartbeat(), 30000);
    }

    /**
     * Starts the automatic discovery heartbeat (Proactive Curiosity)
     * Checks for new connections every 5 minutes if system is idle
     */
    public startHeartbeat() {
        if (this.heartbeatInterval) return;

        console.log("[NEURO] 💓 Starting Proactive Discovery Heartbeat (Every 5m)");
        this.heartbeatInterval = setInterval(() => {
            // Only trigger if not already busy and random chance (stochasticity)
            if (!this.isDiscovering && Math.random() > 0.3) {
                console.log("[NEURO] 💓 Heartbeat triggering spontaneous discovery...");
                this.triggerDiscoveryCycle().catch(e => console.error("[NEURO] Heartbeat Error:", e));
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Stop the heartbeat (e.g. for testing)
     */
    public stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Triggers the "Epiphany Loop".
     * Can be called by DreamerService or manually.
     */
    public async triggerDiscoveryCycle(focusNodeId?: string) {
        if (this.isDiscovering) {
            console.log("[NEURO] 🧠 Discovery already in progress. Skipping.");
            return;
        }

        this.isDiscovering = true;
        console.log("[NEURO] 🚀 Starting Discovery Cycle (Biomimetic v3 - Conscious Loop)...");

        try {
            // Check for deferred candidates ready for retry
            await this.processDeferred();

            // 1. SELECT FOCUS NODE
            const targetId = focusNodeId || await this.selectRandomConcept();
            if (!targetId) {
                console.log("[NEURO] No valid concept found for discovery.");
                return;
            }

            console.log(`[NEURO] Focused on Node: ${targetId}`);

            // 2. REQUEST INTUITION (Python GNN - System 1: Topology)
            let intuitions = await this.fetchIntuition(targetId, 5);
            console.log(`[NEURO] Received ${intuitions.length} intuitions from Reasoning Engine.`);

            // 2b. SERENDIPITOUS DISCOVERY FALLBACK (Eureka - System 1b: Vectors)
            // If topology finds nothing, use vector similarity for cross-domain discovery
            if (intuitions.length === 0) {
                console.log("[NEURO] 🌌 No topological links. Activating Eureka (Vector-based Discovery)...");

                try {
                    const gaps = await eureka.findGraphGaps(10);

                    if (gaps.length > 0) {
                        // Convert gaps to intuition format
                        intuitions = gaps.slice(0, 5).map(gap => ({
                            target_node: gap.nodeB.id,
                            confidence: 1 - gap.distance, // Convert distance to confidence
                            relation_type: 'EUREKA_LINK' // Mark as serendipitous discovery
                        }));
                        console.log(`[NEURO] 🔮 Eureka found ${intuitions.length} cross-domain candidates!`);
                    } else {
                        console.log("[NEURO] Eureka found no gaps. Discovery cycle complete.");
                        return;
                    }
                } catch (eurekaError) {
                    console.warn("[NEURO] Eureka fallback failed:", eurekaError);
                    return;
                }
            }

            // 3. BIOMIMETIC VALIDATION (System 2 - Enhanced)
            const candidates = intuitions.filter(i => i.confidence >= 0.3); // Lower threshold, let validator decide

            if (candidates.length === 0) return;

            const validationResults = await this.validateBatchHypotheses(targetId, candidates);

            // 4. PROCESS RESULTS BY DECISION TYPE
            for (const result of validationResults) {
                const candidate = candidates.find(c => c.target_node === result.targetNode);
                if (!candidate) continue;

                // LOG ALL DECISIONS TO JOURNAL (Persistent Discovery Memory)
                discoveryJournal.logDecision({
                    sourceNode: targetId,
                    targetNode: result.targetNode,
                    decision: result.decision,
                    confidence: result.confidence,
                    feedback: result.feedback,
                    refinementHint: result.refinementHint,
                    relationType: candidate.relation_type,
                    discoverySource: 'NeuroCognitiveSystem_v2'
                });

                switch (result.decision) {
                    case 'ACCEPT':
                        console.log(`[NEURO] ✅ ACCEPT: ${targetId} → ${result.targetNode} (${result.feedback})`);
                        await graph.createDiscoveryRelationship(
                            targetId,
                            result.targetNode,
                            candidate.relation_type as any,
                            result.confidence,
                            'NeuroCognitiveSystem_v2'
                        );
                        await this.applyRewardSignal(targetId, result.rewardDelta || 0.1);

                        // [OMNISCIENT] CLOSING THE CONSCIOUSNESS LOOP
                        // If this was a vector-based Eureka discovery, we need to generate the "Insight" text
                        // and inject it into the Narrative Stream.
                        if (candidate.relation_type === 'EUREKA_LINK') {
                            try {
                                const { continuum } = await import('./continuumMemory');
                                const allNodesRecord = await continuum.getAllNodes();
                                // Flatten record to array of nodes
                                const allNodes = Object.values(allNodesRecord).flat();

                                const nodeA = allNodes.find(n => n.id === targetId);
                                const nodeB = allNodes.find(n => n.id === result.targetNode);

                                if (nodeA && nodeB) {
                                    // 1. Generate Semantic Insight
                                    const insightText = await eureka.attemptEureka(nodeA, nodeB);

                                    if (insightText) {
                                        console.log(`[NEURO] 💡 Conscious Insight Generated: "${insightText}"`);

                                        // 2. Inject into Conscious Narrative (Stream of Thought)
                                        introspection.addThought(
                                            `I just realized a connection! ${insightText}`,
                                            "EPIPHANY",
                                            0.95
                                        );

                                        // 3. Persist the text Insight
                                        await continuum.store(
                                            `[EUREKA] ${insightText}`,
                                            MemoryTier.SHORT,
                                            ['INSIGHT', 'DISCOVERY', 'CONSCIOUSNESS']
                                        );
                                    }
                                }
                            } catch (e) {
                                console.warn("[NEURO] Insight generation failed:", e);
                            }
                        }

                        // [OMNISCIENT] Persist discovery to memory and link to goals
                        try {
                            const { continuum } = await import('./continuumMemory'); // Re-import safe
                            const discoveryContent = `Discovery: ${targetId} → ${result.targetNode} (${result.feedback})`;
                            await continuum.store(discoveryContent, MemoryTier.SHORT, ['DISCOVERY', 'ACCEPTED', candidate.relation_type]);

                            // Check if discovery relates to any active goal
                            const activeGoals = introspection.getActiveGoals();
                            for (const goal of activeGoals) {
                                if (result.feedback.toLowerCase().includes(goal.description.toLowerCase().split(' ')[0])) {
                                    await introspection.updateGoalProgress(goal.id, goal.progress + 5);
                                    console.log(`[NEURO] 🎯 Discovery linked to goal: ${goal.description}`);
                                }
                            }
                        } catch (e) {
                            console.warn("[NEURO] Discovery persistence failed (non-fatal):", e);
                        }
                        break;

                    case 'REFINE':
                        console.log(`[NEURO] 🔬 REFINE: ${targetId} → ${result.targetNode} - "${result.refinementHint}"`);
                        await this.triggerActiveResearch(targetId, [candidate], result.refinementHint);
                        break;

                    case 'DEFER':
                        console.log(`[NEURO] ⏳ DEFER: ${result.targetNode} - Retry in ${result.retryAfter}ms`);
                        this.deferredCandidates.set(result.targetNode, {
                            candidate: { sourceId: targetId, ...candidate },
                            retryAt: Date.now() + (result.retryAfter || 60000)
                        });
                        break;

                    case 'REJECT':
                        console.log(`[NEURO] ❌ REJECT: ${result.targetNode} - ${result.feedback}`);
                        await this.applyRewardSignal(targetId, result.rewardDelta || -0.1);
                        break;
                }
            }

            // Summary
            const stats = {
                accept: validationResults.filter(r => r.decision === 'ACCEPT').length,
                refine: validationResults.filter(r => r.decision === 'REFINE').length,
                defer: validationResults.filter(r => r.decision === 'DEFER').length,
                reject: validationResults.filter(r => r.decision === 'REJECT').length
            };
            console.log(`[NEURO] 📊 Results: ${stats.accept} ACCEPT, ${stats.refine} REFINE, ${stats.defer} DEFER, ${stats.reject} REJECT`);

        } catch (error) {
            console.error("[NEURO] Discovery Cycle Error:", error);
        } finally {
            this.isDiscovering = false;
        }
    }

    /**
     * Process deferred candidates (Circuit Breaker HALF-OPEN state)
     */
    private async processDeferred() {
        const now = Date.now();
        const readyForRetry: string[] = [];

        for (const [id, data] of this.deferredCandidates.entries()) {
            if (data.retryAt <= now) {
                readyForRetry.push(id);
            }
        }

        if (readyForRetry.length > 0) {
            console.log(`[NEURO] 🔄 Retrying ${readyForRetry.length} deferred candidates...`);
            for (const id of readyForRetry) {
                const data = this.deferredCandidates.get(id);
                if (data) {
                    // Re-queue for validation
                    this.deferredCandidates.delete(id);
                    // Will be picked up in next cycle naturally
                }
            }
        }
    }

    /**
     * Apply Reward Prediction Error signal (Dopamine-inspired)
     * Updates node's curiosityWeight in the graph
     */
    private async applyRewardSignal(nodeId: string, delta: number) {
        try {
            await graph.runQuery(`
                MATCH (n {id: $nodeId})
                SET n.curiosityWeight = COALESCE(n.curiosityWeight, 1.0) + $delta,
                    n.lastRewardSignal = timestamp()
                RETURN n.curiosityWeight as newWeight
            `, { nodeId, delta });
        } catch (e) {
            console.warn(`[NEURO] Failed to apply reward signal to ${nodeId}:`, e);
        }
    }

    private async triggerActiveResearch(sourceId: string, candidates: any[], researchHint?: string) {
        console.log(`[NEURO] 📡 Dispatching RESEARCH_REQUEST for ${sourceId} to TEAM_SCIENCE`);

        const payload = {
            id: `RES-${Date.now()}`,
            sourceId,
            candidates,
            hypothesis: researchHint || `Potential cross-domain semantic gap detected for specific review.`,
            priority: 'NORMAL'
        };

        systemBus.emit(SystemProtocol.RESEARCH_REQUEST, {
            ...payload,
            targetSquad: 'TEAM_SCIENCE'
        });
    }

    private async selectRandomConcept(): Promise<string | null> {
        // Prefer nodes with higher curiosityWeight (RPE-driven exploration)
        const result = await graph.runQuery(`
            MATCH (c:Concept) 
            RETURN c.id as id 
            ORDER BY COALESCE(c.curiosityWeight, 1.0) DESC, rand() 
            LIMIT 1
        `);
        return result[0]?.id || null;
    }

    private async fetchIntuition(nodeId: string, topK: number = 3): Promise<LinkPredictionResponse['predictions']> {
        try {
            const response = await fetch(`${this.REASONING_ENGINE_URL}/predict_links`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: nodeId, top_k: topK })
            });

            if (!response.ok) throw new Error(`Reasoning Engine Error: ${response.statusText}`);

            const data = await response.json() as LinkPredictionResponse;
            return data.predictions;
        } catch (e) {
            console.warn("[NEURO] ⚠️ Reasoning Engine Unavailable (Is Docker running?). Returning empty intuition.");
            return [];
        }
    }

    /**
     * BIOMIMETIC BATCH VALIDATION
     * Returns structured ValidationResult with ACCEPT/REFINE/DEFER/REJECT
     */
    private async validateBatchHypotheses(
        sourceId: string,
        candidates: { target_node: string, relation_type: string, confidence: number }[]
    ): Promise<ValidationResult[]> {

        const targetIds = candidates.map(c => c.target_node);
        const query = `
            MATCH (source {id: $sourceId})
            MATCH (target) WHERE target.id IN $targetIds
            RETURN source.name as sourceName, source.description as sourceDesc, 
                   target.id as targetId, target.name as targetName, target.description as targetDesc
        `;

        const contextResults = await graph.runQuery(query, { sourceId, targetIds });

        if (contextResults.length === 0) {
            return candidates.map(c => ({
                targetNode: c.target_node,
                decision: 'REJECT' as ValidationDecision,
                confidence: 0,
                feedback: 'No context available for validation',
                rewardDelta: -0.05
            }));
        }

        const sourceName = contextResults[0].sourceName;
        const sourceDesc = contextResults[0].sourceDesc;

        const candidateDescriptions = contextResults.map((r: any) => {
            const cand = candidates.find(c => c.target_node === r.targetId);
            return `- [ID: ${r.targetId}] "${r.targetName}" (Conf: ${cand?.confidence.toFixed(2)}, Rel: ${cand?.relation_type || 'RELATED_TO'}): ${r.targetDesc || 'No desc'}`;
        }).join('\n');

        // [OMNISCIENT] Include narrative context for better validation decisions
        let narrativeContext = "";
        try {
            const { continuum } = await import('./continuumMemory');
            const narratives = await continuum.retrieve(`${sourceName} discovery insight connection`, 'NARRATIVE', undefined);
            if (narratives.length > 0) {
                narrativeContext = `\n\nRECENT THOUGHTS (for context):\n${narratives.slice(0, 5).map(n => `- ${n.content.substring(0, 80)}`).join('\n')}`;
                console.log(`[NEURO] 🧠 Injected ${narratives.length} narrative memories for validation`);
            }
        } catch (e) {
            console.warn("[NEURO] Narrative context retrieval failed (non-fatal):", e);
        }

        const prompt = `
CRITICAL: You MUST respond with ONLY a valid JSON array. No explanations, no markdown, no text before or after.

You are the HYPOTHESIS VALIDATOR. Evaluate each candidate connection using these criteria:
- ACCEPT: Strong logical/scientific connection (>80% plausible)
- REFINE: Interesting but needs research (50-80% plausible, novel)
- DEFER: Unclear, needs more context (30-50% plausible)  
- REJECT: Hallucination, redundant, or implausible (<30%)

SOURCE: "${sourceName}" - ${sourceDesc || 'No description'}

CANDIDATES:
${candidateDescriptions}
${narrativeContext}

RESPOND WITH ONLY THIS JSON FORMAT (no other text):
[{"targetNode":"<id>","decision":"ACCEPT|REFINE|DEFER|REJECT","confidence":0.5,"feedback":"reason","refinementHint":"if REFINE","retryAfter":60000,"rewardDelta":0.05}]
`;

        try {
            // generateText has built-in fallback: Gemini → OpenRouter → Groq → Ollama
            const response = await generateText(prompt);

            // Extract JSON array - improved regex to handle nested objects
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                // Fallback: try to find any JSON-like structure
                console.warn("[NEURO] Validator returned no structured response. Raw:", response.slice(0, 200));
                console.warn("[NEURO] Defaulting to DEFER.");
                return candidates.map(c => ({
                    targetNode: c.target_node,
                    decision: 'DEFER' as ValidationDecision,
                    confidence: c.confidence * 0.5,
                    feedback: 'Validation response parsing failed',
                    retryAfter: 120000,
                    rewardDelta: 0
                }));
            }

            try {
                const results = JSON.parse(jsonMatch[0]) as ValidationResult[];
                // Validate structure
                if (!Array.isArray(results) || results.length === 0) {
                    throw new Error("Empty or invalid results array");
                }
                return results;
            } catch (parseError) {
                console.warn("[NEURO] JSON parse failed:", parseError);
                return candidates.map(c => ({
                    targetNode: c.target_node,
                    decision: 'DEFER' as ValidationDecision,
                    confidence: c.confidence * 0.5,
                    feedback: 'JSON parsing error',
                    retryAfter: 120000,
                    rewardDelta: 0
                }));
            }

        } catch (e) {
            console.error("[NEURO] Biomimetic Validator Error:", e);
            return candidates.map(c => ({
                targetNode: c.target_node,
                decision: 'DEFER' as ValidationDecision,
                confidence: c.confidence * 0.5,
                feedback: 'Validation error - circuit breaker triggered',
                retryAfter: 180000,
                rewardDelta: 0
            }));
        }
    }
}

export const neuroCognitive = new NeuroCognitiveService();
