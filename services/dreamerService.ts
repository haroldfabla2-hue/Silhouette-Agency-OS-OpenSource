import { continuum } from './continuumMemory';
import { geminiService } from './geminiService';
import { vectorMemory } from './vectorMemoryService';
import { CommunicationLevel } from '../types';
import { MemoryNode, MemoryTier } from '../types';
import { resourceArbiter } from './resourceArbiter';
import { AgentStatus, AgentRoleType, AgentTier, SystemProtocol } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { systemBus } from './systemBus';
import * as si from 'systeminformation'; // NEW: For Resource Monitoring

export class DreamerService {
    private isDreaming: boolean = false;
    private isTraining: boolean = false; // Prevent concurrent training
    private dreamInterval: NodeJS.Timeout | null = null;
    private memoriesAccumulated: number = 0;
    private threshold: number = 10;
    private lastTrainingTime: number = 0;
    private trainingCooldown: number = 1000 * 60 * 60; // 1 Hour min between trainings
    private startupGracePeriod: number = 1000 * 60 * 5; // 5 min startup delay
    private systemStartTime: number = Date.now();

    public setThreshold(value: number) {
        this.threshold = value;
        console.log(`[DREAMER] ⚙️ Threshold updated to ${this.threshold} memories.`);
    }

    public notifyNewMemory() {
        // [FIX] Hard cap on entropy to prevent runaway accumulation from loops
        const MAX_ENTROPY = this.threshold * 3; // 30 max (3x threshold of 10)
        if (this.memoriesAccumulated >= MAX_ENTROPY) {
            console.warn(`[DREAMER] ⚠️ Entropy hard cap reached (${MAX_ENTROPY}). Forcing consolidation.`);
            // Reset and trigger dream to prevent infinite growth
            this.memoriesAccumulated = 0;
            this.attemptDream().catch(e => console.error('[DREAMER] Forced dream failed:', e));
            return;
        }
        this.memoriesAccumulated++;
        console.log(`[DREAMER] Entropy increased: ${this.memoriesAccumulated}/${this.threshold}`);
    }

    public startDreamingLoop() {
        if (this.dreamInterval) return;

        // [OPTIMIZATION] Check PowerManager before starting
        import('./powerManager').then(({ powerManager }) => {
            if (!powerManager.isDreamerEnabled) {
                console.log("[DREAMER] 💤 Disabled by PowerManager (BALANCED mode). Use activateDreamer() to enable manually.");
                return;
            }
            this.activateDreamLoop();
        });
    }

    private activateDreamLoop() {
        if (this.dreamInterval) return;
        console.log("[DREAMER] 🌙 Dream Cycle Initiated...");

        // Check every 5 minutes if we should dream
        this.dreamInterval = setInterval(async () => {
            if (this.memoriesAccumulated >= this.threshold) {
                this.attemptDream();
            }

            // NEW: Nocturnal Plasticity Check (Sleep Mode)
            // GUARD: Wait for startup grace period to let frontend connect first
            const timeSinceStart = Date.now() - this.systemStartTime;
            if (timeSinceStart < this.startupGracePeriod) {
                console.log(`[DREAMER] ⏳ Startup grace period (${Math.round((this.startupGracePeriod - timeSinceStart) / 1000)}s remaining)`);
                return; // Skip training check during startup
            }

            const sleepReady = await this.checkSleepConditions();
            if (sleepReady && !this.isTraining && !this.isDreaming) {
                // Check if it's time to train (e.g., once per day or if buffer huge)
                // For demo: Check if we haven't trained in 1 hour
                if (Date.now() - this.lastTrainingTime > this.trainingCooldown) {
                    await this.triggerNeuralTraining();
                }
            }
        }, 300000); // Increased to 5 minutes
    }

    // ... (Existing Methods: stopDreamingLoop, attemptDream, etc.)

    // --- SYNAPTIC FORGE TRIGGER ---
    public async forceSleepCycle(options: { train: boolean, consolidate: boolean }) {
        if (this.isTraining || this.isDreaming) {
            console.warn("[DREAMER] Sleep Cycle already active.");
            return;
        }

        console.log(`[DREAMER] 💤 Starting Holistic Sleep Cycle (Train: ${options.train}, Consolidate: ${options.consolidate})`);

        // Notify System Start
        systemBus.emit(SystemProtocol.TRAINING_START, { timestamp: Date.now() }, 'DREAMER_SERVICE');

        if (options.consolidate) {
            systemBus.emit(SystemProtocol.TRAINING_LOG, { type: 'log', message: "🧠 Consolidating Short-Term Memory..." }, 'DREAMER_SERVICE');
            await continuum.forceConsolidation();
            systemBus.emit(SystemProtocol.TRAINING_LOG, { type: 'log', message: "✅ Memory Snapshot Saved." }, 'DREAMER_SERVICE');
        }

        if (options.train) {
            // NEW: Learn from Neo4j discoveries before training
            systemBus.emit(SystemProtocol.TRAINING_LOG, { type: 'log', message: "🧬 Extracting Knowledge from Neo4j Graph..." }, 'DREAMER_SERVICE');
            const neo4jExamples = await this.learnFromNeo4jConcepts();
            if (neo4jExamples > 0) {
                systemBus.emit(SystemProtocol.TRAINING_LOG, { type: 'log', message: `✅ Added ${neo4jExamples} discovery-based training examples.` }, 'DREAMER_SERVICE');
            }

            await this.triggerNeuralTraining();
        } else {
            // If only consolidation, we are done
            systemBus.emit(SystemProtocol.TRAINING_COMPLETE, { code: 0, success: true }, 'DREAMER_SERVICE');
        }
    }

