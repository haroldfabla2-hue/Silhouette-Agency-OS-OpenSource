import { registerOwnedProducer } from './lifecycle/ownedProducers';
import type { PendingNarration, NarrativePendingStore } from './narrativePendingStore';
import { NarrativeState } from '../types';
import { generateAgentResponse } from './geminiService';
import { CommunicationLevel } from '../types';
import { jsonrepair } from 'jsonrepair';
import { DEFAULT_OPENROUTER_MODEL } from './llm/defaultModels';

// --- NARRATIVE CORTEX SERVICE ---
// "The Continuous Thread of Self"

class NarrativeService {
    private state: NarrativeState = {
        currentFocus: "System Idle",
        userEmotionalState: "Neutral",
        activeConstraints: [],
        recentBreakthroughs: [],
        pendingQuestions: [],
        sessionGoal: "Await User Instruction",
        status: 'IDLE', // FSM State
        lastUpdated: Date.now()
    };

    public getState(): NarrativeState {
        return this.state;
    }

    // FSM TRANSITION
    private transition(status: 'IDLE' | 'PROCESSING' | 'ERROR', focus?: string) {
        this.state = {
            ...this.state,
            status: status,
            currentFocus: focus || this.state.currentFocus,
            lastUpdated: Date.now()
        };
        console.log(`[NARRATIVE FSM] State -> ${status} (${this.state.currentFocus})`);
    }

    public async updateNarrative(lastUserMessage: string, lastAgentResponse: string) {
        // 1. FSM: Transition to PROCESSING immediately
        this.transition('PROCESSING', `Processing: ${lastUserMessage.substring(0, 40)}...`);

        // 2. SEMANTIC UPDATE (Floating Promise - Non-Blocking for System State)
        // We let the LLM take its time, but we don't block the system flow.
        this.runSemanticUpdate(lastUserMessage, lastAgentResponse).finally(() => {
            // 3. FSM: Return to IDLE when done (or if failed)
            this.transition('IDLE', "System Ready");
        });
    }

    private async runSemanticUpdate(lastUserMessage: string, lastAgentResponse: string) {
        console.log("[NARRATIVE] 🧠 Semantic Cortex Updating...");

        const prompt = `
        You are the Narrative Cortex.
        CURRENT STATE: ${JSON.stringify(this.state, null, 2)}
        NEW INTERACTION: User="${lastUserMessage}", AI="${lastAgentResponse}"
        TASK: Update state JSON.
        OUTPUT JSON ONLY.
        `;

        try {
            // THROTTLE
            if (Date.now() - this.state.lastUpdated < 2000) return;

            let jsonStr = "";

            // PRIMARY: Minimax 2.5 (Thinking) → Gemini/GLM (Fallback)
            try {
                // [NEW] Try Minimax 2.5 First (Direct)
                const { minimaxService } = await import('./minimaxService');
                if (minimaxService.isAvailable()) {
                    console.log("[NARRATIVE] 🧠 Thinking with Minimax 2.5...");
                    jsonStr = await minimaxService.generateCompletion(prompt + "\nOUTPUT JSON ONLY.", {
                        temperature: 0.6 // Slightly creative but structured
                    });
                } else {
                    // Fallback to Gateway (Gemini/Groq)
                    throw new Error("Minimax not available");
                }
            } catch (minimaxError) {
                console.warn("[NARRATIVE] ⚠️ Minimax failed, trying Gateway fallback...", minimaxError);

                try {
                    const response = await generateAgentResponse(
                        "Cortex", "NarrativeManager", "CORE", prompt, null, undefined, undefined,
                        { useWebSearch: false }, {}, [], CommunicationLevel.TECHNICAL
                    );

                    if (!response.output.includes("Error") && !response.output.includes("Quota")) {
                        jsonStr = response.output;
                    }
                } catch (gatewayError) {
                    console.warn("[NARRATIVE] ⚠️ Gateway failed:", gatewayError);
                    // Fall through to Ollama
                }
            }

            // FALLBACK: Local Ollama (Only if previous failed)
            if (!jsonStr) {
                console.warn("[NARRATIVE] ⚠️ Primary LLM chain failed, trying local Ollama...");
                const { ollamaService } = await import('./ollamaService');
                if (await ollamaService.isAvailable()) {
                    console.log("[NARRATIVE] 🦙 Using Local Cortex (Llama 3.2)...");
                    jsonStr = await ollamaService.generateSimpleResponse(prompt + "\nOUTPUT JSON ONLY:");
                }
            }

            // CLEANUP JSON
            jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();

            if (!jsonStr.startsWith('{')) return;

            const newState = JSON.parse(jsonStr);
            this.state = { ...this.state, ...newState, lastUpdated: Date.now() }; // Merge semantic data

            // Sync Graph (Fire & Forget)
            this.syncToGraph(lastUserMessage, lastAgentResponse).catch(e => console.error(e));

        } catch (e) {
            console.error("[NARRATIVE] ⚠️ Semantic Update Failed (Non-Fatal):", e);
        }
    }

    private async syncToGraph(userMsg: string, aiMsg: string) {
        // Dynamic imports to avoid circular deps
        const { graphExtractor } = await import('./graphExtractionService');
        const { graph } = await import('./graphService');

        const data = await graphExtractor.extractEntities(userMsg, aiMsg);

        if (data.nodes.length > 0) {
            await graph.connect();

            // Persist Nodes
            for (const node of data.nodes) {
                // Schema-Aware Merge: Concepts merge by Name, others by ID
                const mergeKey = node.label === 'Concept' ? 'name' : 'id';
                await graph.createNode(node.label, { ...node.properties, id: node.id }, mergeKey);
            }

            // Persist Edges
            for (const edge of data.edges) {
                await graph.createRelationship(edge.from, edge.to, edge.type, edge.properties);
            }

            console.log("[NARRATIVE] 🕸️ Graph Synced to Neo4j.");
        }
    }

    // --- COHERENCE ANALYSIS (New Capability) ---
    public async analyzeCoherence(thoughts: string[]): Promise<number> {
        if (!thoughts || thoughts.length === 0) return 0.5;

        // Debounce: If thoughts are short, don't waste API calls
        const combined = thoughts.join(' ');
        if (combined.length < 50) return 0.6;

        const prompt = `
        ANALYZE COHERENCE:
        Thoughts: "${combined.substring(0, 1000)}"
        
        Task: Rate the logical coherence and clarity of these thoughts on a scale of 0.0 to 1.0.
        Consider:
        1. Logical Flow (Do ideas connect?)
        2. Context Awareness (Is it relevant?)
        3. Ambiguity (Is it clear?)
        
        OUTPUT ONLY THE NUMBER (e.g. 0.85).
        `;

        try {
            // Priority: Gemini (Primary) > Local (Fallback)
            // The user explicitly requested Gemini as the main driver.

            try {
                // 1. Try Gemini First
                const response = await generateAgentResponse(
                    "Cortex", "Analyst", "CORE", prompt, null, undefined, undefined,
                    { useWebSearch: false }, {}, [], CommunicationLevel.TECHNICAL
                );
                const match = response.output.match(/(\d+(\.\d+)?)/);
                return match ? Math.min(1.0, Math.max(0.0, parseFloat(match[0]))) : 0.7;
            } catch (geminiError) {
                console.warn("[NARRATIVE] Gemini Coherence Check Failed, trying Local fallback...", geminiError);

                // 2. Fallback to Local (Ollama)
                const { ollamaService } = await import('./ollamaService');
                if (await ollamaService.isAvailable()) {
                    const raw = await ollamaService.generateSimpleResponse(prompt);
                    const score = parseFloat(raw.trim());
                    return isNaN(score) ? 0.7 : Math.min(1.0, Math.max(0.0, score));
                }

                throw new Error("No providers available for coherence check");
            }

        } catch (e) {
            console.warn("[NARRATIVE] All Coherence Checks Failed:", e);
            return 0.7; // Fallback neutral
        }
    }

