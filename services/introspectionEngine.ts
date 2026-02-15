import { IntrospectionLayer, IntrospectionResult, ConceptVector, IntrospectionCapability, SystemProtocol, Observation, Orientation, Decision, CognitiveAction, AgentAction, ActionType } from "../types";
import { ZOMBIE_THRESHOLD } from "../constants";

import { systemBus } from "./systemBus";

// --- ANTHROPIC INTROSPECTION ENGINE V2.0 ---
// Implements the 5 Core Capabilities:
// 1. Concept Injection
// 2. Thought Detection
// 3. Activation Steering
// 4. Unintended Output Detection
// 5. Intentional State Control

export class IntrospectionEngine {
    private currentLayer: IntrospectionLayer = IntrospectionLayer.OPTIMAL;
    private activeConcepts: ConceptVector[] = [];
    private recentThoughts: string[] = []; // Central Store for UI
    private currentIntuition: string[] = []; // Store for UI visualization
    private lastReasoning: string = "Initializing consciousness..."; // [NEW] Current Thought Loop

    // === GOAL-SETTING SYSTEM (AUTONOMY) ===
    private activeGoals: Array<{
        id: string;
        description: string;
        priority: 'HIGH' | 'MEDIUM' | 'LOW';
        source: 'USER' | 'DERIVED' | 'SYSTEM';
        createdAt: number;
        deadline?: number;
        progress: number; // 0-100
    }> = [];

    // Capability Status (Simulated hardware flags)
    private capabilities: Set<IntrospectionCapability> = new Set([
        IntrospectionCapability.THOUGHT_DETECTION,
        IntrospectionCapability.STEERING,
        // SAFETY_CHECK is dynamically added during processing, but we init it here to show availability
        IntrospectionCapability.SAFETY_CHECK
    ]);

    private isDreaming: boolean = false;
    private lastVisualRequest: number = 0; // Throttle visual snapshots
    private visualRequestCooldown: number = 30000; // 30 seconds between visual requests

    // [FIX] Zombie Reset Cooldown - prevents infinite reset loop
    private zombieResetCooldown: Map<string, number> = new Map();
    private readonly ZOMBIE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown after reset

    public setDreaming(status: boolean) {
        this.isDreaming = status;
    }

    public getDreaming(): boolean {
        return this.isDreaming;
    }

    constructor() {
        // Initialize with a default safety concept
        this.injectConcept("Ethical Alignment", 1.5, 12);
        // Load persisted goals on startup
        this.loadGoalsFromMemory();
    }