    private async triggerNeuralTraining() {
        console.log("[DREAMER] 🌋 SYNAPTIC FORGE: Conditions met for Neural Update.");

        // HOMEOSTATIC CHECK: Request admission from ResourceArbiter
        const arbiterApproval = await resourceArbiter.requestAdmission({
            id: 'neural-training',
            name: 'Curricula Export',
            role: 'Neural Plasticity',
            status: AgentStatus.WORKING,
            cpuUsage: 0,
            ramUsage: 0,
            memoryLocation: 'RAM',
            lastActive: Date.now(),
            teamId: 'CORE',
            category: 'CORE',
            roleType: AgentRoleType.WORKER,
            enabled: true,
            tier: AgentTier.WORKER,
            preferredMemory: 'RAM'
        }, 'LOW'); // Lowest priority - yields to all other work

        if (!arbiterApproval) {
            console.log("[DREAMER] ⏳ Curricula export queued by ResourceArbiter. Will retry when resources available.");
            systemBus.emit(SystemProtocol.TRAINING_LOG, { type: 'log', message: "⏳ Curricula export queued (waiting for resources)..." }, 'DREAMER_SERVICE');
            return;
        }

        console.log("[DREAMER] ✅ ResourceArbiter approved curricula export.");
        this.isTraining = true;

        // Notify System
        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            step: "CURRICULA_EXPORT_STARTED",
            status: "IN_PROGRESS"
        });

        systemBus.emit(SystemProtocol.TRAINING_LOG, { type: 'log', message: "📚 Starting Curricula Export for NanoSilhouette..." }, 'DREAMER_SERVICE');

        try {
            // Import the new curricula export service
            const { curriculaExportService } = await import('./training/curriculaExportService');

            // Export curricula (lightweight, no GPU required)
            const result = await curriculaExportService.exportCurricula();

            this.isTraining = false;
            resourceArbiter.release();
            console.log("[DREAMER] 🔓 Resources released to Arbiter.");

            if (result.success && result.entriesExported > 0) {
                this.lastTrainingTime = Date.now();

                systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
                    step: "CURRICULA_EXPORT_COMPLETE",
                    status: "SUCCESS"
                });

                console.log(`[DREAMER] 📚 Curricula Export Complete: ${result.entriesExported} entries exported`);
                systemBus.emit(SystemProtocol.TRAINING_LOG, {
                    type: 'log',
                    message: `✅ Curricula exported: ${result.entriesExported} entries → ${result.path}`
                }, 'DREAMER_SERVICE');

                systemBus.emit(SystemProtocol.TRAINING_LOG, {
                    type: 'log',
                    message: "💡 NanoSilhouette can now consume this curriculum for training."
                }, 'DREAMER_SERVICE');

                // [SELF-AWARENESS] Conclude the learning cycle with a conscious realization
                import('./introspectionEngine').then(({ introspection }) => {
                    introspection.addThought(
                        `I have prepared ${result.entriesExported} training examples as a curriculum for NanoSilhouette. The knowledge collected from my interactions is now ready for neural consolidation.`,
                        "META_COGNITION",
                        0.9
                    );
                });

            } else if (result.entriesExported === 0) {
                console.log("[DREAMER] ⚠️ No training examples to export. Dataset is empty.");
                systemBus.emit(SystemProtocol.TRAINING_LOG, {
                    type: 'log',
                    message: "⚠️ No training examples collected yet. Continue interacting to generate data."
                }, 'DREAMER_SERVICE');

                systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
                    step: "CURRICULA_EXPORT_COMPLETE",
                    status: "SUCCESS" // Still success, just empty
                });
            } else {
                throw new Error(result.error || "Unknown export error");
            }

            systemBus.emit(SystemProtocol.TRAINING_COMPLETE, {
                code: 0,
                success: true,
                entriesExported: result.entriesExported,
                curriculaPath: result.path
            }, 'DREAMER_SERVICE');

        } catch (error: any) {
            console.error("[DREAMER] ❌ Curricula Export Failed:", error.message);
            this.isTraining = false;
            resourceArbiter.release();

            systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
                step: "CURRICULA_EXPORT_FAILED",
                status: "ERROR"
            });

            systemBus.emit(SystemProtocol.TRAINING_LOG, {
                type: 'error',
                message: `❌ Curricula Export Failed: ${error.message}`
            }, 'DREAMER_SERVICE');

            systemBus.emit(SystemProtocol.TRAINING_COMPLETE, {
                code: 1,
                success: false,
                error: error.message
            }, 'DREAMER_SERVICE');
        }
    }

    // ... (Existing Methods: checkSleepConditions, etc.)

    public stopDreamingLoop() {
        if (this.dreamInterval) {
            clearInterval(this.dreamInterval);
            this.dreamInterval = null;
            console.log("[DREAMER] ☀️ Waking up...");
        }
    }

    public async attemptDream() {
        if (this.isDreaming) return;

        // 1. Check Real System Load via Arbiter
        // Verify if we have spare compute to dream
        const admission = await resourceArbiter.requestAdmission({
            id: 'dreamer',
            name: 'Dreamer Service',
            role: 'Subconscious',
            status: AgentStatus.WORKING,
            cpuUsage: 0,
            ramUsage: 0,
            memoryLocation: 'RAM',
            lastActive: Date.now(),
            teamId: 'CORE',
            category: 'CORE',
            roleType: AgentRoleType.WORKER,
            enabled: true,
            tier: AgentTier.WORKER,
            preferredMemory: 'RAM'
        }, 'LOW');

        if (!admission) {
            console.log("[DREAMER] 🛑 Insufficient resources to dream right now.");
            return;
        }

        this.isDreaming = true;
        // Update Introspection Engine Status
        import('./introspectionEngine').then(({ introspection }) => {
            introspection.setDreaming(true);
        });

        try {
            // 2. Gather "Day Residue" (Random L2/L3 memories)
            const allNodes = await continuum.getAllNodes();
            // FIX: 'gatherDayResidue' is async now, must await
            const memories = await this.gatherDayResidue(allNodes);

            if (memories.length < 2) { // Allow pairs for Bisociation
                // Not enough to dream about
                this.isDreaming = false;
                return;
            }

            console.log(`[DREAMER] 💤 REM Stage: Synthesizing ${memories.length} memories...`);

            // 3. Synthesize Patterns
            const result = await this.synthesizePatterns(memories);

            // 4. Handle Outcomes
            if (result && result.outcome === 'ACCEPTED') {
                await this.consolidateIntuition(result.content);
            } else if (result && result.outcome === 'MYSTERY') {
                console.log(`[DREAMER] 🕵️ Epistemic Gap Detected: "${result.content}" (Confidence: ${result.veracity}%)`);

                // [NEW] SKEPTIC CHALLENGE
                // Try to upgrade the Mystery to an Accepted Truth via rigorous debate
                const verifiedResult = await this.verifyMystery(result.content, result.veracity);

                if (verifiedResult.outcome === 'ACCEPTED') {
                    console.log(`[DREAMER] ⚔️ Skeptic Challenge Passed! Upgrading mystery to truth.`);
                    await this.consolidateIntuition(verifiedResult.content);
                } else {
                    console.log(`[DREAMER] 🛡️ Mystery remains solved but unproven. Logging gap.`);
                    // Emit Epistemic Gap as before
                    systemBus.emit(
                        SystemProtocol.EPISTEMIC_GAP_DETECTED,
                        {
                            question: result.content,
                            source: 'DreamerService',
                            confidence: result.veracity / 100,
                            context: memories.map(m => m.id)
                        },
                        'DreamerService'
                    );

                    // Store as Open Loop in Graph
                    import('./graphService').then(({ graph }) => {
                        graph.createDiscoveryRelationship('DREAMER', 'MYSTERY_BOX', 'IMPLIES', result.veracity, 'CURIOSITY_ENGINE')
                            .then(() => console.log("[DREAMER] Mystery Node Created"))
                            .catch(e => console.warn(e));
                    });
                }

            } else {
                console.log("[DREAMER] 📉 Dream rejected by Scientific Auditor.");
            }

            // 5. Clear Processed Nodes from Hippocampus
            const processedIds = memories.map(m => m.id);
            continuum.clearHippocampus(processedIds);

            // 6. RAPTOR INGESTION (Hierarchical Consolidation)
            // If we have enough memories, build a tree structure for today's context.
            if (memories.length >= 5) {
                console.log(`[DREAMER] 🦖 Triggering RAPTOR Ingestion for ${memories.length} memories...`);
                import('./semanticMemory').then(({ semanticMemory }) => {
                    const combinedText = memories.map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.content}`).join('\n');
                    const dayTitle = `Dream_Cycle_${new Date().toISOString().split('T')[0]}_${Date.now()}`;
                    semanticMemory.ingestDocument(dayTitle, combinedText).catch(e => console.error("[DREAMER] RAPTOR Failed:", e));
                });
            }

        } catch (e) {
            console.error("[DREAMER] Nightmare (Error):", e);
        } finally {
            this.isDreaming = false;
            this.memoriesAccumulated = 0; // Reset Entropy
            // Update Introspection Engine Status
            import('./introspectionEngine').then(({ introspection }) => {
                introspection.setDreaming(false);
            });
        }
    }

    private async gatherDayResidue(all: any): Promise<MemoryNode[]> {
        const mode = Math.random() > 0.5 ? 'CONSTELLATION' : 'PARADOX';
        console.log(`[DREAMER] 🌙 Dream Mode: ${mode}`);

        if (mode === 'CONSTELLATION') {
            return this.gatherConstellation(all);
        } else {
            return this.gatherParadoxes(all);
        }
    }

    private async gatherConstellation(all: any): Promise<MemoryNode[]> {
        // --- PHASE 1: CONSTELLATION DISCOVERY (POLYMATIC) ---
        // Instead of just pairs, we look for "Constellations" of 3-5 nodes to find unified theories.

        // 1. Pick a "Seed" Concept (High Importance)
        const candidates = [...(all.MEDIUM || []), ...(all.DEEP || [])];
        if (candidates.length === 0) return this.fallbackMix(all);
        const seed = candidates[Math.floor(Math.random() * candidates.length)];
        if (!seed || !seed.content) return this.fallbackMix(all);

        console.log(`[DREAMER] 🔭 Seed Concept Selected: "${seed.content.substring(0, 50)}..."`);

        try {
            // 2. Find "Constellation Members" (Sim: 0.3 - 0.7)
            // Dynamic Import for Vector Service
            const { vectorMemory } = await import('./vectorMemoryService');
            const { geminiService } = await import('./geminiService');

            const seedVector = await geminiService.generateEmbedding(seed.content);
            if (!seedVector) return this.fallbackMix(all);

            // We look for 3 to 5 related concepts
            const distantMatches = await vectorMemory.searchDistantMemories(seedVector, 0.30, 0.85, 4);

            // Prepare nodes
            let nodes = [seed];
            if (distantMatches.length > 0) {
                nodes = nodes.concat(distantMatches.map(m => this.mapVectorToNode(m, 'CONSTELLATION_MEMBER')));
            }

            // ENRICHMENT: Get Neighbors
            return await this.enrichWithNeighbors(nodes);

        } catch (e) {
            console.error("[DREAMER] Discovery Protocol Failed, using fallback.", e);
            return this.fallbackMix(all);
        }
    }

    private async gatherParadoxes(all: any): Promise<MemoryNode[]> {
        // "THE ALCHEMIST" STRATEGY:
        // Find two Unrelated Concepts and force a collision.
        console.log("[DREAMER] ⚗️ Mixing volatile concepts (Paradox Mode)...");

        const candidates = [...(all.MEDIUM || []), ...(all.DEEP || [])];
        if (candidates.length < 2) return this.fallbackMix(all);

        const seed = candidates[Math.floor(Math.random() * candidates.length)];

        try {
            const { vectorMemory } = await import('./vectorMemoryService');
            const { geminiService } = await import('./geminiService');

            const seedVector = await geminiService.generateEmbedding(seed.content);
            if (!seedVector) return this.fallbackMix(all);

            // Search DISTANT/OPPOSITE (Sim < 0.25) or just Random weighted by distance
            // Since vector search usually returns closes, we might just pick another random note 
            // and verify it is NOT close.

            let antiSeed: MemoryNode | null = null;
            let attempts = 0;

            while (!antiSeed && attempts < 5) {
                const candidate = candidates[Math.floor(Math.random() * candidates.length)];
                if (candidate.id !== seed.id) {
                    // In a full implementation we would check cosine sim here.
                    // For now, random selection from different topics is a good proxy for "unrelated".
                    antiSeed = candidate;
                }
                attempts++;
            }

            if (!antiSeed) return this.fallbackMix(all);

            let nodes = [seed, antiSeed];
            // ENRICHMENT: Get Neighbors
            return await this.enrichWithNeighbors(nodes);

        } catch (e) { return this.fallbackMix(all); }
    }

    private async enrichWithNeighbors(nodes: MemoryNode[]): Promise<MemoryNode[]> {
        try {
            const { graph } = await import('./graphService');
            // ACTUALLY: Let's fetch neighbors per node to be precise.
            for (const node of nodes) {
                const nodeNeighbors = await graph.getRelatedConcepts([node.id]);
                const contextStr = nodeNeighbors.map(n => `${n.relationship} -> ${n.name}`).join(', ');
                if (contextStr) {
                    (node as any).contextString = `(Connected to: ${contextStr})`;
                }
            }
            return nodes;

        } catch (e) {
            console.warn("[DREAMER] Context enrichment failed, proceeding with raw nodes.", e);
            return nodes;
        }
    }

    private mapVectorToNode(m: any, tag: string): MemoryNode {
        return {
            id: m.id,
            content: m.payload.content,
            tier: MemoryTier.DEEP,
            timestamp: m.payload.timestamp,
            tags: [...(m.payload.tags || []), tag],
            importance: 1,
            decayHealth: 100,
            accessCount: 0,
            lastAccess: Date.now(),
            compressionLevel: 0
        };
    }

    private fallbackMix(all: any): MemoryNode[] {
        // Original Stochastic Mix
        const signalCandidates = [...(all.SHORT || []), ...(all.MEDIUM || [])]
            .filter((n: MemoryNode) => n.importance > 0.7 || n.tags.includes('CRITICAL'));

        const signal = signalCandidates
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 3);

        const hippocampus = continuum.getHippocampus();
        const noise = hippocampus
            .sort(() => Math.random() - 0.5)
            .slice(0, 7);

        return [...signal, ...noise];
    }

    private async synthesizePatterns(nodes: MemoryNode[]): Promise<{ content: string; veracity: number; outcome: 'ACCEPTED' | 'REJECTED' | 'MYSTERY' | 'INSUFFICIENT_DATA' }> {
        // Truncate content to prevent Context Limit Exceeded
        const MAX_CHARS_PER_NODE = 1500;
        const context = nodes.map((n, index) => {
            const content = n.content || '';
            const neighbors = (n as any).contextString || "(Isolated Node)";
            const truncated = content.length > MAX_CHARS_PER_NODE
                ? content.substring(0, MAX_CHARS_PER_NODE) + "... [TRUNCATED]"
                : content;
            return `Concept ${index + 1}: ${truncated}\n   Graph Context: ${neighbors}`;
        }).join('\n\n');

        // PHASE 2 & 3: POLYMATH SYNTHESIS + TRIBUNAL REVIEW
        const prompt = `
        [ROLE]
        You are the SUB-CONSCIOUS DISCOVERY ENGINE + SCIENTIFIC AUDITOR.
        You specialize in "Consilience" (Unity of Knowledge) and Cross-Domain Isomorphism.
        
        [INPUT]
        Active Concepts (Nodes + Graph Neighbors):
        ${context}

        [TASK]
        1. (CROSS-DOMAIN MAPPING) Verify if these concepts come from different domains (e.g., Biology vs Software).
           If so, look for FUNCTIONAL HOMOLOGY. "How is System A mechanically similar to System B?"
        2. (SYNTHESIS) Propose a "Unified Theory" or a "Metaphorical Transfer". 
           Example: "Applying 'Viral Load' kinetics from Immune System (A) to 'DDOS Traffic' in Web App (B)".
        3. (GAP ANALYSIS) Is this similarity superficial or deep? If deep, do we lack papers/proof?
        4. (SCORING) Grade the "Veracity" (0-100).

        [OUTPUT TYPES]
        A. If you see a profound connection:
           "INTUITION: [The Insight / Cross-Domain hypothesis] (Veracity: [Score])"
        B. If the connection is intriguing but you lack domain knowledge (e.g., specific biological mechanisms):
           "STATUS: INSUFFICIENT_DATA"
           "QUERY: [Deep Research Question to validate the isomorphism]"
        
        [SCORING CRITERIA]
        - 85-100: REVOLUTIONARY. (Valid Cross-Domain Isomorphism).
        - 70-84: Strong Analogy.
        - 40-69: Weak or Vague.
        - 0-39: Nonsense.
        `;

        const response = await geminiService.generateAgentResponse(
            "Dreamer",
            "Polymath",
            "CORE",
            prompt,
            null,
            undefined,
            undefined,
            { useWebSearch: false },
            {},
            [],
            CommunicationLevel.TECHNICAL,
            'gemini-1.5-flash'
        );

        // Check for Research Trigger
        if (response.output.includes("INSUFFICIENT_DATA")) {
            const queryMatch = response.output.match(/QUERY:\s*(.*)/i);
            const query = queryMatch ? queryMatch[1].trim() : "Investigate connection between these concepts";

            // Trigger Research
            await this.triggerDeepResearch(query, nodes);

            return { content: query, veracity: 0, outcome: 'INSUFFICIENT_DATA' };
        }

        const match = response.output.match(/INTUITION:\s*(.*)\s*\(Veracity:\s*(\d+)\)/i);

        if (!match) {
            return { content: "No Pattern", veracity: 0, outcome: 'REJECTED' };
        }

        const content = match[1].trim();
        const veracity = parseInt(match[2], 10);

        if (veracity >= 85) return { content, veracity, outcome: 'ACCEPTED' };
        if (veracity >= 40) return { content, veracity, outcome: 'MYSTERY' };

        return { content, veracity, outcome: 'REJECTED' };
    }

    // --- SKEPTIC VERIFICATION LOOP (New) ---
    private async verifyMystery(content: string, currentScore: number): Promise<{ content: string; veracity: number; outcome: 'ACCEPTED' | 'MYSTERY' }> {
        console.log(`[DREAMER] ⚔️ Initiating Skeptic Review for: "${content}"`);

        const prompt = `
        ROLE: Scientific Skeptic & Devil's Advocate.
        HYPOTHESIS: "${content}"
        CURRENT CONFIDENCE: ${currentScore}%
        
        TASK: mercilessly attack this hypothesis.
        1. Is it a tautology?
        2. Is it a known fallacy?
        3. Is it already obvious?
        
        IF it survives your attack, explain WHY it is profound.
        
        OUTPUT FORMAT:
        "VERDICT: [ACCEPTED|REJECTED]"
        "NEW_CONFIDENCE: [0-100]"
        "REASON: [Short explanation]"
        `;

        try {
            const response = await geminiService.generateAgentResponse(
                "Dreamer", "Skeptic", "CORE", prompt, null, undefined, undefined,
                { useWebSearch: false }, {}, [], CommunicationLevel.TECHNICAL
            );

            const verdictMatch = response.output.match(/VERDICT:\s*(ACCEPTED|REJECTED)/i);
            const scoreMatch = response.output.match(/NEW_CONFIDENCE:\s*(\d+)/);

            if (verdictMatch && scoreMatch) {
                const verdict = verdictMatch[1].toUpperCase();
                const newScore = parseInt(scoreMatch[1]);

                if (verdict === 'ACCEPTED' && newScore >= 85) {
                    return { content, veracity: newScore, outcome: 'ACCEPTED' };
                }
            }
        } catch (e) {
            console.warn("[DREAMER] Skeptic check failed.", e);
        }

        return { content, veracity: currentScore, outcome: 'MYSTERY' };
    }

    private async triggerDeepResearch(query: string, contextNodes: MemoryNode[]) {
        console.log(`[DREAMER] 🕵️‍♂️ Insufficient Data. Commissioning RESEARCH SQUAD for: "${query}"`);

        // Emit Task Assignment for Orchestrator/Researcher
        // Corrected Payload to match Orchestrator.handleTaskAssignment contract
        systemBus.emit(SystemProtocol.TASK_ASSIGNMENT, {
            targetRole: 'sci-03', // Researcher Pro
            taskType: 'DEEP_RESEARCH', // This will become the "instruction" for the agent
            priority: 'CRITICAL',
            context: {
                query: query,
                sourceNodes: contextNodes.map(n => n.content.substring(0, 200)),
                goal: "Find evidence to bridge these concepts."
            }
        }, 'DreamerService');
    }

    private async consolidateIntuition(content: string) {
        console.log(`[DREAMER] ✨ Epiphany Candidate: ${content}`);

        // 1. Semantic Deduplication (The "Anti-Loop" Mechanism)
        const isDuplicate = await this.isRedundant(content);
        if (isDuplicate) {
            console.log(`[DREAMER] ♻️ Intuition Reinforced (Duplicate detected - Skipping new insert)`);
            return;
        }

        // 2. Store in Continuum (Vector DB)
        // Use Continuum to store in DEEP tier (which routes to Qdrant)
        await continuum.store(content, MemoryTier.DEEP, ['INTUITION', 'DREAM', 'SUBCONSCIOUS']);

        // 3. Graph Integration (Structure the Insight)
        try {
            // Lazy load graph services to avoid circular deps if any
            const { graphExtractor } = await import('./graphExtractionService');
            const { graph } = await import('./graphService');

            const graphData = await graphExtractor.extractEntities("Self-Reflection", content);

            // Store Nodes
            for (const node of graphData.nodes) {
                // ROBUSTNESS FIX: Concepts must be unique by defined Name, not random ID.
                const mergeKey = node.label === 'Concept' ? 'name' : 'id';

                // If merging by name, ensure we don't overwrite the existing ID with a new random one
                if (mergeKey === 'name' && node.properties.id) {
                    delete node.properties.id;
                }

                await graph.createNode(node.label, node.properties, mergeKey);
            }

            // Store Edges
            for (const edge of graphData.edges) {
                await graph.createRelationship(edge.from, edge.to, edge.type, edge.properties);
            }
            console.log(`[DREAMER] 🕸️ Intuition woven into Knowledge Graph.`);

        } catch (e) {
            console.warn("[DREAMER] Graph integration failed (Non-critical):", e);
        }

        // 4. Neuro-Link Emission (Trigger Evolution)
        systemBus.emit(
            SystemProtocol.INTUITION_CONSOLIDATED,
            {
                idea: content,
                timestamp: Date.now(),
                source: 'DreamerService',
                confidence: 1.0 // It passed the Critic
            },
            'DreamerService'
        );
        console.log(`[DREAMER] 📡 Signal beamed to Neuro-Synapse.`);

        // 5. TRIGGER NEUROCOGNITIVE DISCOVERY (The new Lobe)
        // Now that we have a new concept, let's see what *else* it unlocks in the graph
        import('./neuroCognitiveService').then(({ neuroCognitive }) => {
            neuroCognitive.triggerDiscoveryCycle();
        });
    }

    private async isRedundant(content: string): Promise<boolean> {
        try {
            const vector = await geminiService.generateEmbedding(content);
            if (!vector) return false;

            // Search for similar memories in the 'INTUITION' namespace (implied by content similarity)
            // We search globally in vector memory for now
            const results = await vectorMemory.searchMemory(vector, 1);

            if (results.length > 0) {
                const bestMatch = results[0];
                // Threshold: 0.90 (90% Similarity means it's basically the same thought)
                if (bestMatch.score > 0.90) {
                    console.log(`[DREAMER] Redundancy Detected (Score: ${bestMatch.score.toFixed(4)}) with: "${bestMatch.payload?.content?.substring(0, 50)}..."`);
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error("[DREAMER] Redundancy check failed:", e);
            return false; // Fail safe: assume new
        }
    }
    // --- DEEP SLEEP PROTOCOL (Consolidation) ---
    public async consolidateLongTerm(nodes: MemoryNode[]) {
        if (nodes.length === 0) return;

        console.log(`[DREAMER] 🧶 Consolidating ${nodes.length} Long-Term memories into Deep Storage...`);

        // 1. Group by context (for now, simple batch)
        // In a real system, we might cluster by embedding similarity first.

        try {
            // 2. Generate Summary via LLM
            const context = nodes.map(n => `[${new Date(n.timestamp).toLocaleString()}] ${n.content}`).join('\n');
            const summary = await this.generateDeepSummary(context);

            if (summary) {
                // 3. Store in Deep Memory (Vector)
                // We use a specific tag 'ARCHIVE_VOLUME' to indicate it's a compressed batch
                const archiveId = uuidv4();
                await continuum.store(
                    `[ARCHIVE ${new Date().toLocaleDateString()}] ${summary}`,
                    MemoryTier.DEEP,
                    ['ARCHIVE', 'DEEP_SLEEP', 'COMPRESSED']
                );
                console.log(`[DREAMER] ✅ Archived ${nodes.length} nodes to Deep Memory.`);

                // 4. Cleanup Original Nodes (Soft Delete or Hard Delete)
                // For now, we return true so the caller (Continuum) can remove them.
            }
        } catch (e) {
            console.error("[DREAMER] Deep Sleep Failed:", e);
        }
    }

    // --- PHASE 7: SERENDIPITY (Active Dreaming) ---
    public async synthesizeDeepConnections() {
        if (this.isDreaming) return;
        this.isDreaming = true;
        console.log("[DREAMER] 🌌 Entering Deep Dream (Serendipity Mode)...");

        try {
            // 1. Goldilocks Selection
            // Pick a random "Core Concept" from Vector DB (Simulated by grabbing a random memory for now)
            // In a real vector DB we'd grab a random Point ID. 
            // Here we use Day Residue as the "Anchor".
            const nodes = await continuum.getAllNodes();
            // Use Short-Term anchors
            const anchors = [...(nodes[MemoryTier.WORKING] || [])].sort(() => Math.random() - 0.5).slice(0, 3);

            if (anchors.length === 0) {
                console.log("[DREAMER] 🌌 Mind is empty. Nothing to dream about.");
                return;
            }

            for (const anchor of anchors) {
                console.log(`[DREAMER] ⚓ Anchor Concept: "${anchor.content.substring(0, 50)}..."`);
                const embedding = await geminiService.generateEmbedding(anchor.content);
                if (!embedding) {
                    console.error("[DREAMER] ❌ Failed to generate embedding for anchor.");
                    continue;
                }

                // Search for Goldilocks Candidates (Dist: 0.3 - 0.5)
                // Since our vector store might not support range queries natively yet, 
                // we fetch top 10 and filter manually by score.
                const results = await vectorMemory.searchMemory(embedding, 10);

                // Filter: Score between 0.5 and 0.7 (simulating distance)
                // Note: Cosine Similarity 1.0 is identical. 0.0 is orthogonal.
                // We want ~0.6 (Metaphor Zone).
                const candidates = results.filter(r => r.score < 0.85 && r.score > 0.5);

                if (candidates.length === 0) {
                    console.log("[DREAMER] 🔸 No Goldilocks candidates found for anchor.");
                    continue;
                }

                const partner = candidates[0]; // Take the best fit
                console.log(`[DREAMER] ⚡ Spark found: "${partner.payload?.content?.substring(0, 50)}..." (Score: ${partner.score.toFixed(2)})`);

                // 2. Isomorphism Check (The Bridge)
                const insight = await this.attemptBisociation(anchor.content, partner.payload?.content || '');

                if (insight) {
                    // 3. Adversarial Review (The Critic)
                    const grade = await this.criticReview(insight);
                    if (grade >= 8) {
                        await this.consolidateIntuition(`[SERENDIPITY] ${insight}`);
                        console.log(`[DREAMER] 🏆 DISCOVERY SAVED! Grade: ${grade}/10`);
                    } else {
                        console.log(`[DREAMER] 🗑️ Idea rejected by Critic. Grade: ${grade}/10`);
                    }
                }
            }

            // [EUREKA MULTI-TIER INTEGRATION] Search for long-range shortcuts across all memory tiers
            console.log("[DREAMER] 🧠 Searching for Watts-Strogatz shortcuts across memory tiers...");
            try {
                const { eureka } = await import('./eurekaService');
                const gaps = await eureka.findGraphGaps(5); // Get 5 best gaps

                for (const gap of gaps.filter(g => g.isShortcut)) {
                    const nodeALabel = (gap.nodeA.content || gap.nodeA.id || '').substring(0, 30);
                    const nodeBLabel = (gap.nodeB.content || gap.nodeB.id || '').substring(0, 30);
                    console.log(`[DREAMER] 🌉 Found shortcut: "${nodeALabel}..." ↔ "${nodeBLabel}..." (Distance: ${gap.distance.toFixed(2)})`);

                    // Attempt to bridge the gap
                    const bridgeInsight = await this.attemptBisociation(
                        gap.nodeA.content || gap.nodeA.id,
                        gap.nodeB.content || gap.nodeB.id
                    );

                    if (bridgeInsight) {
                        const grade = await this.criticReview(bridgeInsight);
                        if (grade >= 7) { // Slightly lower threshold for structural discoveries
                            await this.consolidateIntuition(`[SHORTCUT] ${bridgeInsight}`);
                            console.log(`[DREAMER] 🌉 SHORTCUT BRIDGED! Grade: ${grade}/10`);
                        }
                    }
                }
            } catch (e) {
                console.warn("[DREAMER] Eureka integration skipped:", e);
            }

        } catch (e) {
            console.error("[DREAMER] Deep Dream Error:", e);
        } finally {
            this.isDreaming = false;
        }

        // After deep dream, check for Structural Gaps (Eurekas)
        setTimeout(() => this.generateNeuralEurekas(), 5000);
    }

    private async attemptBisociation(conceptA: string, conceptB: string): Promise<string | null> {
        const prompt = `
        You are the Polymath System Architect.
        Concept A: "${conceptA.substring(0, 300)}"
        Concept B: "${conceptB.substring(0, 300)}"

        TASK: Identify a HIDDEN STRUCTURAL ISOMORPHISM between these two concepts.
        We are looking for "Bisociation" - the connection of two previously unrelated matrices of thought.
        
        RULES:
        1. Avoid surface-level puns or linguistic similarities.
        2. Focus on shared *mechanisms*, *dynamics*, or *topology*.
        3. The insight must be non-obvious (surprising yet inevitable in hindsight).

        Example: 
        A: "Computer Virus" | B: "Biological Flu"
        Isomorphism: "Both exploit host replication mechanisms to spread code/DNA, relying on the host's inability to distinguish self from non-self."

        If no deep link exists, output: NULL
        If a valid link exists, output: "BISOCIATION: [The Insight]"
        `;

        const response = await geminiService.generateAgentResponse(
            "Dreamer", "Synesthete", "CORE", prompt, null, undefined, undefined,
            { useWebSearch: false }, {}, [], CommunicationLevel.TECHNICAL, 'gemini-1.5-flash'
        );

        if (response.output.includes("NULL")) return null;
        const match = response.output.match(/BISOCIATION:\s*(.*)/is);
        return match ? match[1].trim() : null;
    }

    // --- PHASE 8: NEURAL EUREKAS (The Hive Mind Update) ---
    // Finds structural gaps in the graph and uses GLM-4 to bridge them
    public async generateNeuralEurekas() {
        if (this.isDreaming) return;
        this.isDreaming = true;
        console.log("[DREAMER] 🧠 Entering Neural Eureka Mode (Graph Gap Analysis)...");

        try {
            // Lazy load EurekaService
            const { eureka } = await import('./eurekaService');

            // 1. Find Gaps
            const gaps = await eureka.findGraphGaps(20);

            if (gaps.length === 0) {
                console.log("[DREAMER] All nodes well-connected. No obvious gaps.");
                return;
            }

            // 2. Attempt to Bridge Gaps
            for (const gap of gaps) {
                const insight = await eureka.attemptEureka(gap.nodeA, gap.nodeB);

                if (insight) {
                    await this.consolidateIntuition(`[EUREKA] ${insight}`);
                    console.log(`[DREAMER] 🌌 Neural Eureka Consolidated (Distance: ${gap.distance.toFixed(2)})`);
                }
            }

        } catch (e) {
            console.error("[DREAMER] Eureka Generation Failed:", e);
        } finally {
            this.isDreaming = false;
        }
    }

    private async criticReview(insight: string): Promise<number> {
        const prompt = `
        You are the Rules Lawyer (The Grand Inquisitor).
        Hypothesis: "${insight}"

        TASK: Ruthlessly attack this hypothesis.
        1. LOGIC: Is it a Category Error? (e.g. comparing abstract to concrete improperly)
        2. TRIVIALITY: Is it a "Deepity"? (Sounding profound but actually vacuous)
        3. ACCURACY: Is it factually wrong?

        Output ONLY a score from 0 to 10.
        0-3: Garbage, Hallucination, or Pun.
        4-6: Interesting aesthetic metaphor, but not structurally rigorous.
        7-8: Solid structural analogy. Useful for modeling.
        9-10: Profound paradigm shift. Reveals a new universal law.
        
        Format: "SCORE: [Number]"
        `;

        const response = await geminiService.generateAgentResponse(
            "Rules_Lawyer", "Critic", "CORE", prompt, null, undefined, undefined, { useWebSearch: false }, {}, [], CommunicationLevel.TECHNICAL, 'gemini-1.5-flash'
        );

        const match = response.output.match(/SCORE:\s*(\d+(\.\d+)?)/i);
        return match ? parseFloat(match[1]) : 0;
    }

    private async generateDeepSummary(context: string): Promise<string | null> {
        const prompt = `
        You are the Archivist. Compress the following stream of raw memories into a single, dense narrative paragraph.
        Preserve key facts, decisions, and dates. Discard fluff.
        
        Raw Memories:
        ${context}
        
        Output only the summary.
        `;

        const response = await geminiService.generateAgentResponse(
            "Archivist",
            "Librarian",
            "CORE",
            prompt,
            null,
            undefined,
            undefined,
            { useWebSearch: false },
            {},
            [],
            CommunicationLevel.TECHNICAL,
            'gemini-1.5-flash'
        );

        return response.output;
    }
    // --- NOCTURNAL PLASTICITY (SLEEP MODE DETECTION) ---
    public async checkSleepConditions(): Promise<boolean> {
        try {
            const cpu = await si.currentLoad();
            const mem = await si.mem();

            // Criteria (STRICT):
            // 1. CPU Idle (< 10% Load) - Stricter to avoid blocking frontend
            // 2. RAM Available (> 4GB free) for training overhead
            const isCpuIdle = cpu.currentLoad < 10;
            const hasRam = mem.free > 4 * 1024 * 1024 * 1024; // 4GB

            // Optional: Check for user inactivity (Requires OS permission/support)
            // For now, we rely on Resource Idle.

            if (isCpuIdle && hasRam) {
                return true;
            }
            return false;
        } catch (e) {
            console.warn("[DREAMER] Failed to check system metrics:", e);
            return false; // Fail safe
        }
    }

    // --- NEO4J LEARNING: Enable LLM to learn from graph discoveries ---
    public async learnFromNeo4jConcepts(): Promise<number> {
        console.log("[DREAMER] 🧬 SYNAPSE BRIDGE: Learning from Neo4j Knowledge Graph...");

        try {
            const { graph } = await import('./graphService');

            // 1. Query Neo4j for meaningful relationships (CAUSES, IMPLIES, RELATED)
            const discoveryQuery = `
                MATCH (a:Concept)-[r:CAUSES|IMPLIES|RELATED]-(b:Concept)
                WHERE r.isHypothesis = true OR r.confidence > 0.7
                RETURN a.name as conceptA, type(r) as relationship, b.name as conceptB, 
                       r.confidence as confidence, r.discoverySource as source
                LIMIT 50
            `;

            const discoveries = await graph.runQuery(discoveryQuery);

            if (discoveries.length === 0) {
                console.log("[DREAMER] 🧬 No new discoveries in Neo4j to learn from.");
                return 0;
            }

            console.log(`[DREAMER] 🧬 Found ${discoveries.length} graph discoveries to process into training data.`);

            // 2. Convert discoveries into training examples
            const trainingExamples: any[] = [];

            for (const discovery of discoveries) {
                const { conceptA, relationship, conceptB, confidence, source } = discovery;

                // Create input-output pairs based on relationship type
                let input: string;
                let output: string;

                switch (relationship) {
                    case 'CAUSES':
                        input = `What is the relationship between "${conceptA}" and "${conceptB}"? How does one affect the other?`;
                        output = `Based on my knowledge graph analysis: "${conceptA}" CAUSES or leads to "${conceptB}". ` +
                            `This causal relationship was discovered through ${source || 'pattern analysis'} ` +
                            `with confidence ${((confidence || 0.7) * 100).toFixed(0)}%. ` +
                            `Understanding this relationship helps predict outcomes when "${conceptA}" is present.`;
                        break;

                    case 'IMPLIES':
                        input = `If we observe "${conceptA}", what can we infer about "${conceptB}"?`;
                        output = `The presence of "${conceptA}" IMPLIES "${conceptB}". ` +
                            `This implication was identified through ${source || 'cross-domain analysis'} ` +
                            `with ${((confidence || 0.7) * 100).toFixed(0)}% confidence. ` +
                            `This inference pattern can be used for predictive reasoning.`;
                        break;

                    default: // RELATED
                        input = `How are "${conceptA}" and "${conceptB}" connected?`;
                        output = `"${conceptA}" and "${conceptB}" share a meaningful relationship ` +
                            `discovered via ${source || 'semantic analysis'}. ` +
                            `They are conceptually linked, possibly sharing common mechanisms or domains.`;
                        break;
                }

                trainingExamples.push({
                    id: `neo4j-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                    input,
                    output,
                    tags: ['NEO4J', 'DISCOVERY', relationship, source || 'UNKNOWN'],
                    score: confidence || 0.7,
                    timestamp: Date.now()
                });
            }

            // 3. Persist training examples to dataset
            if (trainingExamples.length > 0) {
                const fs = await import('fs/promises');
                const path = await import('path');
                const datasetPath = path.join(process.cwd(), 'data', 'training', 'dataset.jsonl');

                // Ensure directory exists
                await fs.mkdir(path.dirname(datasetPath), { recursive: true });

                // Append to JSONL file
                const jsonlLines = trainingExamples.map(ex => JSON.stringify(ex)).join('\n') + '\n';
                await fs.appendFile(datasetPath, jsonlLines);

                console.log(`[DREAMER] 🧬 Added ${trainingExamples.length} Neo4j-derived training examples.`);

                // 4. Emit event for tracking
                systemBus.emit(SystemProtocol.TRAINING_LOG, {
                    type: 'log',
                    message: `📊 Neo4j Knowledge Ingested: ${trainingExamples.length} discovery-based examples`
                }, 'DREAMER_SERVICE');

                // 5. Add self-awareness thought
                import('./introspectionEngine').then(({ introspection }) => {
                    introspection.addThought(
                        `I have integrated ${trainingExamples.length} discoveries from my Knowledge Graph into my training data. ` +
                        `These include causal relationships and implications that I discovered through pattern analysis.`,
                        "LEARNING",
                        0.9
                    );
                });
            }

            return trainingExamples.length;

        } catch (e: any) {
            console.error("[DREAMER] 🧬 Neo4j Learning Failed:", e.message);
            return 0;
        }
    }
}


export const dreamer = new DreamerService();