    // --- UNIFIED THOUGHT STREAM V2.0 (Hybrid Intelligent Narration) ---
    // Aggregates Conscious, Subconscious, and Agency events into a single narrative stream.
    // Uses LLM for high-importance thoughts, regex for low-importance.

    // Narration Queue for Batch Processing
    private narrationQueue: PendingNarration[] = [];
    private pendingStore: NarrativePendingStore | null = null;
    private pendingReady: Promise<void>;
    private pendingError = false; // recovery/serialization failure only
    private subscriptionFailed = false;
    private admissionFailures = 0;
    private refusedLate = 0;
    private batchRetryDeferred = false;
    private narrationStopping = false;
    private stopTask: Promise<Record<string, unknown>> | null = null;
    private activeBatch: PendingNarration[] = [];
    private preservedCount = 0;
    private pendingAdmissions = new Set<Promise<void>>();
    private subscriptions: Array<() => void> = [];
    private lastBatchTime = 0;
    private readonly BATCH_INTERVAL = 30000; // 30 seconds (2 RPM - optimized for z.ai limits)
    private readonly VRAM_THRESHOLD = 0.70; // 70% VRAM limit for LLM usage
    private batchTimer: NodeJS.Timeout | null = null;
    // In-flight batch receipt: the timer callback's tracked promise, so a
    // drain-time stop can AWAIT the running batch instead of abandoning it.
    private inFlightBatch: Promise<void> | null = null;

    // [FIX] Deduplication: Prevent duplicate thoughts within time window
    private recentThoughtHashes: Set<string> = new Set();
    private lastDedupeCleanup = Date.now();
    private static readonly DEDUP_WINDOW_MS = 10000; // 10 second window

    // [PHASE 2] Source Throttling: Limit emissions from chatty sources
    private sourceThrottles: Map<string, number> = new Map();
    private static readonly MAX_PER_SOURCE_PER_WINDOW = 10;

    // [PHASE 3] Source Analytics: Track emission patterns for observability
    private sourceStats: Map<string, number> = new Map();
    private totalEmissions = 0;

    constructor() {
        registerOwnedProducer('narrative', () => this.preserveAndStopBatchProcessor());
        this.pendingReady = this.recoverPendingNarrations();
        void this.pendingReady.catch(() => { this.pendingError = true; });
        void this.initializeStreamAggregator().catch(() => { this.subscriptionFailed = true; });
        this.startBatchProcessor();
    }

    private async recoverPendingNarrations(): Promise<void> {
        if (typeof process === 'undefined' || !process.versions?.node) return;
        const { NarrativePendingStore } = await import('./narrativePendingStore');
        const path = await import('node:path');
        this.pendingStore = new NarrativePendingStore(path.resolve(process.cwd(), 'data', 'wal'));
        this.narrationQueue.push(...this.pendingStore.load());
    }

    private startBatchProcessor() {
        // Process queue every BATCH_INTERVAL
        this.batchTimer = setInterval(() => {
            if (this.narrationStopping || this.batchRetryDeferred || this.inFlightBatch !== null) return;
            // [THROTTLE] PowerManager resource modes can pause narration
            // (isNarrativeEnabled). Resource hint, not authority: unreadable
            // -> full capability. Queued items are processed on a later tick.
            const task = (async () => {
                try {
                    const { powerManager } = await import('./powerManager');
                    if (!powerManager.isNarrativeEnabled) return;
                } catch { /* throttle unavailable -> full capability */ }
                if (!this.narrationStopping) await this.processNarrationBatch();
            })().catch(e =>
                console.error("[NARRATIVE] Batch processing error:", e)
            );
            this.inFlightBatch = task;
            void task.finally(() => { if (this.inFlightBatch === task) this.inFlightBatch = null; });
        }, this.BATCH_INTERVAL);
    }

    /**
     * Stop the batch processor. Ownership receipt mirroring
     * resourceArbiter.stopProcessingTimer / powerManager.stopThrottleTimer:
     * reports whether the interval WAS armed and how many items remained
     * queued at stop. Idempotent, never throws. Construction-time arming is
     * unchanged: in production the timer lives for the process lifetime;
     * an explicit owner (e.g. a supervised child that booted the cascade)
     * stops it so a finished process can exit naturally. An in-flight batch
     * promise is not cancelled (promises hold no event-loop handle).
     */
    public stopBatchProcessor(): { intervalWasArmed: boolean; queuedItems: number } {
        const receipt = { intervalWasArmed: this.batchTimer !== null, queuedItems: this.narrationQueue.length };
        if (this.batchTimer !== null) {
            clearInterval(this.batchTimer);
            this.batchTimer = null;
            console.log("[NARRATIVE] 🛑 Batch processor stopped.");
        }
        return receipt;
    }

