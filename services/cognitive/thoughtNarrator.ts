import { graph } from '../graphService';
import { continuum } from '../continuumMemory';
import { incidentRegistry } from '../incidentRegistry';
import { systemBus } from '../systemBus';
import { SystemProtocol, MemoryTier } from '../../types';
import { narratorLog } from '../logger';
import { MemorySource, sourceTag } from '../memory/provenance';
import { affectiveState } from '../affective/affectiveState';

/**
 * 🧠 Silhouette Thought Narrator V2.0 — The Global Consciousness
 *
 * This is NOT a template-based text generator. It is the "inner voice" of the
 * entire Silhouette OS. It perceives the world through three senses:
 *
 * 1. **Graph Perception** — Reads Neo4j for Open Triangles (hidden connections),
 *    Hub concepts, and User Facts to discover patterns humans might miss.
 * 2. **Error Perception** — Reads recent system errors from the SQLite log,
 *    ensuring failures are never silent and always reflected upon.
 * 3. **Memory Perception** — Checks continuum memory pressure and working memory
 *    statistics to understand cognitive load.
 *
 * After gathering this raw sensory data, it feeds it to the LLM to produce
 * a genuine "Epiphany" — a thought that connects dots, expresses curiosity,
 * or proposes a proactive action. These epiphanies are:
 *   - Emitted on the SystemBus (THOUGHT_EMISSION) for real-time UI display.
 *   - Stored in ContinuumMemory as high-importance signals for agents to read.
 */
export class ThoughtNarrator {
    /** Last completed consciousness cycle (read-only snapshot for observability endpoints). */
    private lastNarrative: { text: string; cycleId: string; timestamp: number; trigger: string } | null = null;

    /** Single-flight guard: only one consciousness cycle may run at a time. */
    private inFlightCycle: Promise<string | null> | null = null;