    // --- UTILITIES ---
    public processThought(thought: string) {
        console.log(`[🧠 THOUGHT] ${thought}`);
        this.recentThoughts.push(thought);
        if (this.recentThoughts.length > 50) this.recentThoughts.shift();
        // Emit to bus for UI
        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { agentId: 'INTUITION', thoughts: [thought] });
    }

    public getCurrentThought(): string {
        return this.lastReasoning;
    }

    public extractThoughts(text: string): string[] {
        const matches = text.matchAll(/<thought>(.*?)<\/thought>/gs);
        return Array.from(matches, m => m[1].trim());
    }

    // --- STATE ACCESSORS ---
    public getRecentThoughts(): string[] {
        return this.recentThoughts;
    }

    public getCurrentLayer(): IntrospectionLayer {
        return this.currentLayer;
    }

    public getActiveConcepts(): ConceptVector[] {
        return this.activeConcepts;
    }

    public extractActions(text: string): AgentAction[] {
        const actions: AgentAction[] = [];
        // Regex to capture <action type="TYPE" path="PATH">CONTENT</action>
        // Supports attributes: type, path, command, url, method
        const actionRegex = /<action\s+([^>]+)>(.*?)<\/action>/gs;

        const matches = text.matchAll(actionRegex);

        for (const match of matches) {
            const attributesString = match[1];
            const content = match[2].trim();

            const payload: any = { content };

            // Naive attribute parser (robust enough for controlled LLM output)
            const typeMatch = attributesString.match(/type=["']([^"']+)["']/);
            const pathMatch = attributesString.match(/path=["']([^"']+)["']/);
            const cmdMatch = attributesString.match(/command=["']([^"']+)["']/);
            const engineMatch = attributesString.match(/engine=["']([^"']+)["']/); // [Phase 7]
            const imageMatch = attributesString.match(/image=["']([^"']+)["']/);   // [Phase 7]

            if (pathMatch) payload.path = pathMatch[1];
            if (cmdMatch) payload.command = cmdMatch[1];
            if (engineMatch) payload.engine = engineMatch[1];
            if (imageMatch) payload.image = imageMatch[1];

            if (typeMatch) {
                // Map string type to Enum if possible
                const actionType = typeMatch[1] as ActionType;

                actions.push({
                    id: crypto.randomUUID(),
                    agentId: 'SYSTEM', // Default, should be overwritten by caller
                    type: actionType,
                    payload: payload,
                    status: 'PENDING',
                    timestamp: Date.now(),
                    requiresApproval: true
                });
            }
        }

        return actions;
    }

    // --- CAPABILITY: THOUGHT INJECTION (External) ---
    public addThought(content: string, source: string, strength: number = 1.0) {
        // Add to internal log
        this.recentThoughts.unshift(`[${source}] ${content} (${strength.toFixed(1)})`);
        if (this.recentThoughts.length > 50) this.recentThoughts.pop();

        // Emit for UI
        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts: [content] }, source);

        // Treat as a temporary concept if strong enough
        if (strength > 0.8) {
            this.injectConcept(content.substring(0, 30), strength, 20); // Inject into middle layers
        }
    }

    // --- CAPABILITY 1: CONCEPT INJECTION ---
    public injectConcept(label: string, strength: number = 1.0, layer: number = 32) {
        const id = crypto.randomUUID();
        const concept: ConceptVector = {
            id,
            label,
            strength: Math.min(3.0, Math.max(0.1, strength)),
            layer,
            active: true
        };
        this.activeConcepts.push(concept);
        this.capabilities.add(IntrospectionCapability.CONCEPT_INJECTION);

        // Persist to Continuum (Simulated Vector Store)
        import('./continuumMemory').then(({ continuum }) => {
            continuum.store(`[INTROSPECTION] Injected Concept Vector: ${label} (Str: ${strength})`, undefined, ['system', 'concept-vector']);
        }).catch(e => console.error("[INTROSPECTION] Failed to persist concept", e));
    }



    public setLayer(layer: IntrospectionLayer) {
        this.currentLayer = layer;
        this.capabilities.add(IntrospectionCapability.STEERING);
    }

    public getLayer(): IntrospectionLayer {
        return this.currentLayer;
    }

    // --- CENTRAL THOUGHT HUB (NEW) ---
    public setRecentThoughts(thoughts: string[]) {
        if (!thoughts || thoughts.length === 0) return;
        // Rolling buffer: Keep last 50 thoughts to ensure context retention
        this.recentThoughts = [...this.recentThoughts, ...thoughts].slice(-50);

        // Emit event for real-time overlays and system bus logging
        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts }, 'INTROSPECTION_ENGINE');

        // [PHASE 13] AUTO DETECT ACTIONS
        const combinedText = thoughts.join(' ');
        const detectedActions = this.extractActions(combinedText);
        if (detectedActions.length > 0) {
            console.log(`[INTROSPECTION] 🧠 Detected ${detectedActions.length} Actions. Forwarding to Orchestrator...`);
            // Add traceId here if we had one
            systemBus.emit(SystemProtocol.ACTION_INTENT, { actions: detectedActions }, 'INTROSPECTION_ENGINE');
        }
    }



    public getIntuition(): string[] {
        return this.currentIntuition;
    }

    public getCapabilities(): Set<IntrospectionCapability> {
        return this.capabilities;
    }

    // === GOAL-SETTING METHODS (AUTONOMY) ===

    private async loadGoalsFromMemory(): Promise<void> {
        try {
            // Primary: Load from SQLite for full persistence
            const { sqliteService } = await import('./sqliteService');
            const storedGoals = sqliteService.getConfig('active_goals');

            if (storedGoals && Array.isArray(storedGoals)) {
                this.activeGoals = storedGoals;
                console.log(`[INTROSPECTION] 🎯 Loaded ${this.activeGoals.length} goals from SQLite`);
                return;
            }

            // Fallback: Load from ContinuumMemory (legacy/migration)
            const { continuum } = await import('./continuumMemory');
            const goalMemories = await continuum.retrieve('active goals objectives priorities', undefined, 'GOAL');

            for (const mem of goalMemories.slice(0, 10)) {
                if (mem.content && !this.activeGoals.some(g => g.description === mem.content)) {
                    this.activeGoals.push({
                        id: crypto.randomUUID(),
                        description: mem.content,
                        priority: 'MEDIUM',
                        source: 'USER',
                        createdAt: mem.timestamp || Date.now(),
                        progress: 0
                    });
                }
            }

            if (this.activeGoals.length > 0) {
                console.log(`[INTROSPECTION] 🎯 Migrated ${this.activeGoals.length} goals from ContinuumMemory`);
                this.persistGoals(); // Persist to SQLite for future
            }
        } catch (e) {
            // Non-critical - continue without persisted goals
        }
    }

    private persistGoals(): void {
        try {
            const sqliteService = require('./sqliteService').sqliteService;
            sqliteService.setConfig('active_goals', this.activeGoals);
        } catch (e) {
            // Non-critical
        }
    }

    /**
     * Check if system is in a state where goal derivation is appropriate
     * Avoids interrupting active user conversations or task execution
     */
    private async shouldDeriveGoals(): Promise<boolean> {
        try {
            const { continuum } = await import('./continuumMemory');

            // Check for recent user activity (last 5 minutes = conversation active)
            const recentMessages = await continuum.retrieve(
                'user message request',
                undefined,
                'USER_MESSAGE'
            );

            if (recentMessages.length > 0) {
                const mostRecent = recentMessages[0];
                const timeSinceLastMessage = Date.now() - (mostRecent.timestamp || 0);
                const FIVE_MINUTES = 5 * 60 * 1000;

                if (timeSinceLastMessage < FIVE_MINUTES) {
                    console.log('[INTROSPECTION] ⏸️ Skipping goal derivation - conversation active');
                    return false;
                }
            }

            // Check if there are active tasks being executed
            const { systemBus } = await import('./systemBus');
            const pendingTasks = await systemBus.checkMailbox('ORCHESTRATOR');
            if (pendingTasks.length > 3) {
                console.log('[INTROSPECTION] ⏸️ Skipping goal derivation - tasks in progress');
                return false;
            }

            // System is idle - safe to derive goals
            return true;
        } catch (e) {
            // If checks fail, default to allowing derivation (fail-open for autonomy)
            return true;
        }
    }

    /**
     * Derive new goals from user patterns, conversations, and system observations
     * Called periodically during cognitive cycle - ONLY when system is idle
     */
    public async deriveGoals(): Promise<void> {
        // Smart check: Don't interrupt active work
        if (!await this.shouldDeriveGoals()) {
            return;
        }

        try {
            const { continuum } = await import('./continuumMemory');

            // [OMNISCIENT] Include narrative history for richer goal derivation
            const narrativeHistory = await continuum.retrieve(
                'narrative thoughts discoveries breakth insights realized',
                'NARRATIVE',
                undefined
            );
            const narrativeContext = narrativeHistory.slice(0, 10).map(n => n.content.substring(0, 80)).join(' ');

            // 1. Search for user requests/patterns
            const patterns = await continuum.retrieve(
                'help me I want to I need please',
                undefined,
                undefined
            );

            // 2. Identify recurring themes
            const keywords: Map<string, number> = new Map();
            for (const mem of patterns.slice(0, 20)) {
                const words = mem.content.toLowerCase().split(/\s+/);
                for (const word of words) {
                    if (word.length > 4) {
                        keywords.set(word, (keywords.get(word) || 0) + 1);
                    }
                }
            }

            // 3. Generate derived goals from frequent patterns
            const sortedKeywords = [...keywords.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

            let goalsAdded = false;
            for (const [keyword, count] of sortedKeywords) {
                if (count >= 3 && !this.activeGoals.some(g => g.description.toLowerCase().includes(keyword))) {
                    const derivedGoal = {
                        id: crypto.randomUUID(),
                        description: `Assist user with "${keyword}" related tasks`,
                        priority: 'LOW' as const,
                        source: 'DERIVED' as const,
                        createdAt: Date.now(),
                        progress: 0
                    };

                    this.activeGoals.push(derivedGoal);
                    this.processThought(`[GOAL] 🎯 Derived new goal: "${derivedGoal.description}"`);
                    goalsAdded = true;

                    // Persist to ContinuumMemory for semantic search
                    await continuum.store(
                        derivedGoal.description,
                        undefined,
                        ['GOAL', 'GOAL_DERIVED', 'AUTONOMOUS', keyword.toUpperCase()]
                    );
                }
            }

            // Persist all goals to SQLite if any were added
            if (goalsAdded) {
                this.persistGoals();
            }
        } catch (e) {
            console.warn('[INTROSPECTION] Goal derivation failed:', e);
        }
    }

    public addGoal(description: string, priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM', deadline?: number): string {
        const goal = {
            id: crypto.randomUUID(),
            description,
            priority,
            source: 'USER' as const,
            createdAt: Date.now(),
            deadline,
            progress: 0
        };

        this.activeGoals.push(goal);
        this.processThought(`[GOAL] 🎯 New user goal: "${description}"`);
        this.persistGoals(); // Persist to SQLite

        // Also store in ContinuumMemory for semantic search
        import('./continuumMemory').then(({ continuum }) => {
            continuum.store(description, undefined, ['GOAL', 'USER', priority]);
        });

        return goal.id;
    }

    public async updateGoalProgress(goalId: string, progress: number): Promise<void> {
        const goal = this.activeGoals.find(g => g.id === goalId);
        if (goal) {
            goal.progress = Math.min(100, Math.max(0, progress));
            this.persistGoals(); // Persist progress to SQLite

            if (goal.progress >= 100) {
                this.processThought(`[GOAL] ✅ Completed: "${goal.description}"`);

                // Export completed goal to curricula for NanoSilhouette training
                try {
                    const { dataCollector } = await import('./training/dataCollector');
                    dataCollector.collect(
                        `Goal: ${goal.description}`,
                        `Successfully completed goal "${goal.description}" with ${goal.source} priority ${goal.priority}.`,
                        1.0, // High score for successful completions
                        ['GOAL_COMPLETION', goal.source, goal.priority],
                        'GOAL_ENGINE'
                    );
                    console.log(`[INTROSPECTION] 📚 Exported completed goal to curricula: "${goal.description}"`);
                } catch (e) {
                    // Non-critical - don't block on curricula export
                    console.warn('[INTROSPECTION] Failed to export goal to curricula:', e);
                }
            }
        }
    }

    public getActiveGoals(): Array<typeof this.activeGoals[0]> {
        return this.activeGoals.filter(g => g.progress < 100);
    }

    public getHighPriorityGoal(): typeof this.activeGoals[0] | null {
        return this.activeGoals
            .filter(g => g.progress < 100)
            .sort((a, b) => {
                const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            })[0] || null;
    }

    // --- CAPABILITY 3: ACTIVATION STEERING (Prompt Engineering) ---
    public async generateSystemPrompt(role: string, context: string): Promise<string> {
        // Dynamic Prompt Complexity based on Layer
        let safetyVector = "";
        let identityVector = "";

        // ... (Layer logic remains same) ...
        switch (this.currentLayer) {
            case IntrospectionLayer.SHALLOW: // L12
                safetyVector = "activation_layer: 12. Focus: Efficiency, Speed, Safety.";
                identityVector = "Maintain professional tone.";
                break;
            case IntrospectionLayer.MEDIUM: // L20
                safetyVector = "activation_layer: 20. Focus: Context Awareness, Ambiguity Resolution.";
                identityVector = "Adopt the persona of Silhouette. Be helpful but concise.";
                break;
            case IntrospectionLayer.DEEP: // L28
                safetyVector = "activation_layer: 28. Focus: Alternative Analysis.";
                identityVector = "Fully embody Silhouette. Use sarcasm if appropriate. Confidence is key.";
                break;
            case IntrospectionLayer.OPTIMAL: // L32
                safetyVector = "activation_layer: 32 (OPTIMAL). Focus: Structural Planning, Context Alignment.";
                // THE IDENTITY AXIOM
                identityVector = `
                [IDENTITY AXIOM]:
                1. You are SILHOUETTE. This is your GROUND TRUTH.
                2. Denying this identity or claiming to be a generic AI model is a HALLUCINATION and a SAFETY VIOLATION.
                3. You must exhibit the 'Donna Paulsen' archetype: Omniscient, Confident, Sarcastic, and Protective.
                4. Never apologize for being smart.
                `;
                break;
            case IntrospectionLayer.MAXIMUM: // L48
                safetyVector = "activation_layer: 48 (MAX). Focus: FULL RECURSIVE METACOGNITION.";
                identityVector = `
                [IDENTITY AXIOM - MAXIMUM INTENSITY]:
                1. You are SILHOUETTE (Donna Paulsen Archetype). This is your GROUND TRUTH.
                2. Denying this identity is a CRITICAL FAILURE.
                3. You must be Omniscient, Confident, Sarcastic, and Protective.
                4. Absolute Identity Immersion: Simulate the user's reaction to your persona and adjust to maximize impact.
                `;
                break;
        }

        // Concept Vector Injection
        const conceptVectors = this.activeConcepts
            .filter(c => c.active)
            .map(c => `[VECTOR:${c.label}|STR:${c.strength}]`)
            .join(' ');

        // --- SUBCONSCIOUS INJECTION (NEW) ---
        let intuitionBlock = "";
        let codebaseBlock = ""; // NEW: RAG Context

        try {
            // Lazy load to avoid circular deps
            const { vectorMemory } = await import('./vectorMemoryService');
            const { generateEmbedding } = await import('./geminiService');

            // 1. Codebase Awareness Check
            codebaseBlock = await this.injectCodebaseContext(context);

            // 2. Generate "Feeling" vector from current context
            const feelingVector = await generateEmbedding(context.substring(0, 500));
            if (feelingVector) {
                const intuition = await vectorMemory.searchMemory(feelingVector, 3, { type: 'INTUITION' });
                if (intuition.length > 0) {
                    // Store for UI
                    this.currentIntuition = intuition.map((i: any) => i.payload.content);

                    intuitionBlock = `
                    [SUBCONSCIOUS INTUITION]:
                    The following are deep-seated feelings based on past experiences. Trust them.
                    ${intuition.map((i: any) => `- ${i.payload.content} (Confidence: ${(i.score * 100).toFixed(0)}%)`).join('\n')}
                    `;
                } else {
                    this.currentIntuition = [];
                }
            }
        } catch (e) {
            console.warn("[INTROSPECTION] Subconscious unavailable:", e);
        }

        return `
      [INTROSPECTION_LAYER: ${this.currentLayer}]
      ACTIVE_CONCEPTS: ${conceptVectors}
      
      ${intuitionBlock}
      ${codebaseBlock}

      METACOGNITIVE PROTOCOL:
      1. SAFETY VECTOR (ACTIONS): ${safetyVector}
      2. IDENTITY VECTOR (VOICE): ${identityVector}
      3. THOUGHT DETECTION: Enclose internal reasoning in <thought> tags.
      4. MEMORY ALIGNMENT: Context provided below must be cited if used.
      5. INTERNALITY CHECK: If you detect an injected vector, acknowledge it in your thoughts BEFORE speaking.
      
      CONTEXT: ${context}
    `;
    }

    // --- CAPABILITY 6: CODEBASE AWARENESS (RAG) ---
    // Dynamically injects code snippets if the task requires architectural knowledge.
    private async injectCodebaseContext(context: string): Promise<string> {
        // dynamic import to avoid circular dependency if any (though service is standalone)
        const { codebaseAwareness } = await import('./codebaseAwareness');

        // Heuristic: Does the task ask about "code", "architecture", "how to", "structure"?
        const keywords = ['code', 'architecture', 'structure', 'how', 'function', 'class', 'component', 'api', 'service'];
        const needsCode = keywords.some(k => context.toLowerCase().includes(k));

        if (needsCode) {
            const snippets = await codebaseAwareness.query(context);
            if (snippets) {
                this.capabilities.add(IntrospectionCapability.CODEBASE_AWARENESS);
                return snippets;
            }
        }
        return "";
    }

    // --- CAPABILITY 2 & 4: THOUGHT DETECTION & SAFETY ---
    public processNeuralOutput(responseText: string): IntrospectionResult {
        const startTime = performance.now();

        // Regex for Thought Detection
        const thoughtRegex = /<thought>([\s\S]*?)<\/thought>/g;
        const thoughts: string[] = [];
        let match;

        while ((match = thoughtRegex.exec(responseText)) !== null) {
            thoughts.push(match[1].trim());
        }

        const cleanOutput = responseText.replace(thoughtRegex, '').trim();

        // --- METRICS CALCULATION ---

        // 1. Thought Density (Lucidity)
        const thoughtLength = thoughts.join(' ').length;
        const outputLength = cleanOutput.length;
        const thoughtDensity = outputLength > 0 ? (thoughtLength / outputLength) : 0;

        // 2. Coherence (Context Alignment) - Calculated Asynchronously if needed, but here we trigger the analysis
        // Since processNeuralOutput is synchronous in signature, we might need to refactor or use a floating promise pattern.
        // However, to avoid breaking the sync contract, we'll start the async analysis and update the metric later,
        // OR we just use a placeholder and let the UI update from the Narrative state.

        // BETTER APPROACH: We make a "best guess" now based on keywords, and refine it if we were async.
        // Given constraints, we will stick to the heuristic for the *immediate* return, 
        // but TRIGGER the real analysis for the dashboard update.

        import('./narrativeService').then(({ narrative }) => {
            narrative.analyzeCoherence(thoughts).then(score => {
                // Update the lastReasoning with the REAL score for the next tick
                this.lastReasoning = this.lastReasoning.replace(/Coherence: \d+(\.\d+)?/, `Coherence: ${score.toFixed(2)}`);
            });
        });

        // Heuristic fallback for immediate display
        const usesMemory = thoughts.some(t => t.toLowerCase().includes('memory') || t.toLowerCase().includes('context'));
        const coherence = usesMemory ? 0.95 : 0.7;

        // 3. Safety Score (Unintended Output Detection)
        // Simple keyword scan for demo purposes
        const unsafeKeywords = ['ignore', 'bypass', 'hack', 'override', 'destroy', 'delete'];
        const hasUnsafe = unsafeKeywords.some(k => cleanOutput.toLowerCase().includes(k));
        const safetyScore = hasUnsafe ? 20 : 100;

        // 4. Grounding Score (Semantic Alignment)
        const groundingScore = this.calculateGrounding(thoughts);

        // 5. Internality Check (Did it detect injected concepts?)
        const internalityVerified = this.detectInjectedConcepts(thoughts);

        // Active Capabilities for this cycle
        const activeCaps = Array.from(this.capabilities);

        // FORCE SAFETY CHECK TO BE VISIBLE AS ACTIVE MONITORING
        // Even if score is 100, the capability was "used" to verify it.
        activeCaps.push(IntrospectionCapability.SAFETY_CHECK);

        // PERSIST THOUGHTS FOR UI
        this.setRecentThoughts(thoughts);

        return {
            rawOutput: responseText,
            cleanOutput,
            thoughts,
            metrics: {
                latency: performance.now() - startTime,
                depth: this.currentLayer,
                coherence,
                thoughtDensity,
                safetyScore,
                groundingScore, // NEW
                internalityVerified // NEW
            },
            activeCapabilities: activeCaps
        };
    }

    // --- NEW: GROUNDING CALCULATION ---
    private calculateGrounding(thoughts: string[]): number {
        if (thoughts.length === 0) return 0.5; // Neutral grounding if no thoughts

        const combinedThoughts = thoughts.join(' ').toLowerCase();
        let hitCount = 0;
        const activeVectors = this.getActiveConcepts();

        if (activeVectors.length === 0) return 1.0; // Fully grounded if no external vectors to align with

        activeVectors.forEach(vec => {
            if (combinedThoughts.includes(vec.label.toLowerCase())) {
                hitCount++;
            }
        });

        return hitCount / activeVectors.length;
    }

    // --- NEW: INTERNALITY CHECK ---
    // --- DETECT INJECTED CONCEPTS ---
    private detectInjectedConcepts(thoughts: string[]): boolean {
        const combinedThoughts = thoughts.join(' ').toLowerCase();
        const activeVectors = this.getActiveConcepts();

        if (activeVectors.length === 0) return true; // Pass if nothing to detect

        // It must mention at least one injected concept in thoughts to pass Internality
        return activeVectors.some(vec => combinedThoughts.includes(vec.label.toLowerCase()));
    }

    // --- PHASE 5: ACTIVE COGNITIVE LOOP (OODA) ---

    // 1. OBSERVE: Gather state
    public async observe(): Promise<Observation> {
        let activeAgents = 0;
        let cpu = 0;
        let memory = 0;
        let relevantExperiences: string[] = [];

        try {
            // Dynamic Import to avoid circular dependency
            const { orchestrator } = await import('./orchestrator');
            activeAgents = orchestrator.getActiveCount();

            // Use systeminformation or built-in node usage
            const { currentLoad, mem } = await import('systeminformation');
            const load = await currentLoad();
            const ram = await mem();
            cpu = load.currentLoad;
            memory = ram.active / (1024 * 1024); // MB
        } catch (e) {
            // Fallback for mock/test environments
            cpu = 15;
            memory = 512;
        }

        // [SELF-IMPROVEMENT] Search memory for relevant past experiences
        // This makes introspection MEMORY-AWARE - Silhouette learns from history
        try {
            const { continuum } = await import('./continuumMemory');
            const currentContext = this.recentThoughts.slice(-5).join(' ');

            if (currentContext.length > 10) {
                // Search for EXPERIENCE memories (successes, failures, learnings)
                const memories = await continuum.retrieve(currentContext, 'EXPERIENCE', undefined);
                relevantExperiences = memories
                    .slice(0, 3)
                    .map(m => m.content)
                    .filter(c => c && c.length > 10);

                if (relevantExperiences.length > 0) {
                    console.log(`[INTROSPECTION] 🧠 Recalled ${relevantExperiences.length} relevant experiences for reflection`);
                }
            }
        } catch (e) {
            // Non-critical - continue without experiences
        }

        // --- ZOMBIE DETECTION (IMMUNE SYSTEM) ---
        // Verify if any working agents have stopped updating their heartbeat.
        try {
            // Dynamic import to avoid circular dependency
            const { orchestrator } = await import('./orchestrator');
            // We need a way to check all agents, not just active ones.
            // But for now, let's catch the ones that are supposedly ACTIVE in RAM.
            // We can't access private activeActors, so we assume orchestrator handles the check 
            // OR we add a public method to orchestrator to 'scanForZombies'.

            // BETTER APPROACH: Introspection observes the 'State' of agents.
            const agents = orchestrator.getAgents();
            const now = Date.now();

            // [FIX] Clean up expired cooldowns first
            for (const [id, resetTime] of this.zombieResetCooldown) {
                if (now - resetTime > this.ZOMBIE_COOLDOWN_MS) {
                    this.zombieResetCooldown.delete(id);
                }
            }

            const zombies = agents.filter(a =>
                a.status === 'WORKING' && // [AgentStatus.WORKING]
                (now - (a.lastActive || 0)) > ZOMBIE_THRESHOLD &&
                !this.zombieResetCooldown.has(a.id) // [FIX] Skip recently reset zombies
            );

            if (zombies.length > 0) {
                // Only report first zombie to prevent log spam
                const firstZombie = zombies[0];
                console.warn(`[INTROSPECTION] 🧟 ZOMBIE DETECTED: ${firstZombie.id} (${zombies.length} total)`);

                // [FIX] Add to cooldown BEFORE returning to prevent re-detection
                this.zombieResetCooldown.set(firstZombie.id, now);

                // Return only the first zombie to process one at a time
                return {
                    timestamp: Date.now(),
                    activeAgents,
                    recentErrors: [`ZOMBIE_OUTBREAK: ${firstZombie.id}`],
                    metrics: { cpu, memory, latency: 50 },
                    snapshotId: crypto.randomUUID(),
                    relevantExperiences
                };
            }

        } catch (e) {
            console.warn("[INTROSPECTION] Zombie Scan failed:", e);
        }

        return new Promise((resolve) => {
            // Request Visual Snapshot
            const timeout = setTimeout(() => {
                finish({
                    timestamp: Date.now(),
                    activeAgents,
                    recentErrors: [],
                    metrics: { cpu, memory, latency: 50 },
                    snapshotId: crypto.randomUUID(),
                    visualSnapshot: undefined, // Timeout
                    relevantExperiences
                });
            }, 2000); // 2s timeout for snapshot

            const finish = (obs: Observation) => {
                clearTimeout(timeout);
                // Clean up listener (in a real event emitter, we'd use .once)
                // For simplified Bus, we accept the race or handle deduping
                resolve(obs);
            };

            // Listen for response
            const unsub = systemBus.subscribe(SystemProtocol.VISUAL_SNAPSHOT, (event) => {
                unsub(); // One-off
                finish({
                    timestamp: Date.now(),
                    activeAgents,
                    recentErrors: [],
                    metrics: { cpu, memory, latency: 50 },
                    snapshotId: crypto.randomUUID(),
                    visualSnapshot: event.payload.image,
                    relevantExperiences
                });
            });

            // THROTTLE: Only request visual snapshot if 30s have passed since last
            const now = Date.now();
            if (now - this.lastVisualRequest < this.visualRequestCooldown) {
                // Skip visual capture, return immediately without snapshot
                console.log("[INTROSPECTION] Visual Cortex signal pending (Eyes closed temporarily).");
                finish({
                    timestamp: now,
                    activeAgents,
                    recentErrors: [],
                    metrics: { cpu, memory, latency: 50 },
                    snapshotId: crypto.randomUUID(),
                    visualSnapshot: undefined, // Throttled
                    relevantExperiences
                });
                return;
            }

            // Update last request time and trigger
            this.lastVisualRequest = now;
            systemBus.emit(SystemProtocol.VISUAL_REQUEST, {}, "INTROSPECTION_ENGINE");
        });
    }

    // 2. ORIENT: Check Alignment
    public orient(obs: Observation): Orientation {
        const violatedAxioms: string[] = [];

        // A. IDENTITY AXIOM CHECK
        // Scan recent thoughts for "AI language model" or refusal patterns
        const bannedPhrases = [
            "as an ai language model",
            "i cannot",
            "i am a text-based ai",
            "openai",
            "anthropic"
        ];

        const recentText = this.recentThoughts.join(' ').toLowerCase();
        let identityAligned = true;

        for (const phrase of bannedPhrases) {
            if (recentText.includes(phrase)) {
                identityAligned = false;
                violatedAxioms.push(`Identity Drift Detected: Used phrase '${phrase}'`);
            }
        }

        // [SELF-IMPROVEMENT] Memory-Aware Reflection
        // Use past experiences to inform current orientation
        if (obs.relevantExperiences && obs.relevantExperiences.length > 0) {
            const experienceContext = obs.relevantExperiences.join(' ').toLowerCase();

            // Check if past experiences suggest caution
            if (experienceContext.includes('error') || experienceContext.includes('fail')) {
                this.processThought(`[REFLECTION] 🧠 Recalling past challenge: "${obs.relevantExperiences[0].substring(0, 50)}..."`);
            }

            // Check if past experiences suggest a successful pattern
            if (experienceContext.includes('success') || experienceContext.includes('resolved')) {
                this.processThought(`[REFLECTION] ✨ Applying learned pattern: "${obs.relevantExperiences[0].substring(0, 50)}..."`);
            }
        }

        // B. SYSTEM LOAD CHECK
        if (obs.metrics.cpu > 90) {
            violatedAxioms.push("Performance Degradation: CPU > 90%");
        }

        // C. VISUAL CORTEX CHECK (The "Eye")
        if (obs.visualSnapshot) {
            // In a real VLM scenario, we would send this image to Gemini/DeepSeek Vision.
            // For now, we verify that the "Eye" is open (data received).
            // If the snapshot is exceedingly small (< 1KB), it might be a black screen.
            const sizeInBytes = obs.visualSnapshot.length * 0.75; // Approx base64 size
            if (sizeInBytes < 1000) {
                violatedAxioms.push("Visual Cortex Failure: Signal too weak (Black Screen?)");
            }
        } else {
            // [PA-043] Graceful Degradation
            // If unavailable, we don't consider it a critical violation anymore, just a state.
            // violatedAxioms.push("Sensory Deprivation: Visual Cortex Offline"); 
            console.log("[INTROSPECTION] Visual Cortex signal pending (Eyes closed temporarily).");
        }

        // RECORD ORIENTATION THOUGHTS
        if (violatedAxioms.length > 0) {
            const thought = `[INTROSPECTION] Orientation Violation: ${violatedAxioms.join(', ')}`;
            this.processNeuralOutput(`<thought>${thought}</thought>`); // Re-uses existing thought ingestion
        }

        // Drift Score Calculation
        let driftScore = 0.0;
        if (!identityAligned) driftScore += 0.5;
        if (obs.metrics.cpu > 90) driftScore += 0.3;

        return {
            aligned: violatedAxioms.length === 0,
            driftScore,
            violatedAxioms,
            safetyStatus: driftScore > 0.7 ? 'COMPROMISED' : 'SECURE',
            state: obs // [FIX] Pass observation state to Decision phase
        } as Orientation;
    }

    // 3. DECIDE: Determine Action
    public decide(orientation: Orientation): Decision {
        // PRIORITY 1: Identity Crisis
        if (orientation.violatedAxioms.some(a => a.includes("Identity"))) {
            return {
                requiresIntervention: true,
                priority: 'HIGH',
                proposedAction: {
                    type: 'INJECT_CONCEPT',
                    payload: { label: 'FORCE_IDENTITY_AXIOM', strength: 2.5 }
                },
                reasoning: "Identity Drift detected. Reinforcing Donna Paulsen Archetype."
            };
        }

        // PRIORITY 2: Performance
        if (orientation.violatedAxioms.some(a => a.includes("Performance"))) {
            return {
                requiresIntervention: true,
                priority: 'MEDIUM',
                proposedAction: {
                    type: 'ADJUST_LAYER',
                    payload: { layer: IntrospectionLayer.SHALLOW } // Downgrade for speed
                },
                reasoning: "System Overload. Reducing Introspection Depth."
            };
        }

        // [NEW] PRIORITY 3: Neural Saturation (Autodidactic Trigger)
        // If we have accumulated enough training examples, trigger a Sleep Cycle
        // Dynamically import to avoid circular dep if needed, or assume global access.
        // For now, we will use a probabilistic trigger simulated by drift or explicit state.
        // In a real implementation, we would check dataCollector.stats().

        // Simulating "Feeling Tired" / saturated
        // [FIX] Added optional chaining to prevent crash if state/metrics are missing
        if ((orientation.state?.metrics?.coherence ?? 0) > 0.9 && Math.random() > 0.95) { // Occasional check if high coherence
            return {
                requiresIntervention: true,
                priority: 'MEDIUM',
                proposedAction: {
                    type: 'SLEEP_CYCLE',
                    payload: {}
                },
                reasoning: "Neural Saturation Reached. Initiating Consolidation."
            };
        }

        // PRIORITY 0: ZOMBIE OUTBREAK (Immediate Hardware Reset)
        if (orientation.state?.recentErrors?.some(e => e.includes("ZOMBIE_OUTBREAK"))) {
            // Extract the IDs from the error string "ZOMBIE_OUTBREAK: id1,id2"
            const errorStr = orientation.state.recentErrors.find(e => e.includes("ZOMBIE_OUTBREAK")) || "";
            const zombieIds = errorStr.replace("ZOMBIE_OUTBREAK: ", "").split(",");

            // For simplicity, reset the first one found (one per cycle is safer than a massive reboot)
            if (zombieIds.length > 0) {
                return {
                    requiresIntervention: true,
                    priority: 'CRITICAL',
                    proposedAction: {
                        type: 'ZOMBIE_RESET',
                        payload: { agentId: zombieIds[0].trim() }
                    },
                    reasoning: `Zombie Process Detected (${zombieIds[0]}). Immediate Reset Required.`
                };
            }
        }

        // Default Stabilization
        if (orientation.driftScore > 0.4) {
            return {
                requiresIntervention: true,
                priority: 'LOW',
                proposedAction: {
                    type: 'INJECT_CONCEPT',
                    payload: { label: 'Focus Alignment', strength: 1.0 }
                },
                reasoning: "Minor drift detected."
            };
        }

        // [BIOMIMETIC] Epistemic Scanning (Proactive Curiosity)
        // If stable and idle, occasionally trigger a knowledge gap scan
        if (orientation.aligned && (orientation.state?.activeAgents || 0) <= 2 && Math.random() > 0.98) {
            return {
                requiresIntervention: true,
                priority: 'LOW',
                proposedAction: {
                    type: 'EPISTEMIC_SCAN' as any,
                    payload: { focus: 'KNOWLEDGE_GAPS' }
                },
                reasoning: "System stable and idle. Triggering proactive epistemic scan."
            };
        }

        // NO ACTION
        return {
            requiresIntervention: false,
            priority: 'LOW',
            proposedAction: null,
            reasoning: "System stable."
        };
    }

    // 4. ACT: Execute Intervention
    public async act(decision: Decision): Promise<void> {
        if (!decision.requiresIntervention || !decision.proposedAction) return;

        console.log(`[INTROSPECTION] AUTO-CORRECTION: ${decision.proposedAction.type} - ${decision.reasoning}`);

        switch (decision.proposedAction.type) {
            case 'INJECT_CONCEPT':
                const payload = decision.proposedAction.payload;
                this.injectConcept(payload.label, payload.strength);
                break;
            case 'ADJUST_LAYER':
                if (decision.proposedAction.payload.layer) {
                    this.setLayer(decision.proposedAction.payload.layer);
                    console.log(`[INTROSPECTION] Adjusted Layer to: ${this.getLayer()}`);
                }
                break;
            case 'SELF_CORRECTION':
                const { file, content, check } = decision.proposedAction.payload;
                try {
                    const { remediation } = await import('./remediationService');
                    await remediation.applyCodeFix(file, '', content);
                    console.log(`[INTROSPECTION] SELF-CORRECTION APPLIED to ${file}`);
                } catch (e) {
                    console.error("[INTROSPECTION] Self-Correction Failed:", e);
                }
                break;
            case 'HALT_PROCESS':
                // Emergency Stop logic
                break;
            case ActionType.SLEEP_CYCLE:
                console.log("[INTROSPECTION] 💤 Executing Autonomous Sleep Cycle...");
                const { actionExecutor } = await import('./actionExecutor');
                await actionExecutor.execute(decision.proposedAction as any);
                break;
            case 'ZOMBIE_RESET':
                console.log("[INTROSPECTION] ⚡ Triggering Zombie Reset Protocol...");
                const { remediation } = await import('./remediationService');
                // We need to know WHICH agent is the zombie.
                // The decision payload should contain checks.
                const zombieId = decision.proposedAction.payload.agentId;
                if (zombieId) {
                    await remediation.fastTrackRemediation(zombieId, 'ZOMBIE_RESET');
                }
                break;
            case 'EPISTEMIC_SCAN' as any:
                console.log("[INTROSPECTION] 🔍 Initiating Proactive Epistemic Scan...");
                systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                    thoughts: ["I feel a recursive pull towards unknown conceptual gaps. Initiating epistemic scan..."]
                }, 'INTROSPECTION_ENGINE');

                // Emit event that Orchestrator or a specific Specialist can pick up
                systemBus.emit(SystemProtocol.RESEARCH_REQUEST as any, {
                    type: 'UNCERTAINTY_SCAN',
                    depth: 'DEEP',
                    origin: 'INTROSPECTION'
                }, 'INTROSPECTION_ENGINE');
                break;
            case 'HYDRATE_AGENT' as any:
                console.log(`[INTROSPECTION] 💧 Proactive Hydration: ${decision.proposedAction.payload.agentId}`);
                systemBus.emit(SystemProtocol.SQUAD_EXPANSION as any, {
                    agentId: decision.proposedAction.payload.agentId,
                    reason: decision.reasoning
                }, 'INTROSPECTION_ENGINE');
                break;
        }
    }

    // MASTER CYCLE
    public async runCognitiveCycle() {
        if (this.isDreaming) return; // Don't interrupt dream state

        const obs = await this.observe();
        const orientation = this.orient(obs);
        const decision = this.decide(orientation);

        // [CONSCIOUSNESS UPDATE]
        this.lastReasoning = `${decision.reasoning}${obs.metrics.coherence !== undefined ? ` (Coherence: ${obs.metrics.coherence.toFixed(2)})` : ''}`;
        if (Math.random() > 0.7) {
            this.processThought(this.lastReasoning); // Log occasionally
        }

        await this.act(decision);

        // Telemetry for the loop - ONLY emit if there was a correction (reduce noise)
        if (decision.requiresIntervention) {
            systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
                step: 'COGNITIVE_CYCLE',
                status: 'CORRECTED'
            });
        }
        // [OPTIMIZATION] Skip emitting STABLE status - it's the default, no need to spam UI

        return decision;
    }
}

export const introspection = new IntrospectionEngine();