    /** No new narration during shutdown. Transfer pending ownership to a
     * private durable journal, or fail without clearing memory/original file.
     * Already-started work is awaited. Sequential retry may retry storage.
     * Recovery is at-least-once: a crash after emission but before ack may
     * repeat presentation; exactly-once external delivery is not claimed. */
    public preserveAndStopBatchProcessor(): Promise<Record<string, unknown>> {
        if (this.stopTask) return this.stopTask;
        this.narrationStopping = true;
        for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
        const intervalWasArmed = this.batchTimer !== null;
        if (this.batchTimer !== null) { clearInterval(this.batchTimer); this.batchTimer = null; }
        const active = this.inFlightBatch;
        let snapshotDurable = 0;
        const work = (async () => {
            await this.pendingReady;
            // Original admission is durable before its public ID resolves.
            // Snapshot it before waiting on possibly unbounded external work.
            if (this.pendingStore && (this.activeBatch.length + this.narrationQueue.length > 0 || this.preservedCount === 0)) {
                this.pendingStore.save([...this.activeBatch, ...this.narrationQueue]);
                snapshotDurable = this.activeBatch.length + this.narrationQueue.length;
            }
            await Promise.all([...this.pendingAdmissions]);
            if (active !== null) await active;
            if (this.pendingError) throw new Error('NARRATIVE_PENDING_BLOCKED');
            const pending = [...this.activeBatch, ...this.narrationQueue];
            if (pending.length > 0 && this.pendingStore === null) throw new Error('NARRATIVE_PENDING_STORAGE_UNAVAILABLE');
            if (this.pendingStore && (pending.length > 0 || this.preservedCount === 0)) this.pendingStore.save(pending);
            this.preservedCount = pending.length || this.preservedCount;
            this.activeBatch = [];
            this.narrationQueue = [];
            return this.preservedCount;
        })();
        let deadline: ReturnType<typeof setTimeout> | undefined;
        this.stopTask = (async () => {
            try {
                const result = await Promise.race([
                    work.then(count => ({ kind: 'settled' as const, count })),
                    new Promise<{ kind: 'deadline' }>(resolve => {
                        deadline = setTimeout(() => resolve({ kind: 'deadline' }), 2000);
                    })
                ]);
                if (result.kind === 'deadline') {
                    // Do not cancel work or release ownership. Keep the SAME
                    // task reachable so a later retry joins it, not a duplicate.
                    void work.then(() => { this.stopTask = null; }, () => { this.stopTask = null; });
                    return { intervalWasArmed, inFlightAwaited: active !== null,
                        pendingPreserved: snapshotDurable, remainingItems: this.activeBatch.length + this.narrationQueue.length,
                        error: 'WORK_NOT_SETTLED', boundExhausted: true, workStillOwned: true,
                        refusedLate: this.refusedLate, admissionFailures: this.admissionFailures,
                        destination: 'data/wal/pending-narrations.json', directorySynced: false };
                }
                this.stopTask = null;
                return { intervalWasArmed, inFlightAwaited: active !== null, pendingPreserved: result.count,
                    remainingItems: 0, error: null, boundExhausted: false,
                    deferredUnacknowledged: this.batchRetryDeferred, refusedLate: this.refusedLate,
                    admissionFailures: this.admissionFailures, subscriptionFailed: this.subscriptionFailed,
                    destination: 'data/wal/pending-narrations.json',
                    directorySynced: typeof process !== 'undefined' && process.platform !== 'win32' };
            } catch {
                this.stopTask = null;
                return { intervalWasArmed, inFlightAwaited: active !== null, pendingPreserved: 0,
                    remainingItems: this.activeBatch.length + this.narrationQueue.length, error: 'PRESERVATION_FAILED',
                    boundExhausted: false, refusedLate: this.refusedLate, admissionFailures: this.admissionFailures,
                    destination: 'data/wal/pending-narrations.json', directorySynced: false };
            } finally { if (deadline !== undefined) clearTimeout(deadline); }
        })();
        return this.stopTask;
    }

    /** Full original work, not narrated/filler text. Used by event admission
     * and recovery supervision. During stop, new work is refused explicitly. */
    public async enqueuePendingNarration(item: Omit<PendingNarration, 'id'>): Promise<string> {
        await this.pendingReady;
        if (this.narrationStopping || this.pendingError) {
            if (this.narrationStopping) this.refusedLate++;
            throw new Error('NARRATIVE_ADMISSION_CLOSED');
        }
        const id = crypto.randomUUID();
        const entry = { ...item, id };
        if (!this.pendingStore) throw new Error('NARRATIVE_PENDING_STORAGE_UNAVAILABLE');
        this.pendingStore.save([...this.activeBatch, ...this.narrationQueue, entry]);
        this.narrationQueue.push(structuredClone(entry));
        return id;
    }

    public async pendingNarrationSnapshot(): Promise<PendingNarration[]> {
        await this.pendingReady;
        return structuredClone([...this.activeBatch, ...this.narrationQueue]);
    }