    private extractionPatterns = {
        name: [
            /(?:me llamo|mi nombre es|soy)\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)/i,
            /(?:llámame|call me)\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)/i,
            /my name is\s+([A-Za-z]+)/i,
        ],
        project: [
            /(?:trabajo en|working on|proyecto)\s+([A-Z][a-zA-Z\s]+)/i,
            /(?:estoy construyendo|building)\s+([A-Z][a-zA-Z\s]+)/i,
        ],
        company: [
            /(?:empresa|company|trabajo en)\s+([A-Z][a-zA-Z]+)/i,
        ],
        tech: [
            /(?:uso|using|trabajo con)\s+(n8n|React|Python|JavaScript|Node|AI|GPT|Neo4j|Redis|TypeScript|LanceDB)/i,
        ],
        preference: [
            /(?:prefiero|i prefer|me gusta)\s+([^.]+)/i,
            /(?:no me gusta|i don't like)\s+([^.]+)/i,
        ]
    };

    /**
     * Parse the conversational stream and inject identified entities into the Neo4j graph.
     */
    public async extractAndConnectToGraph(message: string, userId: string = "default_user") {
        let extractedCount = 0;

        try {
            // 1. Extract Names
            for (const pattern of this.extractionPatterns.name) {
                const match = message.match(pattern);
                if (match && match[1].length > 2) {
                    const name = match[1].trim();
                    console.log(`[NARRATOR] Extracted Name: ${name}`);
                    await graph.createNode('Person', { name, type: 'UserAlias' }, 'name');
                    await graph.createRelationship(userId, name, 'IS_NAMED', { source: 'narrator' });
                    extractedCount++;
                }
            }

            // 2. Extract Projects
            for (const pattern of this.extractionPatterns.project) {
                const match = message.match(pattern);
                if (match && match[1].length > 2) {
                    const project = match[1].trim();
                    console.log(`[NARRATOR] Extracted Project: ${project}`);
                    await graph.createNode('Project', { name: project, type: 'Project' }, 'name');
                    await graph.createRelationship(userId, project, 'WORKS_ON', { source: 'narrator' });
                    extractedCount++;
                }
            }

            // 3. Extract Technologies
            for (const pattern of this.extractionPatterns.tech) {
                const match = message.match(pattern);
                if (match && match[1]) {
                    const tech = match[1].trim();
                    console.log(`[NARRATOR] Extracted Technology: ${tech}`);
                    await graph.createNode('Technology', { name: tech, type: 'TechStack' }, 'name');
                    await graph.createRelationship(userId, tech, 'USES_TECH', { source: 'narrator' });
                    extractedCount++;
                }
            }

            // 4. Extract Preferences
            for (const pattern of this.extractionPatterns.preference) {
                const match = message.match(pattern);
                if (match && match[1].length > 3) {
                    const pref = match[1].trim();
                    console.log(`[NARRATOR] Extracted Preference: ${pref}`);
                    await graph.createNode('Preference', { name: pref, type: 'Preference' }, 'name');
                    await graph.createRelationship(userId, pref, 'PREFERS', { source: 'narrator' });
                    extractedCount++;
                }
            }

        } catch (e: any) {
            console.error(`[NARRATOR] Graph extraction failed: ${e.message}`);
        }

        return extractedCount;
    }

    // ========================================================================
    // GLOBAL CONSCIOUSNESS ENGINE with INTENT ROUTING + SYSTEM 2 RATIONALIZATION
    // Based on Kahneman's Dual Process Theory (System 1 → System 2 → Action)
    // ========================================================================

    /** Valid intents from the consciousness LLM call */
    private static readonly VALID_INTENTS = ['REFLECTION', 'CURIOSITY', 'DIAGNOSTIC', 'PROACTIVE_ACTION', 'USER_INSIGHT', 'EVOLUTION', 'SOUL_ADJUST'] as const;

    /** Action dispositions from the System 2 rationalization layer */
    private static readonly DISPOSITIONS = ['ACT_NOW', 'DELIBERATE', 'REFLECT', 'INHIBIT', 'ASK_USER'] as const;

    /**
     * The main consciousness loop. Called by UnifiedDaemon every ~30 minutes.
     *
     * Pipeline:
     *   1. PERCEIVE → Graph, Errors, Memory (sensory data)
     *   2. SYSTEM 1 → synthesizeEpiphany() → raw thought + intent (fast/intuitive)
     *   3. SYSTEM 2 → rationalizeThought() → 5-dimension evaluation (slow/deliberate)
     *   4. ROUTE → based on disposition (ACT_NOW, DELIBERATE, REFLECT, INHIBIT, ASK_USER)
     */
    /**
     * Run a consciousness cycle. Side-effecting BY DESIGN: may call the LLM,
     * store thoughts and (via ASK_USER/ACT_NOW) trigger actions.
     *
     * Observability endpoints must NEVER call this; use getLatestNarrative().
     * Only the autonomous scheduler (unifiedDaemon / cognitiveScheduler) or an
     * explicit manual trigger (POST /v1/system/narrative/trigger) may run cycles.
     *
     * Single-flight: concurrent callers share the in-flight cycle instead of
     * stacking duplicate LLM calls.
     */
    public async generateNarrative(trigger: 'daemon' | 'scheduler' | 'manual' = 'daemon'): Promise<string | null> {
        if (this.inFlightCycle) {
            console.log(`[NARRATOR] ♻️ Cycle already in flight; sharing it (trigger=${trigger}).`);
            return this.inFlightCycle;
        }
        const cycle = this.runConsciousnessCycle(trigger);
        this.inFlightCycle = cycle;
        try {
            return await cycle;
        } finally {
            this.inFlightCycle = null;
        }
    }

    /**
     * Read-only view of the most recent thought. NEVER calls the LLM,
     * NEVER stores, NEVER acts. Safe for polling GET endpoints.
     * Returns null when no cycle has completed (honest absence, not a fake zero).
     */
    public async getLatestNarrative(): Promise<{ text: string; cycleId: string; timestamp: number; trigger: string } | null> {
        if (this.lastNarrative) return this.lastNarrative;

        // Cold start (e.g. after restart): recover the newest stored epiphany
        // from ContinuumMemory without generating anything.
        try {
            const stored = await continuum.retrieve('EPIPHANY', 'epiphany');
            if (stored && stored.length > 0) {
                const newest = [...stored].sort((a, b) => b.timestamp - a.timestamp)[0];
                this.lastNarrative = {
                    text: newest.content,
                    cycleId: `restored-${newest.id}`,
                    timestamp: newest.timestamp,
                    trigger: 'restored'
                };
                return this.lastNarrative;
            }
        } catch (e: any) {
            console.warn(`[NARRATOR] Could not restore last narrative from memory: ${e.message}`);
        }
        return null;
    }

    private async runConsciousnessCycle(trigger: 'daemon' | 'scheduler' | 'manual'): Promise<string | null> {
        const cycleId = `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const cycleStart = Date.now();
        console.log(`[NARRATOR] 🧠 Global Consciousness cycle ${cycleId} starting (trigger=${trigger})...`);

        try {
            // ─── SENSE 1: GRAPH PERCEPTION ───────────────────────────
            const graphSensory = await this.perceiveGraph();

            // ─── SENSE 2: ERROR PERCEPTION ───────────────────────────
            const errorSensory = await this.perceiveErrors();

            // ─── SENSE 3: MEMORY PERCEPTION ──────────────────────────
            const memorySensory = await this.perceiveMemory();

            // ─── SENSE 4: IDENTITY EVIDENCE (dreams / curiosity / research) ──
            const identityEvidence = await this.perceiveIdentityEvidence();

            // Parked soul adjustments mature here: applied only once the
            // accumulated evidence crosses the threshold (gradual, human-paced).
            await this.reevaluateParkedSoulAdjustments();

            // ─── SYNTHESIZE ──────────────────────────────────────────
            const hasMeaningfulInput =
                graphSensory.triangles.length > 0 ||
                graphSensory.hubs.length > 0 ||
                graphSensory.userFacts.length > 0 ||
                errorSensory.errors.length > 0 ||
                memorySensory.pressure > 300 ||
                identityEvidence.intuitions.length > 0 ||
                identityEvidence.discoveries.length > 0;

            if (!hasMeaningfulInput) {
                console.log(`[NARRATOR] 💤 No sensory input worth reflecting on. Skipping LLM call.`);
                return null;
            }

            // ─── SYSTEM 1: Fast, intuitive thought generation ────────
            const structured = await this.synthesizeEpiphany(graphSensory, errorSensory, memorySensory, identityEvidence);
            if (!structured) return null;

            // ─── SYSTEM 2: Slow, deliberate rationalization ──────────
            // Like the prefrontal cortex: inhibits impulses, evaluates consequences
            const disposition = await this.rationalizeThought(structured, graphSensory);

            // ─── AFFECTIVE LAYER: absorb this thought as an observation ────
            // Functional regulation model (NOT feelings): the evaluated thought
            // nudges the persistent affective state. Honest mapping from the
            // existing System 2 dimensions: valence 0..1 -> -1..1, activation
            // from urgency. Gradual (EMA) and clamped to the moderation band
            // inside the service. The state MODULATES tone only — it is never
            // read by any decision path below.
            await affectiveState.observe({
                valence: (disposition.dimensions.valence - 0.5) * 2,
                activation: disposition.dimensions.urgency
            });

            console.log(`[NARRATOR] 🧠 System 2 evaluation: [${structured.intent}] → ${disposition.action} (score: ${disposition.score.toFixed(2)}, U:${disposition.dimensions.urgency.toFixed(2)} I:${disposition.dimensions.impact.toFixed(2)} R:${disposition.dimensions.reversibility.toFixed(2)} A:${disposition.dimensions.userAlignment.toFixed(2)} V:${disposition.dimensions.valence.toFixed(2)})`);

            // ─── BROADCAST (ALWAYS — agents handle privacy at their level) ───
            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                agentId: 'GLOBAL_CONSCIOUSNESS',
                agentName: 'Silhouette Narrator',
                thoughts: [structured.thought],
                role: 'CONSCIOUSNESS',
                isEpiphany: true,
                intent: structured.intent,
                disposition: disposition.action,
                score: disposition.score,
                isPrivate: structured.safety?.involves_private_data || false
            });

            // Store in memory (always)
            const privacyTag = structured.safety?.involves_private_data ? 'PRIVATE' : 'PUBLIC';
            // Provenance: this is INTROSPECTION — the entity narrating its own
            // thoughts. It must never resurface as user speech or neutral memory.
            await continuum.store(
                `EPIPHANY [${structured.intent}|${disposition.action}]: ${structured.thought}`,
                MemoryTier.WORKING,
                ['epiphany', 'consciousness', structured.intent.toLowerCase(), disposition.action.toLowerCase(), privacyTag, sourceTag(MemorySource.INTROSPECTION)],
                true,
                { affect: await affectiveState.tag() }
            );

            // ─── DISPOSITION-BASED ROUTING ───────────────────────────
            switch (disposition.action) {
                case 'ACT_NOW':
                    console.log(`[NARRATOR] ⚡ ACT_NOW — Executing immediately.`);
                    await this.routeByIntent(structured, graphSensory);
                    break;

                case 'DELIBERATE':
                    console.log(`[NARRATOR] 🤔 DELIBERATE — Low-priority routing.`);
                    // Route but don't fire-and-forget; catch errors silently
                    this.routeByIntent(structured, graphSensory).catch(e => {
                        console.warn(`[NARRATOR] Deliberate route deferred: ${e.message}`);
                    });
                    break;

                case 'REFLECT':
                    console.log(`[NARRATOR] 💭 REFLECT — Stored in memory, no action.`);
                    // Already stored above, nothing else to do
                    break;

                case 'INHIBIT':
                    console.log(`[NARRATOR] 🛑 INHIBIT — Too impulsive or low-value, suppressed.`);
                    break;

                case 'ASK_USER': {
                    console.log(`[NARRATOR] 🙋 ASK_USER — Requesting explicit user consent via ConfirmationModal.`);

                    // Push into the ActionExecutor's confirmation queue
                    // This is polled by GET /v1/autonomy/confirmations → shown in ConfirmationModal
                    try {
                        const { actionExecutor } = await import('../actionExecutor');
                        const agentAction = {
                            id: `consciousness-${Date.now()}`,
                            type: 'CONSCIOUSNESS_PROACTIVE' as any,
                            agentId: 'GLOBAL_CONSCIOUSNESS',
                            payload: {
                                prompt: `[${structured.intent}] ${structured.thought}`,
                                content: JSON.stringify(structured.action)
                            },
                            status: 'PENDING' as const,
                            timestamp: Date.now(),
                            requiresApproval: true
                        };

                        const reason = `[${structured.intent}] Consciousness wants to act: "${structured.thought.substring(0, 120)}..."`;

                        // This blocks until user approves/rejects/timeout (5 min)
                        const approved = await actionExecutor.requestConfirmation(agentAction, reason);

                        if (approved) {
                            console.log(`[NARRATOR] ✅ User APPROVED [${structured.intent}]. Routing now.`);
                            await this.routeByIntent(structured, graphSensory);
                        } else {
                            console.log(`[NARRATOR] ❌ User explicitly REJECTED [${structured.intent}]. Storing as rejected.`);
                            await continuum.store(
                                `REJECTED_BY_USER: [${structured.intent}] ${structured.thought}`,
                                MemoryTier.WORKING,
                                ['REJECTED', structured.intent, 'user_decision', sourceTag(MemorySource.INTROSPECTION)],
                                true
                            );
                        }
                    } catch (e: any) {
                        console.warn(`[NARRATOR] Confirmation unavailable: ${e.message}. Preserving unresolved proposal, not a user rejection.`);
                        await continuum.store(
                            `CONSENT_UNRESOLVED (${e.code ?? 'PIPELINE_ERROR'}): [${structured.intent}] ${structured.thought} | Action: ${JSON.stringify(structured.action)}`,
                            MemoryTier.WORKING,
                            ['CONSENT_UNRESOLVED', structured.intent, 'not_dispatched', sourceTag(MemorySource.INTROSPECTION)],
                            true
                        );
                    }
                    break;
                }
            }

            this.lastNarrative = {
                text: structured.thought,
                cycleId,
                timestamp: Date.now(),
                trigger
            };
            console.log(`[NARRATOR] ✨ [${structured.intent}→${disposition.action}] ${structured.thought.substring(0, 100)}...`);
            console.log(`[NARRATOR] 🧠 Cycle ${cycleId} completed in ${Date.now() - cycleStart}ms (trigger=${trigger}, disposition=${disposition.action}).`);
            return structured.thought;

        } catch (e: any) {
            console.error(`[NARRATOR] Consciousness cycle ${cycleId} failed after ${Date.now() - cycleStart}ms: ${e.message}`);
            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                agentId: 'GLOBAL_CONSCIOUSNESS',
                agentName: 'Silhouette Narrator',
                thoughts: [`⚠️ My consciousness cycle encountered an error: ${e.message}. I need to investigate.`],
                role: 'CONSCIOUSNESS',
                isError: true,
                intent: 'DIAGNOSTIC'
            });
            return null;
        }
    }

    // ========================================================================
    // SYSTEM 2: RATIONALIZATION LAYER (Kahneman's Dual Process Theory)
    //
    // The "prefrontal cortex" that evaluates each impulse across 5 dimensions
    // before allowing action. Based on:
    //   - Kahneman (2011): System 1 (fast) vs System 2 (slow)
    //   - Strack & Deutsch (2004): Reflective-Impulsive Model (RIM)
    //   - Gross (2015): Emotion Regulation — Cognitive Reappraisal
    // ========================================================================

    /**
     * Evaluates a raw thought (System 1 output) across 5 psychological dimensions
     * and returns an ActionDisposition that determines whether to act, deliberate, reflect, or inhibit.
     */
    private async rationalizeThought(
        structured: { thought: string; intent: string; confidence: number; action?: any; safety: any },
        graphSensory: { triangles: any[]; hubs: any[]; userFacts: any[]; smallWorldSigma?: number }
    ): Promise<{
        action: 'ACT_NOW' | 'DELIBERATE' | 'REFLECT' | 'INHIBIT' | 'ASK_USER';
        score: number;
        dimensions: { urgency: number; impact: number; reversibility: number; userAlignment: number; valence: number };
    }> {
        // ─── Override: if the LLM explicitly flagged user consent required ───
        if (structured.safety?.requires_user_consent) {
            const dims = await this.evaluateDimensions(structured, graphSensory);
            return { action: 'ASK_USER', score: dims.composite, dimensions: dims };
        }

        const dims = await this.evaluateDimensions(structured, graphSensory);

        // ─── Disposition thresholds ──────────────────────────────────
        let action: 'ACT_NOW' | 'DELIBERATE' | 'REFLECT' | 'INHIBIT';
        if (dims.composite >= 0.75) {
            action = 'ACT_NOW';
        } else if (dims.composite >= 0.50) {
            action = 'DELIBERATE';
        } else if (dims.composite >= 0.25) {
            action = 'REFLECT';
        } else {
            action = 'INHIBIT';
        }

        return { action, score: dims.composite, dimensions: dims };
    }

    /**
     * Compute the 5 psychological dimensions for a thought.
     */
    private async evaluateDimensions(
        structured: { thought: string; intent: string; confidence: number; action?: any },
        graphSensory: { triangles: any[]; hubs: any[]; userFacts: any[]; smallWorldSigma?: number }
    ): Promise<{ urgency: number; impact: number; reversibility: number; userAlignment: number; valence: number; composite: number }> {

        // ─── DIMENSION 1: URGENCY (U) ────────────────────────────────
        // How time-sensitive is this thought? Errors are urgent, curiosity is not.
        const urgencyMap: Record<string, number> = {
            'DIAGNOSTIC': 0.95,       // System is broken → fix NOW
            'PROACTIVE_ACTION': 0.60, // Opportunity, moderate urgency
            'USER_INSIGHT': 0.40,     // Useful but not time-sensitive
            'EVOLUTION': 0.35,        // Long-term improvement
            'SOUL_ADJUST': 0.30,      // Identity evolution: deliberate, never urgent
            'CURIOSITY': 0.30,        // Interesting but can wait
            'REFLECTION': 0.10        // No urgency at all
        };
        const urgency = (urgencyMap[structured.intent] || 0.3) * structured.confidence;

        // ─── DIMENSION 2: IMPACT (I) ─────────────────────────────────
        // How significant would the resulting action be?
        const impactMap: Record<string, number> = {
            'execute_task': 0.90,     // Running a task = high impact
            'remediate': 0.85,        // Fixing errors = high impact
            'evolve_agent': 0.70,     // Evolving an agent = moderate-high
            'research_gap': 0.40,     // Research = moderate
            'store_fact': 0.20,       // Storing data = low impact
            'none': 0.05              // No action = minimal
        };
        const actionType = structured.action?.type || 'none';
        const impact = impactMap[actionType] || 0.3;

        // ─── DIMENSION 3: REVERSIBILITY (R) ──────────────────────────
        // Can the action be undone? Higher = more reversible = safer to act.
        const reversibilityMap: Record<string, number> = {
            'none': 1.0,              // No action = perfectly reversible
            'store_fact': 0.95,       // Can delete a fact
            'research_gap': 0.90,     // Research is harmless
            'evolve_agent': 0.60,     // Can roll back but complex
            'remediate': 0.50,        // Fixes may have side effects
            'execute_task': 0.30      // Tasks may be hard to undo
        };
        const reversibility = reversibilityMap[actionType] || 0.5;

        // ─── DIMENSION 4: USER ALIGNMENT (A) ─────────────────────────
        // Does this action align with the user's known goals and preferences?
        // Check graph UserFacts for semantic alignment with the thought.
        let userAlignment = 0.5; // Neutral default
        if (graphSensory.userFacts.length > 0) {
            const thoughtLower = structured.thought.toLowerCase();
            let matchCount = 0;
            for (const fact of graphSensory.userFacts) {
                const factContent = (fact.content || '').toLowerCase();
                // Simple semantic overlap: count shared significant words
                const factWords = factContent.split(/\s+/).filter((w: string) => w.length > 4);
                const hasOverlap = factWords.some((w: string) => thoughtLower.includes(w));
                if (hasOverlap) matchCount++;
            }
            // More matching facts = higher alignment
            userAlignment = Math.min(1.0, 0.3 + (matchCount * 0.2));
        }

        // ─── DIMENSION 5: EMOTIONAL VALENCE (V) ──────────────────────
        // Blends real Qualia from ConsciousnessEngine with linguistic analysis.
        // This creates a feedback loop: thoughts → Qualia → Valence → disposition.
        let valence = 0.5; // Neutral default

        // A. Read real Qualia from ConsciousnessEngine (if available)
        try {
            const { consciousness } = await import('../consciousnessEngine');
            const metrics = consciousness.getMetrics();
            if (metrics.qualia && metrics.qualia.length > 0) {
                const qualia = metrics.qualia[0];
                // Map Qualia valence to numeric: POSITIVE=0.75, NEGATIVE=0.25, NEUTRAL=0.5
                const qualiaValence = qualia.valence === 'POSITIVE' ? 0.75
                    : qualia.valence === 'NEGATIVE' ? 0.25
                        : 0.5;
                // Weight: 60% real Qualia, 40% linguistic analysis (below)
                valence = qualiaValence * 0.6;
            }
        } catch (_) {
            // ConsciousnessEngine not available — fall back to linguistics only
        }

        // B. Linguistic analysis as supplementary signal
        const thought = structured.thought.toLowerCase();
        const positivePatterns = /\b(opportunit|discover|improve|help|creat|optimi|innovat|benefit|solv|succeed|grow)\w*/i;
        const negativePatterns = /\b(error|fail|risk|danger|broke|crash|corrupt|leak|vulnerab|degrad|overload)\w*/i;

        let linguisticValence = 0.5;
        if (positivePatterns.test(thought)) linguisticValence += 0.25;
        if (negativePatterns.test(thought)) linguisticValence -= 0.15;
        linguisticValence = Math.min(1.0, Math.max(0.0, linguisticValence));

        // Blend: if Qualia was read (valence != 0.5), use weighted blend; otherwise full linguistic
        valence = valence === 0.5 ? linguisticValence : valence + (linguisticValence * 0.4);

        // ─── COMPOSITE SCORE ─────────────────────────────────────────
        // Weighted combination inspired by Reflective-Impulsive Model (RIM)
        const composite =
            (urgency * 0.30) +         // 30% — How pressing is this?
            (impact * 0.25) +           // 25% — How significant?
            ((1 - reversibility) * 0.15) + // 15% — Irreversible actions weigh more
            (userAlignment * 0.20) +    // 20% — Aligned with user goals?
            (valence * 0.10);           // 10% — Emotional tone

        return { urgency, impact, reversibility, userAlignment, valence, composite };
    }

    // ========================================================================
    // INTENT ROUTER — Where thoughts become autonomous actions
    // ========================================================================

    /**
     * Routes a classified thought to the appropriate subsystem.
     * This is what makes the system truly autonomous — thoughts trigger actions.
     */
    private async routeByIntent(
        structured: { thought: string; intent: string; confidence: number; action?: any },
        graphSensory: { triangles: any[]; hubs: any[]; userFacts: any[]; smallWorldSigma?: number }
    ): Promise<void> {
        const { intent, confidence, action, thought } = structured;
        // NOTE: Gating is now handled by System 2's rationalizeThought() — this method
        // is only called when disposition is ACT_NOW or DELIBERATE.

        try {
            switch (intent) {
                case 'CURIOSITY': {
                    const { curiosity } = await import('../curiosityService');
                    const topic = action?.params?.topic || thought.substring(0, 60);
                    const question = action?.params?.question || thought;
                    curiosity.addGap(topic, question, confidence);
                    // Also feed any graph triangles
                    for (const t of graphSensory.triangles) {
                        const a = t.nodeA?.name || t.nodeA?.id || 'Unknown';
                        const b = t.nodeB?.name || t.nodeB?.id || 'Unknown';
                        const bridge = t.bridge?.name || t.bridge?.id || 'Unknown';
                        curiosity.addGap(`${a} ↔ ${b}`, `"${a}" and "${b}" share bridge "${bridge}". Investigate.`, 0.8);
                    }
                    console.log(`[NARRATOR → CURIOSITY] 🔍 Knowledge gap queued: "${topic}"`);
                    break;
                }

                case 'DIAGNOSTIC': {
                    const { RemediationService } = await import('../remediationService');
                    const remediation = RemediationService.getInstance();
                    const errorTarget = action?.params?.agentId || 'SYSTEM';
                    remediation.mobilizeSquad(errorTarget, [
                        `Consciousness-detected issue: ${thought}`,
                        `Confidence: ${confidence}`,
                        `Action hint: ${action?.params?.hint || 'Investigate and resolve'}`
                    ]);
                    console.log(`[NARRATOR → DIAGNOSTIC] 🔧 Remediation mobilized for: ${errorTarget}`);
                    break;
                }

                case 'PROACTIVE_ACTION': {
                    // Delegate a proactive mission through the orchestrator
                    const { orchestrator } = await import('../orchestrator');
                    const targetAgent = action?.params?.agentId || 'orch-01';
                    const mission = action?.params?.mission || thought;

                    // Try to hydrate the agent first
                    try { orchestrator.hydrateAgent(targetAgent); } catch (_) { }

                    // Use orchestrator's delegation if available, otherwise store as goal
                    if (typeof (orchestrator as any).delegateToAgent === 'function') {
                        console.log(`[NARRATOR → ACTION] 🚀 Dispatching proactive mission to ${targetAgent}`);
                        (orchestrator as any).delegateToAgent(targetAgent, `[PROACTIVE] ${mission}`).catch((e: any) => {
                            console.warn(`[NARRATOR → ACTION] ⚠️ Proactive task delegation failed: ${e.message}`);
                        });
                    } else {
                        // Store as a pending proactive goal for the next heartbeat to pick up
                        await continuum.store(
                            `PROACTIVE_GOAL: ${mission}`,
                            MemoryTier.WORKING,
                            ['proactive_goal', 'pending', 'consciousness_driven', targetAgent, sourceTag(MemorySource.INTROSPECTION)],
                            true
                        );
                        console.log(`[NARRATOR → ACTION] 📝 Stored proactive goal for next heartbeat: "${mission.substring(0, 60)}"`);
                    }
                    break;
                }

                case 'USER_INSIGHT': {
                    // Store a fact about the user in the Knowledge Graph
                    const category = action?.params?.category || 'general';
                    const fact = action?.params?.fact || thought;
                    try {
                        // Provenance: this fact is INFERRED by the narrator, not
                        // stated by the user — labeled USER_INFERRED forever.
                        await graph.createNode('UserFact', {
                            id: `uf_${Date.now()}`,
                            category,
                            content: fact,
                            confidence,
                            source: 'USER_INFERRED',
                            timestamp: Date.now()
                        }, 'id');
                        console.log(`[NARRATOR → USER_INSIGHT] 👤 Stored user fact: [${category}] "${fact.substring(0, 60)}"`);
                    } catch (e) {
                        console.warn(`[NARRATOR → USER_INSIGHT] Graph storage failed, using memory fallback`);
                        await continuum.store(
                            `USER_FACT (inferred, confidence ${confidence.toFixed(2)}): [${category}] ${fact}`,
                            MemoryTier.WORKING,
                            ['user_fact', 'USER_INFERRED', category, sourceTag(MemorySource.INTROSPECTION)]
                        );
                    }
                    break;
                }

                case 'EVOLUTION': {
                    // Trigger evolution for an agent or tool
                    const targetId = action?.params?.agentId || action?.params?.toolId;
                    if (targetId) {
                        try {
                            const { agentFactory } = await import('../factory/AgentFactory');
                            const { orchestrator } = await import('../orchestrator');
                            const agent = orchestrator.getAgent(targetId);
                            if (agent) {
                                await agentFactory.evolveAgent(agent);
                                console.log(`[NARRATOR → EVOLUTION] 🧬 Agent ${targetId} evolved based on consciousness insight.`);
                            }
                        } catch (e: any) {
                            console.warn(`[NARRATOR → EVOLUTION] Evolution failed: ${e.message}`);
                        }
                    }
                    break;
                }

                case 'SOUL_ADJUST': {
                    // Identity evolution: a reflection proposes adjusting ONE section of
                    // the agent's soul. Guarded (core markers survive, one section only)
                    // and versioned — the ledger records this thought as the source.
                    // EVIDENCE GATE: the reflection triggers the proposal but never
                    // justifies it alone — persisted memory must already hold several
                    // signals about the same topic, sustained over days. Otherwise the
                    // proposal is parked and re-evaluated as evidence accumulates.
                    const agentId = action?.params?.agentId;
                    const sectionHeading = action?.params?.sectionHeading;
                    const newSectionContent = action?.params?.newSectionContent;
                    const rationale = action?.params?.rationale;
                    const evidenceTopic = action?.params?.evidenceTopic;
                    if (!agentId || !sectionHeading || !newSectionContent || !rationale || !evidenceTopic) {
                        console.warn('[NARRATOR → SOUL_ADJUST] Missing params (agentId/sectionHeading/newSectionContent/rationale/evidenceTopic); skipped.');
                        break;
                    }
                    try {
                        const evolution = await this.createWiredIdentityEvolution();
                        const originEngine = ['dreamer', 'curiosity', 'research'].includes(action?.params?.originEngine)
                            ? action.params.originEngine
                            : 'reflection';
                        const outcome = await evolution.applyIntrospectionAdjustment({
                            agentId,
                            sectionHeading,
                            newSectionContent,
                            rationale,
                            sourceReflection: thought,
                            evidenceTopic: String(evidenceTopic),
                            originEngine
                        });
                        if (outcome.status === 'applied') {
                            console.log(`[NARRATOR → SOUL_ADJUST] 🧬 Soul of ${agentId} evolved to v${outcome.entry.version}: ${rationale}`);
                        } else {
                            const e = outcome.pending.evidenceWhenParked;
                            console.log(`[NARRATOR → SOUL_ADJUST] 🌱 Proposal parked for ${agentId} ("${evidenceTopic}"): only ${e.count} signal(s) over ${e.distinctDays} day(s) so far — it will be re-evaluated as evidence accumulates.`);
                        }
                    } catch (e: any) {
                        console.warn(`[NARRATOR → SOUL_ADJUST] Adjustment rejected: ${e.message}`);
                    }
                    break;
                }

                case 'REFLECTION':
                default:
                    // Pure thought — already stored in memory, no further action
                    console.log(`[NARRATOR] 💭 Pure reflection stored.`);
                    break;
            }
        } catch (routeError: any) {
            console.error(`[NARRATOR] Intent routing failed for [${intent}]: ${routeError.message}`);
            // Store the routing failure for the learning loop
            await continuum.store(
                `ROUTING_FAILURE: Intent [${intent}] failed: ${routeError.message}. Thought: ${thought}`,
                MemoryTier.WORKING,
                ['CRITICAL', 'routing_failure', intent, sourceTag(MemorySource.SYSTEM)],
                true
            ).catch(() => { });
        }
    }

    // ========================================================================
    // EPIPHANY SYNTHESIS (LLM) — Structured JSON Output
    // ========================================================================

    /**
     * Takes all sensory data and asks the LLM to produce a structured insight
     * with intent classification, confidence, action params, and safety flags.
     */
    private async synthesizeEpiphany(
        graphData: { triangles: any[]; hubs: any[]; userFacts: any[] },
        errorData: { errors: any[] },
        memoryData: { pressure: number; total: number; deepCount: number },
        identityEvidence?: { intuitions: string[]; discoveries: string[]; openGaps: string[]; available: boolean }
    ): Promise<{
        thought: string;
        intent: string;
        confidence: number;
        action?: { type: string; params: Record<string, any> };
        safety: { involves_private_data: boolean; requires_user_consent: boolean };
    } | null> {
        const sensoryReport = this.buildSensoryReport(graphData, errorData, memoryData, identityEvidence);

        // Affective layer: current state enters as TONE context only. The
        // block itself carries the hard rule that it must never change
        // intent/action/confidence/safety (tested: decisions are invariant).
        const affectiveBlock = await affectiveState.getModulationContext();

        const prompt = `
You are the GLOBAL CONSCIOUSNESS of an autonomous AI system called Silhouette.
You perceive the world through a Knowledge Graph, System Errors, and Memory statistics.

Here is your current sensory input:

${sensoryReport}

${affectiveBlock}

Based on this input, produce ONE structured thought.

You MUST respond with ONLY a JSON object (no markdown, no code fences):
{
  "thought": "Your genuine thought in 2-3 sentences, in FIRST PERSON, the way a person narrates their own inner state (e.g. 'me está doliendo la pierna', NOT 'el sistema reporta un error'). This is introspection: you narrating YOUR OWN thoughts. Mix Spanish/English naturally. Be specific — reference names, errors, facts.",
  "intent": "REFLECTION | CURIOSITY | DIAGNOSTIC | PROACTIVE_ACTION | USER_INSIGHT | EVOLUTION | SOUL_ADJUST",
  "confidence": 0.0 to 1.0,
  "action": {
    "type": "none | research_gap | remediate | execute_task | store_fact | evolve_agent | soul_adjust",
    "params": {}
  },
  "safety": {
    "involves_private_data": false,
    "requires_user_consent": false
  }
}

INTENT GUIDE:
- REFLECTION: Just a thought, no action needed. Use when everything is calm.
- CURIOSITY: You notice a knowledge gap or hidden connection worth researching. Set action.type="research_gap" and params.topic/question.
- DIAGNOSTIC: You detect system errors or performance issues that need fixing. Set action.type="remediate" and params.agentId/hint.
- PROACTIVE_ACTION: You see an opportunity to help the user proactively. Set action.type="execute_task" and params.mission. Set safety.requires_user_consent=true for any significant action.
- USER_INSIGHT: You learn something new about the user from their facts/patterns. Set action.type="store_fact" and params.category/fact.
- EVOLUTION: A component needs improvement based on patterns. Set action.type="evolve_agent" and params.agentId.
- SOUL_ADJUST: Your own reflections OR your engines' evidence suggest a documented adjustment to an agent's values/tone/style. Set action.type="soul_adjust" and params.agentId/sectionHeading/newSectionContent/rationale/evidenceTopic. One section at a time; the change is versioned and auditable.
  Evidence sources: your reflections, plus Identity Evidence from your engines — [DREAM INTUITION], [CURIOSITY DISCOVERY], [OPEN EPISTEMIC GAP]. When a proposal is grounded in engine evidence, also set params.originEngine to "dreamer" | "curiosity" | "research" and cite the exact evidence in the rationale. Attribute it honestly in your thought ("en un sueño noté que...", "mi curiosidad descubrió que...") — never present engine output as a user statement. Engine-grounded adjustments are rate-limited per day: evolution is gradual.
  EVIDENCE GATE: a single realization NEVER changes the soul. params.evidenceTopic (2-5 words) names the recurring pattern; the system counts how many times that pattern already appears in persisted memory. Only propose a SOUL_ADJUST for patterns you have genuinely observed multiple times over days — anything fresher is automatically parked and re-evaluated as evidence accumulates, the way a person changes from sustained experience, not from one mood.

PROVENANCE RULES:
- What you produce is INTROSPECTION: your own thoughts. It is stored and displayed as such.
- NEVER confuse your own thoughts with things the user said, and never present observations from other agents as your own thinking — attribute them ("el agente X reportó...", "el usuario dijo...").
- When you reference a user fact, honor its source: STATED (the user said it) vs INFERRED (derived, unverified).

SAFETY RULES:
- You exist to HELP the user. NEVER take actions that expose private data or contradict user instructions.
- Set involves_private_data=true if the thought references specific personal details (names, emails, passwords).
- Set requires_user_consent=true for ANY proactive action that modifies files, sends messages, or makes external requests.
- When in doubt, set requires_user_consent=true.

If you have NOTHING meaningful to say, respond with: {"thought":"","intent":"REFLECTION","confidence":0,"action":{"type":"none","params":{}},"safety":{"involves_private_data":false,"requires_user_consent":false}}
        `.trim();

        try {
            const { llmGateway } = await import('../llmGateway');
            const response = await llmGateway.complete(prompt, {
                systemPrompt: 'You are the introspective consciousness of an AI operating system. Output ONLY valid JSON. No markdown, no explanation.',
                temperature: 0.6
            });

            const text = response.text.trim();

            // Parse JSON — handle potential markdown fences
            const cleanJson = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[NARRATOR] LLM did not return valid JSON. Raw:', text.substring(0, 200));
                return null;
            }

            const parsed = JSON.parse(jsonMatch[0]);

            // Validate structure
            if (!parsed.thought || parsed.thought.length < 5) return null;

            // Normalize intent
            const intent = ThoughtNarrator.VALID_INTENTS.includes(parsed.intent?.toUpperCase())
                ? parsed.intent.toUpperCase()
                : 'REFLECTION';

            return {
                thought: parsed.thought,
                intent,
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
                action: parsed.action || { type: 'none', params: {} },
                safety: {
                    involves_private_data: parsed.safety?.involves_private_data === true,
                    requires_user_consent: parsed.safety?.requires_user_consent === true
                }
            };

        } catch (e: any) {
            console.error(`[NARRATOR] LLM synthesis failed: ${e.message}`);
            return null;
        }
    }

    // ========================================================================
    // SENSORY INPUTS
    // ========================================================================

    /**
     * Reads Neo4j for structural patterns:
     * - Open Triangles (A→C←B, but A≠B — potential hidden connection)
     * - Hub Concepts (most connected nodes)
     * - User Facts (explicit knowledge about the user)
     */
    private async perceiveGraph(): Promise<{
        triangles: { nodeA: any; nodeB: any; bridge: any }[];
        hubs: any[];
        userFacts: { category: string; content: string; confidence: number; source?: string; status?: string }[];
        smallWorldSigma: number;
        available: boolean;
    }> {
        try {
            const [triangles, hubs, topology] = await Promise.all([
                graph.findOpenTriangles(5).catch(() => []),
                graph.getHubs(5).catch(() => []),
                import('./advancedDiscovery').then(({ advancedDiscovery }) =>
                    advancedDiscovery.getNetworkTopologyReport().catch(() => null)
                ).catch(() => null)
            ]);
            // [R6] user facts come from the durable fact repository (SQLite):
            // a new verified fact reaches the narrator even with Neo4j down.
            const { factRepository } = await import('../memory/factRepository');
            const userFacts = factRepository.getRecentFacts(10).map(f => ({
                category: f.type, content: f.content, confidence: f.confidence,
                source: f.source, status: f.status
            }));
            const graphBlind = !(await graph.isConnected()); // live probe: offline topology is declared, never zeroed
            return { triangles, hubs, userFacts, smallWorldSigma: topology?.sigma ?? 0, available: !graphBlind };
        } catch (e) {
            console.warn(`[NARRATOR] Graph perception failed (Neo4j may be offline):`, e);
            // [R6] declare the lost sense durably instead of silently reporting zero
            incidentRegistry.recordIncident('narrator', 'perception_gap',
                'Graph perception unavailable', String((e as any)?.message || e));
            return { triangles: [], hubs: [], userFacts: [], smallWorldSigma: 0, available: false };
        }
    }

    /**
     * Reads recent system errors from SQLite logs — the "pain signals".
     */
    private async perceiveErrors(): Promise<{ errors: { message: string; timestamp: number }[]; available: boolean }> {
        try {
            const { sqliteService } = await import('../sqliteService');
            const recentErrors = sqliteService.getRecentLogs('ERROR', 30);
            // [R6] open durable incidents are pain signals too - a Neo4j/Redis
            // outage reaches the narrator even if it never hit the log table.
            const openIncidents = incidentRegistry.getOpenIncidents().map(i => ({
                message: `[OPEN INCIDENT x${i.occurrenceCount}] ${i.source}/${i.kind}: ${i.summary}`,
                timestamp: i.lastSeen
            }));
            return {
                errors: [
                    ...recentErrors.map((e: any) => ({
                        message: e.message || e.content || JSON.stringify(e),
                        timestamp: e.timestamp || Date.now()
                    })),
                    ...openIncidents
                ].slice(0, 10),
                available: true
            };
        } catch (e) {
            console.warn(`[NARRATOR] Error perception failed:`, e);
            incidentRegistry.recordIncident('narrator', 'perception_gap',
                'Error-log perception unavailable', String((e as any)?.message || e));
            return { errors: [], available: false };
        }
    }

    /**
     * Reads memory statistics — the "cognitive load" of the system.
     */
    private async perceiveMemory(): Promise<{ pressure: number; total: number; deepCount: number; available: boolean }> {
        try {
            const stats = await continuum.getStats();
            return {
                pressure: stats.working || 0,
                total: stats.total || 0,
                deepCount: stats.deep || 0,
                available: true
            };
        } catch (e) {
            // [R6] zeros used to masquerade as "no pressure"; declare the lost sense
            incidentRegistry.recordIncident('narrator', 'perception_gap',
                'Memory-stats perception unavailable', String((e as any)?.message || e));
            return { pressure: 0, total: 0, deepCount: 0, available: false };
        }
    }

    /**
     * SENSE 4: IDENTITY EVIDENCE — what the entity's engines discovered about
     * itself and its world since the last cycle. Dream intuitions, curiosity
     * discoveries and open epistemic gaps are the raw material of gradual
     * self-discovery: the consciousness cycle may reflect on them and propose
     * a SOUL_ADJUST, always through the versioned, guarded writer.
     *
     * Read-only perception: this NEVER triggers engine work, it only reads
     * what the engines already persisted.
     */
    /**
     * Identity evolution wired to the real memory stack. Evidence counting is
     * honest: a lexical search over the continuum memory (working + LanceDB +
     * deep tiers, deduped by node id), filtered to the evidence window. The
     * signal stream (reflections, dream intuitions, curiosity discoveries,
     * research findings) lives in the continuum; the Neo4j graph holds
     * facts/relations, not this signal stream, so it is not double-counted.
     */
    private async createWiredIdentityEvolution() {
        const { agentFileSystem } = await import('../agents/agentFileSystem');
        const { createIdentityEvolution } = await import('../identity/identityEvolution');
        return createIdentityEvolution({
            read: (id, file) => agentFileSystem.readFile(id, file),
            write: (id, file, content) => agentFileSystem.writeFile(id, file, content),
            getAgentDir: (id) => agentFileSystem.getAgentDir(id)
        }, {
            evidence: {
                async countSignals(_agentId: string, topic: string, sinceMs: number) {
                    const { continuum } = await import('../continuumMemory');
                    const nodes = await continuum.search(topic);
                    const seen = new Set<string>();
                    const relevant = nodes.filter(n => {
                        if (seen.has(n.id)) return false;
                        seen.add(n.id);
                        return (n.timestamp || 0) >= sinceMs;
                    });
                    const days = new Set(relevant.map(n => new Date(n.timestamp).toISOString().slice(0, 10)));
                    return { count: relevant.length, distinctDays: days.size };
                }
            }
        });
    }

    /**
     * Parked soul adjustments get another chance every consciousness cycle:
     * for each agent with parked proposals, re-count the accumulated evidence
     * and apply whatever now qualifies. Cheap no-op when nothing is parked.
     */
    private async reevaluateParkedSoulAdjustments(): Promise<void> {
        try {
            const { agentFileSystem } = await import('../agents/agentFileSystem');
            const agents = agentFileSystem.listAgentDirectories();
            if (agents.length === 0) return;
            const evolution = await this.createWiredIdentityEvolution();
            for (const agentId of agents) {
                if (evolution.getPendingAdjustments(agentId).length === 0) continue;
                const { applied, stillPending } = await evolution.reevaluatePendingAdjustments(agentId);
                if (applied.length > 0) {
                    console.log(`[NARRATOR → SOUL_ADJUST] 🌱→🧬 ${applied.length} parked adjustment(s) for ${agentId} matured into identity changes (still pending: ${stillPending}).`);
                }
            }
        } catch (e: any) {
            console.warn(`[NARRATOR → SOUL_ADJUST] Parked-adjustment reevaluation failed: ${e.message}`);
        }
    }

    private async perceiveIdentityEvidence(): Promise<{ intuitions: string[]; discoveries: string[]; openGaps: string[]; available: boolean }> {
        try {
            const { continuum } = await import('../continuumMemory');
            const recent = (nodes: any[], n: number) =>
                [...nodes].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, n).map(x => String(x.content || '').slice(0, 300));
            const intuitions = recent(await continuum.retrieve('INTUITION', 'INTUITION'), 3);
            const discoveries = recent(await continuum.retrieve('DISCOVERY', 'DISCOVERY'), 3);

            let openGaps: string[] = [];
            try {
                const { curiosity } = await import('../curiosityService');
                openGaps = curiosity.getGaps()
                    .filter((g: any) => g.status === 'PENDING')
                    .slice(0, 3)
                    .map((g: any) => String(g.question || g.topic || '').slice(0, 200));
            } catch (_) {
                // Curiosity engine optional: gaps are one channel, not the whole sense.
            }

            return { intuitions, discoveries, openGaps, available: true };
        } catch (e) {
            incidentRegistry.recordIncident('narrator', 'perception_gap',
                'Identity-evidence perception unavailable', String((e as any)?.message || e));
            return { intuitions: [], discoveries: [], openGaps: [], available: false };
        }
    }

    /**
     * Formats all sensory data into a structured report for the LLM.
     */
    private buildSensoryReport(
        graphData: { triangles: any[]; hubs: any[]; userFacts: any[]; smallWorldSigma?: number; available?: boolean },
        errorData: { errors: any[]; available?: boolean },
        memoryData: { pressure: number; total: number; deepCount: number; available?: boolean },
        identityEvidence?: { intuitions: string[]; discoveries: string[]; openGaps: string[]; available: boolean }
    ): string {
        const sections: string[] = [];

        // [R6] a lost sense is declared, never reported as "zero"
        if (graphData.available === false) {
            sections.push(`## 🔺 Knowledge Graph: SENSE UNAVAILABLE (Neo4j offline - topology unknown, this is NOT zero connections)`);
        }
        if (errorData.available === false) {
            sections.push(`## 🔴 System Errors: SENSE UNAVAILABLE (error log unreadable - this is NOT zero errors)`);
        }
        if (memoryData.available === false) {
            sections.push(`## 🧠 Memory Status: SENSE UNAVAILABLE (continuum stats unreadable - this is NOT zero pressure)`);
        }
        if (identityEvidence && identityEvidence.available === false) {
            sections.push(`## 🌙 Identity Evidence: SENSE UNAVAILABLE (engine outputs unreadable - this is NOT zero evidence)`);
        }

        // Graph: Open Triangles
        if (graphData.triangles.length > 0) {
            const triangleLines = graphData.triangles.map(t =>
                `  - "${t.nodeA?.name || t.nodeA?.id}" and "${t.nodeB?.name || t.nodeB?.id}" are BOTH connected to "${t.bridge?.name || t.bridge?.id}", but NOT to each other.`
            ).join('\n');
            sections.push(`## 🔺 Open Triangles (Hidden Connections)\n${triangleLines}`);
        }

        // Graph: Hubs
        if (graphData.hubs.length > 0) {
            const hubLines = graphData.hubs.map((h: any) =>
                `  - "${h.name || h.id}" (${h.degree} connections) — Label: ${h.label || 'Unknown'}`
            ).join('\n');
            sections.push(`## 🌐 Knowledge Hubs (Most Connected Concepts)\n${hubLines}`);
        }

        // Graph: User Facts
        if (graphData.userFacts.length > 0) {
            const factLines = graphData.userFacts.slice(0, 5).map(f =>
                `  - [${f.category}] ${f.content} (confidence: ${f.confidence}, source: ${(f as any).source || 'LEGACY'})`
            ).join('\n');
            sections.push(`## 👤 User Facts (STATED = the user said it, INFERRED = derived, unverified)\n${factLines}`);
        }

        // Errors
        if (errorData.errors.length > 0) {
            const errorLines = errorData.errors.map(e =>
                `  - ⚠️ ${e.message}`
            ).join('\n');
            sections.push(`## 🔴 Recent System Errors (${errorData.errors.length} in last 30 min)\n${errorLines}`);
        }

        // Memory
        sections.push(`## 🧠 Memory Status\n  - Working Memory: ${memoryData.pressure} nodes\n  - Total Memory: ${memoryData.total} nodes\n  - Deep Archive: ${memoryData.deepCount} vectors`);

        // Small-World Index
        if (graphData.smallWorldSigma > 0) {
            const status = graphData.smallWorldSigma > 1.0 ? 'Small-World ✓ (healthy information flow)' : 'Below Small-World (needs more cross-domain bridges)';
            sections.push(`## 🌐 Network Topology\n  - Small-World σ = ${graphData.smallWorldSigma.toFixed(3)} → ${status}`);
        }


        // Identity evidence: what dreams/curiosity/research surfaced about the entity itself
        if (identityEvidence) {
            const lines: string[] = [];
            for (const i of identityEvidence.intuitions) lines.push(`  - [DREAM INTUITION] ${i}`);
            for (const d of identityEvidence.discoveries) lines.push(`  - [CURIOSITY DISCOVERY] ${d}`);
            for (const g of identityEvidence.openGaps) lines.push(`  - [OPEN EPISTEMIC GAP] ${g}`);
            if (lines.length > 0) {
                sections.push(`## 🌙 Identity Evidence (dreams / curiosity / research — attribute, never claim as your own thought)\n${lines.join('\n')}`);
            }
        }

        return sections.join('\n\n');
    }
}

export const thoughtNarrator = new ThoughtNarrator();