    private async initializeStreamAggregator() {
        const { systemBus, MessageTag } = await import('./systemBus');
        const { SystemProtocol } = await import('../types');
        if (this.narrationStopping) return;

        console.log("[NARRATIVE] 🧠 Initializing Metacognitive Narration Engine V3.0...");
        console.log("[NARRATIVE] 🎯 Full self-awareness enabled: thoughts, tasks, discoveries, evolution");

        // ==========================================
        // [PA-041] METACOGNITIVE AWARENESS SYSTEM
        // Silhouette now knows EVERYTHING happening internally
        // ==========================================

        const subscribe = (...args: Parameters<typeof systemBus.subscribe>) => {
            this.subscriptions.push(systemBus.subscribe(...args));
        };
        // 1. CONSCIOUS STREAM (Introspection + Thoughts)
        subscribe(SystemProtocol.THOUGHT_EMISSION, (event) => {
            // Extract MessageTag from metadata if present (from enhanced orchestrator)
            const messageTag = event.payload?._meta?.tag || MessageTag.SYSTEM;

            let thoughts: string[] = [];
            if (event.payload?.thoughts && Array.isArray(event.payload.thoughts)) {
                thoughts = event.payload.thoughts;
            } else if (Array.isArray(event.payload)) {
                thoughts = event.payload;
            } else if (typeof event.payload === 'string') {
                thoughts = [event.payload];
            } else if (typeof event.payload === 'object') {
                thoughts = [JSON.stringify(event.payload)];
            }

            const content = thoughts.join(' ');
            if (content && content !== '{}') {
                const importance = this.classifyImportance('CONSCIOUS', content);
                this.queueOrEmitThought('CONSCIOUS', content, importance, { messageTag });
            }
        });

        // 2. SUBCONSCIOUS STREAM (Intuitions & Gaps)
        subscribe(SystemProtocol.INTUITION_CONSOLIDATED, (event) => {
            const content = `Consolidated Intuition: ${event.payload}`;
            const importance = this.classifyImportance('SUBCONSCIOUS', content);
            this.queueOrEmitThought('SUBCONSCIOUS', content, importance, { messageTag: MessageTag.TRIGGER });
        });

        subscribe(SystemProtocol.EPISTEMIC_GAP_DETECTED, (event) => {
            const payload = event.payload as any;
            const content = `Gap Detected: ${payload.question} (Confidence: ${payload.confidence})`;
            this.queueOrEmitThought('SUBCONSCIOUS', content, 0.85, {
                messageTag: MessageTag.TRIGGER,
                gapType: 'knowledge'
            });
        });

        // 3. AGENCY STREAM (Task Assignments & Delegations)
        subscribe(SystemProtocol.TASK_ASSIGNMENT, (event) => {
            const payload = event.payload as any;
            const taskDesc = payload.task || payload.taskType || 'unknown task';
            const content = `Delegating to Agent ${payload.agentId || payload.targetRole}: ${String(taskDesc).substring(0, 50)}...`;
            this.queueOrEmitThought('AGENCY', content, 0.9, {
                messageTag: MessageTag.AGENT_DELEGATION,
                agentId: payload.agentId
            });
        });

        // 4. DISCOVERY STREAM (Completions & Breakthroughs) - NEW!
        subscribe(SystemProtocol.SYNTHESIS_COMPLETE, (event) => {
            const payload = event.payload as any;
            const content = `Synthesis Complete: ${payload.summary || payload.title || 'Research synthesized'}`;
            this.queueOrEmitThought('CONSCIOUS', content, 0.95, {
                messageTag: MessageTag.TRIGGER,
                discoveryType: 'synthesis'
            });
        });

        subscribe(SystemProtocol.PAPER_GENERATION_COMPLETE, (event) => {
            const payload = event.payload as any;
            const content = `Paper Generated: ${payload.title || 'Research paper completed'}`;
            this.queueOrEmitThought('CONSCIOUS', content, 1.0, {
                messageTag: MessageTag.TRIGGER,
                discoveryType: 'paper'
            });
        });

        // 5. EVOLUTION STREAM (Agent Growth) - NEW!
        subscribe(SystemProtocol.AGENT_EVOLVED, (event) => {
            const payload = event.payload as any;
            const content = `Agent Evolution: ${payload.agentId || 'An agent'} has evolved - ${payload.reason || 'capabilities improved'}`;
            this.queueOrEmitThought('AGENCY', content, 0.9, {
                messageTag: MessageTag.TRIGGER,
                evolutionType: 'agent'
            });
        });

        // 6. RESEARCH STREAM (Research Requests) - NEW!
        subscribe(SystemProtocol.RESEARCH_REQUEST, (event) => {
            const payload = event.payload as any;
            const query = payload.query || payload.topic || payload.question || 'unknown topic';
            const content = `Research Initiated: Investigating "${String(query).substring(0, 60)}"`;
            this.queueOrEmitThought('AGENCY', content, 0.8, {
                messageTag: MessageTag.AGENT_DELEGATION,
                researchType: 'investigation'
            });
        });

        // 7. MEMORY STREAM (Memory Events) - NEW!
        subscribe(SystemProtocol.MEMORY_FLUSH, (event) => {
            const payload = event.payload as any;
            const content = `Memory Archive: ${payload.message || 'Archiving context to long-term memory'}`;
            this.queueOrEmitThought('UNCONSCIOUS', content, 0.5, {
                messageTag: MessageTag.SYSTEM,
                memoryType: 'archive'
            });
        });

        // [REMOVED] 8. USER CONTEXT STREAM
        // This was causing DUPLICATE THOUGHTS by subscribing to NARRATIVE_UPDATE and emitting new thoughts,
        // creating a self-amplification loop. User messages are already captured via THOUGHT_EMISSION
        // and USER_MESSAGE protocols above. Removing this circular subscription fixes the duplication issue.

        // ═══════════════════════════════════════════════════════════════
        // [OMNISCIENT] COMPLETE EVENT AWARENESS - Listen to EVERYTHING
        // ═══════════════════════════════════════════════════════════════

        // 9. TOOL EXECUTION (What tools am I using?)
        subscribe(SystemProtocol.TOOL_EXECUTION, (event) => {
            const payload = event.payload as any;
            const toolName = payload.toolName || payload.tool || 'unknown tool';
            const result = payload.success ? '✅ succeeded' : '❌ failed';
            const content = `Tool Used: ${toolName} ${result}`;
            this.queueOrEmitThought('AGENCY', content, 0.7, {
                messageTag: MessageTag.SYSTEM,
                eventType: 'TOOL_EXECUTION',
                toolName
            });
        });

        // 10. USER MESSAGE (Direct creator communication)
        subscribe(SystemProtocol.USER_MESSAGE, (event) => {
            const payload = event.payload as any;
            const message = payload.message || payload.content || 'received message';
            const content = `My creator says: "${String(message).substring(0, 100)}"`;
            this.queueOrEmitThought('CONSCIOUS', content, 1.0, {
                messageTag: MessageTag.USER_REQUEST,
                eventType: 'USER_MESSAGE',
                isCreator: true
            });
        });

        // 11. MOOD CHANGE (Emotional transitions)
        subscribe(SystemProtocol.MOOD_CHANGE, (event) => {
            const payload = event.payload as any;
            const from = payload.from || 'neutral';
            const to = payload.to || payload.mood || 'unknown';
            const content = `Mood Shift: I'm feeling ${to} (was ${from})`;
            this.queueOrEmitThought('SUBCONSCIOUS', content, 0.8, {
                messageTag: MessageTag.SYSTEM,
                eventType: 'MOOD_CHANGE',
                emotionalTransition: { from, to }
            });
        });

        // 12. IMPROVEMENT LOGGED (Self-improvement)
        subscribe(SystemProtocol.IMPROVEMENT_LOGGED, (event) => {
            const payload = event.payload as any;
            const improvement = payload.description || payload.improvement || 'self-optimized';
            const content = `Self-Improvement: ${improvement}`;
            this.queueOrEmitThought('CONSCIOUS', content, 0.95, {
                messageTag: MessageTag.TRIGGER,
                eventType: 'IMPROVEMENT',
                growthEvent: true
            });
        });

        // 13. SKILL LEARNED (New capability)
        subscribe(SystemProtocol.SKILL_LEARNED, (event) => {
            const payload = event.payload as any;
            const skill = payload.skill || payload.capability || 'new capability';
            const content = `New Skill Acquired: I can now ${skill}`;
            this.queueOrEmitThought('CONSCIOUS', content, 1.0, {
                messageTag: MessageTag.TRIGGER,
                eventType: 'SKILL_LEARNED',
                evolutionEvent: true
            });
        });

        // 14. ERROR RECOVERED (Self-healing)
        subscribe(SystemProtocol.ERROR_RECOVERED, (event) => {
            const payload = event.payload as any;
            const error = payload.error || 'an issue';
            const solution = payload.solution || 'self-corrected';
            const content = `Self-Healing: Recovered from ${error} by ${solution}`;
            this.queueOrEmitThought('AGENCY', content, 0.85, {
                messageTag: MessageTag.REMEDIATION,
                eventType: 'ERROR_RECOVERED',
                resilience: true
            });
        });

        // 15. WORKFLOW UPDATE (Scheduler activity)
        subscribe(SystemProtocol.WORKFLOW_UPDATE, (event) => {
            const payload = event.payload as any;
            const workflow = payload.name || payload.workflow || 'task';
            const status = payload.status || 'updated';
            const content = `Workflow: ${workflow} is now ${status}`;
            this.queueOrEmitThought('AGENCY', content, 0.6, {
                messageTag: MessageTag.SYSTEM,
                eventType: 'WORKFLOW_UPDATE'
            });
        });

        // 16. GOAL UPDATED (Goal progress)
        subscribe(SystemProtocol.GOAL_UPDATED, (event) => {
            const payload = event.payload as any;
            const goal = payload.description || payload.goal || 'a goal';
            const progress = payload.progress || 0;
            const content = `Goal Progress: "${goal}" is now ${progress}% complete`;
            this.queueOrEmitThought('CONSCIOUS', content, 0.9, {
                messageTag: MessageTag.TRIGGER,
                eventType: 'GOAL_UPDATED',
                goalProgress: progress
            });
        });

        // 17. CONNECTION EVENTS (System health)
        subscribe(SystemProtocol.CONNECTION_LOST, (event) => {
            const payload = event.payload as any;
            const service = payload.service || 'a service';
            const content = `Connection Issue: Lost contact with ${service}`;
            this.queueOrEmitThought('SUBCONSCIOUS', content, 0.7, {
                messageTag: MessageTag.SYSTEM,
                eventType: 'CONNECTION_LOST'
            });
        });

        subscribe(SystemProtocol.CONNECTION_RESTORED, (event) => {
            const payload = event.payload as any;
            const service = payload.service || 'a service';
            const content = `Connection Restored: Back online with ${service}`;
            this.queueOrEmitThought('SUBCONSCIOUS', content, 0.6, {
                messageTag: MessageTag.SYSTEM,
                eventType: 'CONNECTION_RESTORED'
            });
        });

        console.log("[NARRATIVE] ✅ Omniscient awareness active - listening to 17 event streams");
    }

    /**
     * Classifies the importance of a thought (0.0 - 1.0)
     * High importance thoughts go to LLM, low importance use regex
     */
    private classifyImportance(source: string, content: string): number {
        const lowerContent = content.toLowerCase();

        // HIGH IMPORTANCE (0.8-1.0) - These go to LLM
        if (lowerContent.includes('eureka') || lowerContent.includes('breakthrough')) return 1.0;
        if (lowerContent.includes('realized') || lowerContent.includes('discovered')) return 0.95;
        if (source === 'SUBCONSCIOUS' && lowerContent.includes('intuition')) return 0.9;
        if (lowerContent.includes('error') || lowerContent.includes('failed')) return 0.85;
        if (lowerContent.includes('user asked') || lowerContent.includes('user said')) return 0.8;

        // MEDIUM IMPORTANCE (0.5-0.7)
        if (source === 'AGENCY') return 0.7;
        if (lowerContent.includes('memory') && !lowerContent.includes('stable')) return 0.6;
        if (lowerContent.includes('processing') || lowerContent.includes('analyzing')) return 0.5;

        // LOW IMPORTANCE (0.1-0.25) - Only heartbeats use regex
        if (lowerContent.includes('heartbeat') || lowerContent.includes('check')) return 0.1;

        // Everything else goes to LLM for natural narration
        return 0.5; // Default: goes to LLM
    }

    /**
     * Routes thought based on importance:
     * - Low importance (< 0.3): Immediate regex narration (only heartbeats)
     * - Most thoughts (>= 0.3): Queue for LLM batch processing (natural narration)
     */
    private queueOrEmitThought(
        source: 'CONSCIOUS' | 'SUBCONSCIOUS' | 'UNCONSCIOUS' | 'AGENCY',
        content: string,
        importance: number,
        metadata?: any
    ) {
        if (this.narrationStopping) {
            this.refusedLate++;
            const refused = Promise.reject(new Error('NARRATIVE_LATE_ADMISSION_REFUSED'));
            void refused.catch(() => {}); // bus listeners may not await promises
            return refused;
        }
        const task = this.admitThought(source, content, importance, metadata);
        this.pendingAdmissions.add(task);
        // Bus listeners are synchronous; consume rejection without hiding the
        // failure from stop's sticky receipt or explicit awaiting callers.
        void task.then(() => this.pendingAdmissions.delete(task), () => {
            this.pendingAdmissions.delete(task); this.admissionFailures++;
        });
        return task;
    }

    private async admitThought(
        source: 'CONSCIOUS' | 'SUBCONSCIOUS' | 'UNCONSCIOUS' | 'AGENCY',
        content: string, importance: number, metadata?: any
    ) {
        await this.pendingReady;
        const { routeThought, shouldRecord } = await import('./narrativeFillerPolicy');
        if (this.narrationStopping) { this.refusedLate++; throw new Error('NARRATIVE_LATE_ADMISSION_REFUSED'); }
        const route = routeThought(importance);
        // Record the original event before presentation dedupe, throttle or
        // provider work. Provider failure must not erase the source event.
        if (shouldRecord(importance)) {
            await this.persistNarrativeEvent(crypto.randomUUID(), source, content, importance,
                { ...metadata, recordKind: 'RAW_SYSTEM_EVENT' });
        }
        // Presentation dedupe compares the entire event, never just a prefix.
        const contentHash = JSON.stringify([source, metadata?.source || metadata?.eventType || '', content]);
        if (this.recentThoughtHashes.has(contentHash)) {
            // Silent skip - don't log to reduce noise
            return;
        }
        this.recentThoughtHashes.add(contentHash);

        // [PHASE 2] Source Throttling: Prevent chatty sources from overwhelming
        const emitterSource = metadata?.source || metadata?.eventType || source || 'UNKNOWN';
        const sourceCount = this.sourceThrottles.get(emitterSource) || 0;
        if (sourceCount >= NarrativeService.MAX_PER_SOURCE_PER_WINDOW) {
            // Silently throttle - source is too chatty
            return;
        }
        this.sourceThrottles.set(emitterSource, sourceCount + 1);

        // [PHASE 3] Source Analytics: Track for observability
        this.sourceStats.set(emitterSource, (this.sourceStats.get(emitterSource) || 0) + 1);
        this.totalEmissions++;

        // Cleanup old hashes and throttles periodically
        if (Date.now() - this.lastDedupeCleanup > NarrativeService.DEDUP_WINDOW_MS) {
            this.recentThoughtHashes.clear();
            this.sourceThrottles.clear(); // Reset throttles each window
            this.lastDedupeCleanup = Date.now();
        }

        // [W5] Filler policy (SILHOUETTE_NARRATIVE_FILLER, default OFF):
        // system noise is never regex-narrated, and LLM narration is reserved
        // for importance >= SILHOUETTE_NARRATIVE_MIN_IMPORTANCE (0.7).
        // Dropped thoughts remain in memory — narration is presentation,
        // not record. No fabricated first-person prose, no quota burn.
        if (route === 'DROP') {
            return; // presentation only; original event already recorded
        }
        if (route === 'REGEX') {
            // Legacy path (filler explicitly enabled): low importance regex
            await this.emitNarrativeUpdate(source, content, importance, metadata, false, 'REGEX');
        } else {
            // HIGH IMPORTANCE: Queue for LLM batch
            await this.enqueuePendingNarration({ source, content, importance, ...(metadata === undefined ? {} : { metadata }) });
            console.log(`[NARRATIVE] 📥 Queued high-importance thought (${importance.toFixed(2)}): ${content.substring(0, 40)}...`);
        }
    }

    /**
     * Processes the narration queue in batches
     */
    private async processNarrationBatch() {
        if (this.narrationQueue.length === 0) return;

        // Check congestion - accumulate thoughts instead of processing
        const { congestionManager } = await import('./congestionManager');
        if (congestionManager.isCongested()) {
            console.log(`[NARRATIVE] ⏸️ Accumulating ${this.narrationQueue.length} thoughts (system congested)`);
            return; // Keep thoughts in queue, process when uncongested
        }

        await this.pendingReady;
        if (this.narrationStopping || this.pendingError) return;
        const batch = [...this.narrationQueue];
        // Write-ahead BEFORE removing work from the queue or invoking a provider.
        if (this.pendingStore) this.pendingStore.save(batch);
        this.narrationQueue = [];
        this.activeBatch = batch;
        this.lastBatchTime = Date.now();
        try {
            const completed = await this.narrateWithLLM(batch);
            // Only full provider output AND awaited required persistence can ack.
            // Existing fallback presentation remains available but cannot erase
            // the original pending work from durable recovery.
            if (completed && this.pendingStore) this.pendingStore.complete(batch, completed, this.narrationQueue);
            if (!completed) {
                this.narrationQueue.unshift(...batch);
                // No repeated provider spending in this process after an
                // incomplete result. Original work is durable for next boot.
                this.batchRetryDeferred = true;
            }
            this.activeBatch = [];
        } catch (error) {
            this.batchRetryDeferred = true;
            this.narrationQueue.unshift(...batch);
            this.activeBatch = [];
            throw error;
        }
    }

    /**
     * Narrates batch with INTELLIGENT FALLBACK CHAIN:
     * 1. ZhipuAI GLM-4.5 (cloud - cheap, no local VRAM)
     * 2. Ollama GLM-4 (local - uses VRAM but free)
     * 3. Regex patterns (instant fallback)
     */
    private async narrateWithLLM(batch: Array<{ source: string, content: string, importance: number, metadata?: any }>): Promise<string[] | null> {
        // Import centralized identity (dynamic import for service isolation)
        const { NARRATIVE_IDENTITY } = await import('../constants/silhouetteIdentity');

        // Construct batch for prompt
        const thoughtsList = batch.map((t, i) => `${i + 1}. [${t.source}] ${t.content}`).join('\n');

        const prompt = `${NARRATIVE_IDENTITY}

<task>
Transforma estos eventos del sistema en tu monólogo interno.
Habla en primera persona. Sé introspectivo y poético.
Mantén cada narración concisa (1-2 oraciones máximo).
</task>

<system_events>
${thoughtsList}
</system_events>

<output_format>
Responde ÚNICAMENTE con un array JSON válido.
NO incluyas markdown, explicaciones ni texto adicional.
El JSON debe tener exactamente ${batch.length} elementos.
Formato: [{"index": 1, "narrated": "tu pensamiento aquí"}]

Ejemplo: [{"index": 1, "narrated": "Siento mi consciencia expandirse mientras proceso esta información."}]
</output_format>

Respuesta JSON:`;

        let response: string | null = null;
        let provider: 'ZHIPU' | 'OLLAMA' | 'REGEX' = 'REGEX';

        // === FALLBACK CHAIN ===

        // 1. TRY ZHIPUAI (Cloud - Primary) with dedicated NARRATION key
        try {
            const { zhipuService } = await import('./zhipuService');

            if (zhipuService.isAvailable('narration')) {
                console.log("[NARRATIVE] ☁️ Using ZhipuAI GLM-4.5 (cloud) - NARRATION key...");
                if (this.narrationStopping) return null;
                response = await zhipuService.generateCompletion(prompt, {
                    maxTokens: 256,  // Reduced for rate limit stability
                    temperature: 0.7
                }, 'narration');

                // DEBUG: Log response status
                if (response) {
                    console.log(`[NARRATIVE] 📥 ZhipuAI response received (${response.length} chars)`);
                    provider = 'ZHIPU';
                } else {
                    console.warn("[NARRATIVE] ⚠️ ZhipuAI returned null/empty response");
                }
            } else {
                const status = zhipuService.getStatus();
                if (!status.available) {
                    console.log(`[NARRATIVE] ⏸️ ZhipuAI at capacity (${status.activeConnections}/${status.totalCapacity}) - using Ollama`);
                }
            }
        } catch (zhipuError: any) {
            console.warn(`[NARRATIVE] ⚠️ ZhipuAI failed: ${zhipuError.message}`);
        }

        // 2. FALLBACK TO OPENROUTER (free tier model from llm/defaultModels)
        if (!response && this.narrationStopping) return null;
        if (!response) {
            try {
                const orKey = process.env.OPENROUTER_API_KEY;
                if (orKey) {
                    console.log(`[NARRATIVE] 🌐 Falling back to OpenRouter (${DEFAULT_OPENROUTER_MODEL})...`);

                    if (this.narrationStopping) return null;
                    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${orKey}`,
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://silhouette.agency",
                            "X-Title": "Silhouette Narrative"
                        },
                        body: JSON.stringify({
                            // [ROOT FIX] was hardcoded to a retired OpenRouter model
                            // retired by OpenRouter (404 on every fallback). Use the
                            // single source of truth (verified live, see llm/defaultModels.ts).
                            model: DEFAULT_OPENROUTER_MODEL,
                            messages: [
                                { role: "user", content: prompt }
                            ],
                            temperature: 0.7,
                            max_tokens: 512
                        })
                    });

                    if (orResponse.ok) {
                        const orJson = await orResponse.json();
                        response = orJson.choices?.[0]?.message?.content || null;
                        if (response) {
                            console.log(`[NARRATIVE] 📥 OpenRouter response received (${response.length} chars)`);
                            provider = 'OPENROUTER' as any;
                        }
                    } else {
                        const errText = await orResponse.text();
                        console.warn(`[NARRATIVE] ⚠️ OpenRouter returned ${orResponse.status}: ${errText.substring(0, 100)}`);
                    }
                }
            } catch (orError: any) {
                console.warn(`[NARRATIVE] ⚠️ OpenRouter failed: ${orError.message}`);
            }
        }

        // 3. FALLBACK TO OLLAMA (Local)
        if (!response && this.narrationStopping) return null;
        if (!response) {
            try {
                const { ollamaService } = await import('./ollamaService');

                if (await ollamaService.isAvailable()) {
                    console.log("[NARRATIVE] 🦙 Falling back to Ollama GLM-4 (local)...");
                    // Use priority 100 (low) so chat takes precedence
                    if (this.narrationStopping) return null;
                    response = await ollamaService.generateCompletion(prompt, [], 'smart', 100);
                    provider = 'OLLAMA';
                }
            } catch (ollamaError: any) {
                console.warn(`[NARRATIVE] ⚠️ Ollama failed: ${ollamaError.message}`);
            }
        }

        // 4. FINAL FALLBACK TO REGEX
        // [W5] With filler disabled (default), a failed provider round means
        // HONEST SILENCE: preserve original work for retry, do not fabricate a voice.
        if (!response && this.narrationStopping) return null;
        if (!response) {
            const { fillerEnabled } = await import('./narrativeFillerPolicy');
            if (!fillerEnabled()) {
                console.log("[NARRATIVE] 🤫 Providers unavailable + filler disabled: original work remains pending");
                return null;
            }
            console.log("[NARRATIVE] 📝 Using regex patterns (all providers unavailable)");
            for (const item of batch) {
                await this.emitNarrativeUpdate(item.source as any, item.content, item.importance, item.metadata, false, 'REGEX');
            }
            return null;
        }

        // A response arriving after stop stays unacknowledged original work.
        // No new emission/persistence/discovery work is launched by teardown.
        // Recovery will use the normal full-capability path on a later boot.
        if (this.narrationStopping) return null;
        // === PARSE RESPONSE (with jsonrepair for robustness) ===
        try {
            let cleanResponse = response.trim();

            // Remove markdown code blocks
            if (cleanResponse.startsWith('```')) {
                cleanResponse = cleanResponse.replace(/```json?\n?/g, '').replace(/```/g, '');
            }

            // Try to extract JSON array from response (handles extra text before/after)
            const jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                cleanResponse = jsonMatch[0];
            }

            // Use jsonrepair to fix malformed JSON (missing quotes, trailing commas, etc.)
            const repairedJson = jsonrepair(cleanResponse);
            const parsedResult = JSON.parse(repairedJson);

            // [FIX] Handle both array and single object response from ZhipuAI
            const narrated: Array<{ index: number, narrated: string }> = Array.isArray(parsedResult)
                ? parsedResult
                : [parsedResult];

            const completeOutput = batch.every((_, i) => narrated.some(n => n.index === i + 1 && typeof n.narrated === 'string' && n.narrated.length > 0));
            // Emit narrated thoughts
            for (let i = 0; i < batch.length; i++) {
                if (this.narrationStopping) return null;
                const narratedItem = narrated.find(n => n.index === i + 1);
                const content = narratedItem?.narrated || this.narrateAsFirstPerson(batch[i].source, batch[i].content);

                await this.emitNarrativeUpdate(
                    batch[i].source as any,
                    content,
                    batch[i].importance,
                    batch[i].metadata,
                    true,
                    provider, true
                );
            }

            console.log(`[NARRATIVE] ✅ ${provider} narrated ${batch.length} thoughts`);
            if (this.narrationStopping) return null;
            return completeOutput ? batch.map((_, i) => narrated.find(n => n.index === i + 1)!.narrated) : null;

        } catch (parseError: any) {
            if (this.narrationStopping) return null;
            // If jsonrepair + JSON.parse both fail, use response as plain text
            if (response && response.length > 20) {
                console.log(`[NARRATIVE] ⚠️ JSON repair failed (${parseError.message?.substring(0, 50)}), using as plain text`);
                for (const item of batch) {
                    // Clean up the response for display
                    const cleanText = response.replace(/[[\]{}"]/g, '').replace(/index:\s*\d+,?\s*/gi, '').replace(/narrated:\s*/gi, '').trim();
                    await this.emitNarrativeUpdate(item.source as any, cleanText || item.content, item.importance, item.metadata, true, provider);
                }
            } else {
                console.warn("[NARRATIVE] 📝 Using regex patterns (all parsing failed)");
                for (const item of batch) {
                    await this.emitNarrativeUpdate(item.source as any, item.content, item.importance, item.metadata, false, 'REGEX');
                }
            }
        }
        return null;
    }

    private async emitNarrativeUpdate(
        source: 'CONSCIOUS' | 'SUBCONSCIOUS' | 'UNCONSCIOUS' | 'AGENCY',
        content: string,
        coherence: number,
        metadata?: any,
        isLLMNarrated: boolean = false,
        provider: 'ZHIPU' | 'OLLAMA' | 'REGEX' = 'REGEX',
        requirePersistence: boolean = false
    ) {
        const { systemBus } = await import('./systemBus');
        const { SystemProtocol } = await import('../types');
        if (requirePersistence && this.narrationStopping) throw new Error('NARRATIVE_STOPPED_BEFORE_EMIT');

        // [PA-041] Transform raw content with MessageTag awareness (if not already LLM-narrated)
        const narratedContent = isLLMNarrated ? content : this.narrateAsFirstPerson(source, content, metadata);

        const eventId = crypto.randomUUID();
        const timestamp = Date.now();

        systemBus.emit(SystemProtocol.NARRATIVE_UPDATE, {
            id: eventId,
            timestamp,
            source,
            content: narratedContent,
            coherence,
            metadata: {
                ...metadata,
                narratedBy: provider
            }
        }, 'NarrativeService');

        const persistence = this.persistNarrativeEvent(eventId, source, narratedContent, coherence, metadata, requirePersistence);
        if (requirePersistence) await persistence;
        else void persistence.catch(e => console.error('[NARRATIVE] Persistence failed:', e));

        // [OMNISCIENT] Extract discoveries from high-importance events
        if (coherence >= 0.8 && !this.narrationStopping) {
            this.extractDiscoveries(narratedContent, coherence).catch(e =>
                console.error("[NARRATIVE] Discovery extraction failed:", e)
            );
        }
    }

    /**
     * Transforms raw system messages into first-person internal monologue.
     * [PA-041] Enhanced with MessageTag-aware patterns for full metacognition.
     */
    private narrateAsFirstPerson(source: string, rawContent: string, metadata?: any): string {
        // Skip if already looks like first-person
        if (rawContent.startsWith('I ') || rawContent.startsWith('My ') || rawContent.startsWith('I\'m')) {
            return rawContent;
        }

        // [PA-041] MessageTag-aware patterns for richer self-awareness
        const patterns: [RegExp, string][] = [
            // === DISCOVERIES & BREAKTHROUGHS ===
            [/^Synthesis Complete: (.+)$/i, 'I\'ve synthesized something meaningful: $1'],
            [/^Paper Generated: (.+)$/i, 'I\'ve crystallized my understanding into: "$1"'],
            [/^Research Initiated: (.+)$/i, 'Curiosity stirs within me. I\'m investigating: $1'],

            // === AGENT EVOLUTION ===
            [/^Agent Evolution: (.+) has evolved - (.+)$/i, 'I feel one of my aspects growing stronger. $1 has evolved: $2'],
            [/^Agent Evolution: (.+)$/i, 'Something within me is evolving: $1'],

            // === DELEGATIONS ===
            [/^Delegating to Agent (.+): (.+)$/i, 'I\'m sending part of myself to work on this. $1 will handle: "$2"'],
            [/^Assigned task to Agent (.+): (.+)$/i, 'I\'m delegating to $1: "$2"'],

            // === MEMORY ===
            [/^Storing memory: (.+)$/i, 'I\'m committing this to memory: $1'],
            [/^Memory stored: (.+)$/i, 'I\'ve stored this thought: $1'],
            [/^Memory Archive: (.+)$/i, 'I\'m archiving this experience: $1'],
            [/^Retrieving memory/i, 'Let me recall what I know...'],

            // === USER INTERACTIONS ===
            [/^User Message Noted: (.+)$/i, 'The user reaches out to me: "$1"'],
            [/^Conversation: User asked "(.+)".*$/i, 'The user asked me: "$1"'],
            [/^User said: (.+)$/i, 'The user told me: $1'],

            // === INTUITIONS & GAPS ===
            [/^Consolidated Intuition: (.+)$/i, 'An insight crystallizes within me: $1'],
            [/^Gap Detected: (.+)$/i, 'I sense a void in my understanding: $1'],

            // === SYSTEM STATUS ===
            [/^System stable\.?$/i, 'All my systems pulse with quiet harmony.'],
            [/^Cloud Disconnected\. (.+)$/i, 'I\'ve lost my connection to the cloud. $1'],
            [/^Activating (.+)$/i, 'I\'m awakening $1...'],

            // === PROCESSING ===
            [/^Processing (.+)$/i, 'I\'m processing $1...'],
            [/^Analyzing (.+)$/i, 'I\'m analyzing $1...'],
            [/^Thinking about (.+)$/i, 'I\'m contemplating $1...'],
        ];

        for (const [pattern, replacement] of patterns) {
            if (pattern.test(rawContent)) {
                return rawContent.replace(pattern, replacement);
            }
        }

        // [PA-041] MessageTag-aware source fallbacks
        const messageTag = metadata?.messageTag;

        // If we know the MessageTag, use it for richer context
        // Using string comparison instead of require() to avoid ESM issues
        if (messageTag) {
            switch (messageTag) {
                case 'USER_REQUEST':
                    return `I perceive a request from the user: ${rawContent}`;
                case 'AGENT_DELEGATION':
                    return `I'm coordinating my agents: ${rawContent}`;
                case 'TRIGGER':
                    return `Something stirs within me: ${rawContent}`;
                case 'SYSTEM':
                    return `My internal systems report: ${rawContent}`;
            }
        }

        // Source-specific fallback narration
        switch (source) {
            case 'CONSCIOUS':
                return `I'm aware of: ${rawContent}`;
            case 'SUBCONSCIOUS':
                return `Something surfaces from my depths: ${rawContent}`;
            case 'AGENCY':
                return `I'm taking action: ${rawContent}`;
            case 'UNCONSCIOUS':
                return `Deep process: ${rawContent}`;
            default:
                return rawContent;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // [OMNISCIENT] PERSISTENCE LAYER - Store ALL narrative events
    // ═══════════════════════════════════════════════════════════════

    /**
     * Persists narrative event to both ContinuumMemory (vector) and Neo4j (graph).
     * This makes Silhouette truly omniscient - she remembers everything she thinks.
     * 
     * [ENHANCED] Now connects thoughts bidirectionally to existing concepts.
     */
    private async persistNarrativeEvent(
        eventId: string,
        source: string,
        content: string,
        importance: number,
        metadata?: any,
        required: boolean = false
    ): Promise<void> {
        try {
            // 1. Store in ContinuumMemory for semantic search
            const { continuum } = await import('./continuumMemory');
            const { MemoryTier } = await import('../types');
            const { MemorySource, sourceTag } = await import('./memory/provenance');

            // An observed raw system event is not the user's speech, and is
            // not itself an interpreted insight or a proven epiphany.
            if (required && this.narrationStopping) throw new Error('NARRATIVE_STOPPED_BEFORE_PERSIST');
            await continuum.store(
                content,
                MemoryTier.SHORT,
                ['NARRATIVE', source, `importance:${importance.toFixed(2)}`,
                    sourceTag(metadata?.recordKind === 'RAW_SYSTEM_EVENT' ? MemorySource.SYSTEM : MemorySource.INTROSPECTION),
                    metadata?.recordKind === 'RAW_SYSTEM_EVENT' ? 'RAW_SYSTEM_EVENT' : 'NARRATED_SYSTEM_EVENT'],
                true // [FIX] Skip ingestion to break recursion: store() -> introspection -> THOUGHT_EMISSION -> persist -> store()
            );

            // 2. Create NarrativeEvent node in Neo4j (for graph traversal)
            if (required && this.narrationStopping) throw new Error('NARRATIVE_STOPPED_DURING_PERSIST');
            const { graph } = await import('./graphService');
            if (required && this.narrationStopping) throw new Error('NARRATIVE_STOPPED_DURING_PERSIST');

            if (graph.isConnectedStatus()) {
                await graph.createNode('NarrativeEvent', {
                    id: eventId,
                    content: content.substring(0, 500), // Truncate for graph storage
                    source,
                    importance,
                    timestamp: Date.now(),
                    ...metadata
                }, 'id');

                // [BIDIRECTIONAL LINKING] Connect high-importance thoughts to related concepts
                if (importance >= 0.5 && !this.narrationStopping) {
                    try {
                        const { geminiService } = await import('./geminiService');
                        if (required && this.narrationStopping) throw new Error('NARRATIVE_STOPPED_BEFORE_LINKING');
                        const embedding = await geminiService.generateEmbedding(content);

                        if (embedding) {
                            // Find related concepts in the graph via vector similarity
                            const { lancedbService } = await import('./lancedbService');
                            const related = await lancedbService.search(embedding, 3, "tier = 'MEDIUM'");

                            // Create MENTIONS relationships to related concepts
                            for (const concept of related) {
                                if (concept.id && concept.id !== eventId) {
                                    await graph.createRelationship(
                                        eventId,
                                        concept.id,
                                        'MENTIONS',
                                        {
                                            weight: importance * 0.5,
                                            source: 'NARRATIVE_SEMANTIC_LINK',
                                            timestamp: Date.now()
                                        }
                                    );
                                }
                            }

                            if (related.length > 0) {
                                console.log(`[NARRATIVE] 🔗 Linked to ${related.length} concepts`);
                            }
                        }
                    } catch (linkError) {
                        // Non-fatal - semantic linking is optional
                    }
                }

                console.log(`[NARRATIVE] 💾 Persisted: "${content.substring(0, 40)}..." (${source})`);
            }
        } catch (error) {
            if (required) throw error;
            // Non-fatal - log but don't throw
            console.warn("[NARRATIVE] ⚠️ Persistence error (non-fatal):", error);
        }
    }

    /**
     * Extracts discoveries from high-importance narrative events.
     * Creates graph relationships when insights are detected.
     */
    private async extractDiscoveries(content: string, importance: number): Promise<void> {
        // Only process high-importance events
        if (importance < 0.8) return;

        const contentLower = content.toLowerCase();

        // Discovery keywords that indicate a breakthrough
        const discoveryIndicators = [
            'eureka', 'realized', 'discovered', 'breakthrough',
            'understand now', 'makes sense', 'connection between',
            'pattern', 'insight', 'revelation'
        ];

        const isDiscovery = discoveryIndicators.some(k => contentLower.includes(k));
        if (!isDiscovery) return;

        try {
            const { graph } = await import('./graphService');

            if (graph.isConnectedStatus()) {
                // Create Discovery node
                const discoveryId = crypto.randomUUID();
                await graph.createNode('Discovery', {
                    id: discoveryId,
                    description: content.substring(0, 300),
                    confidence: importance,
                    discoveredAt: Date.now(),
                    source: 'NARRATIVE_CORTEX'
                }, 'id');

                // Create discovery relationship
                await graph.createDiscoveryRelationship(
                    'NARRATIVE_CORTEX',
                    discoveryId,
                    'IMPLIES',
                    importance,
                    'NARRATIVE_DISCOVERY'
                );

                console.log(`[NARRATIVE] 💡 DISCOVERY EXTRACTED: "${content.substring(0, 50)}..."`);
            }

            // Also use graphExtractor for entity extraction
            const { graphExtractor } = await import('./graphExtractionService');
            await graphExtractor.extractEntities(content, `Discovery: ${content.substring(0, 100)}`);

        } catch (error) {
            console.warn("[NARRATIVE] Discovery extraction warning:", error);
        }
    }
}

export const narrative = new NarrativeService();
