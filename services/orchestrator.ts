import { Agent, AgentStatus, AgentRoleType, Project, WorkflowStage, AgentCapability, SystemMode, BusinessType, AgentTier, AgentCategory, SystemProtocol, InterAgentMessage, Squad, ServiceStatus } from '../types';
import { sqliteService } from './sqliteService';
import { workflowEngine } from './workflowEngine';
import { INITIAL_AGENTS, KERNEL_COMPLEXITY_THRESHOLD } from "../constants";
import { systemBus, MessageTag, MessagePriority, EnhancedInterAgentMessage } from "./systemBus"; // [PA-041] Enhanced with Tagging
import * as si from 'systeminformation';
import { agentPersistence } from "./agentPersistence";
import { neuroLink } from "./neuroLinkService";
import { generateAgentResponse } from "./geminiService";
import { resourceArbiter } from "./resourceArbiter";
import { CommunicationLevel } from "../types";
import { capabilityRegistry } from "./capabilityRegistry"; // [DCR] Import
import { remediation } from "./remediationService";
import { continuum } from "./continuumMemory";
import { codebaseAwareness } from "./codebaseAwareness"; // Init Service
import { agentStreamer } from "./agentStream"; // NEW: Distributed Cognition
import { neuroSynapse } from "./neuroSynapseService"; // [PHASE 8] Evolutionary Loop
import { genesisService } from "./genesisService"; // [PHASE 8] Self-Replication
import { architecturalReview } from "./architecturalReview"; // [PHASE 6] Antifragility

import { monitoringService } from "./monitoringService";
import { powerManager } from "./powerManager"; // [OPTIMIZATION] Power mode control
import { agentFactory } from "./factory/AgentFactory"; // PA-038: Agent Evolution
import { toolRegistry } from "./tools/toolRegistry"; // Unified Capability Execution
import { toolExecutor } from "./tools/toolExecutor"; // Unified Capability Execution
import { enhancedCapabilityRegistry } from "./enhancedCapabilityRegistry"; // Unified Capability Execution
import { CapabilityResult, CapabilityContext, CapabilityExecutor } from "../types/capabilities"; // Unified Types
// Note: Video jobs are handled via schedulerService, not a separate worker

// [EVOLUTION] New services from Silhouette Evolution
import { continuousMemory } from "./memory/continuousMemory";
import { genesisV2 } from "./genesis/genesisV2";
import { agentConversation } from "./communication/agentConversation";
import { agentFileSystem } from "./agents/agentFileSystem";

// The "Swarm" Manager V5.0 (Actor Model Architecture)
// Manages persistent, asynchronous agents that hydrate/dehydrate based on demand.
// [PA-041] Enhanced with Message Tagging & Full Observability

/**
 * [PA-041] Message Statistics - Tracks message flow for observability
 */
interface MessageStats {
    total: number;
    byTag: Record<MessageTag, number>;
    byPriority: Record<MessagePriority, number>;
    lastHour: number;
}

/**
 * [PA-041] Active Task - Tracks tasks assigned to agents
 */
interface ActiveTask {
    taskId: string;
    agentId: string;
    squadId?: string;
    protocol: SystemProtocol;
    priority: MessagePriority;
    assignedAt: number;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
}

class AgentSwarmOrchestrator {
    // Active Actors in RAM (The "Stage")
    // OPTIMIZED: LRU Cache Implementation
    private activeActors: Map<string, Agent> = new Map();

    // Metadata for all known agents (The "Casting Sheet")
    private knownAgentIds: string[] = [];

    private squads: Squad[] = [];
    private currentMode: SystemMode = SystemMode.ECO;
    private currentBusinessPreset: BusinessType = 'GENERAL';
    private smartPagingEnabled: boolean = true; // Always on for Actor Model
    private lastSystemInteraction: number = Date.now();
    private mode24_7: boolean = false;
    private lastMonitorTime: number = 0;

    // [PA-041] Message Observability System
    private messageStats: MessageStats = {
        total: 0,
        byTag: {
            [MessageTag.USER_REQUEST]: 0,
            [MessageTag.AGENT_DELEGATION]: 0,
            [MessageTag.TRIGGER]: 0,
            [MessageTag.SYSTEM]: 0,
            [MessageTag.HELP_REQUEST]: 0,
            [MessageTag.REMEDIATION]: 0
        },
        byPriority: {
            [MessagePriority.CRITICAL]: 0,
            [MessagePriority.HIGH]: 0,
            [MessagePriority.NORMAL]: 0,
            [MessagePriority.LOW]: 0
        },
        lastHour: 0
    };

    // [PA-041] Active Task Queue - Full visibility into what's being worked on
    private activeTasks: Map<string, ActiveTask> = new Map();

    // Core Services State (Real Monitoring)
    private coreServices: ServiceStatus[] = [
        { id: 'api_gateway', name: 'API Gateway', port: 3000, status: 'ONLINE', latency: 0, uptime: 100 }, // Self
        { id: 'auth_server', name: 'Auth Server', port: 8082, status: 'UNKNOWN', latency: 0, uptime: 0 },
        { id: 'mcp_server', name: 'MCP Server', port: 8083, status: 'UNKNOWN', latency: 0, uptime: 0 },
        { id: 'webhook', name: 'Webhook Events', port: 8081, status: 'UNKNOWN', latency: 0, uptime: 0 },
        { id: 'planner', name: 'Planner / Orch', port: 8090, status: 'UNKNOWN', latency: 0, uptime: 0 },
        { id: 'intro_api', name: 'Introspection API', port: 8085, status: 'UNKNOWN', latency: 0, uptime: 0 },
        { id: 'ws_hub', name: 'Realtime WS', port: 8084, status: 'UNKNOWN', latency: 0, uptime: 0 },
        { id: 'openai', name: 'OpenAI API', url: 'https://api.openai.com', status: 'UNKNOWN', latency: 0, uptime: 0, port: 443 },
        { id: 'replicate', name: 'Replicate API', url: 'https://api.replicate.com', status: 'UNKNOWN', latency: 0, uptime: 0, port: 443 }
    ];


    constructor() {
        this.initializeSwarm();
        this.applyMode(SystemMode.ECO);

        // Listen for Expansion Protocols from the AI
        systemBus.subscribe(SystemProtocol.SQUAD_EXPANSION, (event) => {
            this.handleDynamicExpansion(event.payload);
        });

        // Listen for Async Task Assignments (e.g., Research Requests from Dreamer)
        systemBus.subscribe(SystemProtocol.TASK_ASSIGNMENT, (event) => {
            this.handleTaskAssignment(event.payload);
        });

        // --- CURIOSITY ENGINE LOGIC (V3: CLOSED LOOP) ---
        systemBus.subscribe(SystemProtocol.EPISTEMIC_GAP_DETECTED, (event) => {
            this.handleEpistemicGap(event.payload);
        });

        // Use TASK_COMPLETION to close the loop
        systemBus.subscribe(SystemProtocol.TASK_COMPLETION, (event) => {
            this.handleTaskCompletion(event.payload);
        });

        // --- INTERFACE OF COMMAND (PHASE 11) ---
        systemBus.subscribe(SystemProtocol.SQUAD_REASSIGNMENT, (event) => {
            this.handleSquadReassignment(event.payload);
        });

        // SENSORY
        systemBus.subscribe(SystemProtocol.SENSORY_SNAPSHOT, (event) => {
            // Forward visual info to agents if relevant
            console.log("[ORCHESTRATOR] 👁️ Visual Context Updated");
        });

        // --- INTER-AGENT HELP PROTOCOL ---
        // Allows team leaders to request help from other specialists
        systemBus.subscribe(SystemProtocol.HELP_REQUEST, (event) => {
            this.handleHelpRequest(event.payload);
        });

        // --- EMERGENCY BRAKE (CFO INTERVENTION) ---
        systemBus.subscribe(SystemProtocol.COST_ANOMALY, (event) => {
            if (event.payload.agentId && event.payload.cost) {
                this.handleCostAnomaly(event.payload.agentId, event.payload.cost);
            }
        });

        // --- DATA INTEGRITY (JANITOR INTERVENTION) ---
        systemBus.subscribe(SystemProtocol.DATA_CORRUPTION, (event) => {
            this.handleDataCorruption(event.payload);
        });

        // --- RESEARCH REQUEST HANDLER (DISCOVERY LEARNING LOOP) ---
        systemBus.subscribe(SystemProtocol.RESEARCH_REQUEST, (event) => {
            this.handleResearchRequest(event.payload);
        });

        // --- SYNTHESIS PIPELINE (RESEARCH SYNTHESIZER AGENT) ---
        systemBus.subscribe(SystemProtocol.SYNTHESIS_REQUEST, (event) => {
            this.handleSynthesisRequest(event.payload);
        });

        systemBus.subscribe(SystemProtocol.PAPER_GENERATION_REQUEST, (event) => {
            this.handlePaperGenerationRequest(event.payload);
        });

        // --- UNIFIED MESSAGING HANDLER (CHANNELS) ---
        // Handles messages from Telegram, WhatsApp, Discord via ChannelRouter
        systemBus.subscribe(SystemProtocol.USER_MESSAGE, (event) => {
            this.handleUserMessage(event.payload);
        });

        // ... (existing code)
    }

    // ...

    private async handleTaskCompletion(payload: any) {
        // Check if this was a Curiosity Mission
        if (payload.originalContext && payload.originalContext.source === 'DreamerService' && payload.originalContext.question) {
            console.log(`[ORCHESTRATOR] 🧩 Curiosity Missing Piece Found by ${payload.agentId}`);
            this.resolveCuriosity(payload);
        }
    }

    private async resolveCuriosity(payload: any) {
        const { result, originalContext } = payload;
        const question = originalContext.question;

        // 1. Synthesize the Answer (Extract from Agent Output)
        // In a real system, we might use an LLM here to summarize. 
        // For now, we trust the agent's output is relevant.

        // 2. Update Graph (Close the Mystery Box)
        try {
            const { graph } = await import('./graphService');
            // 'RESOLVES' is not in standard ontology, so we use IMPLIES with verification property.

            await graph.createDiscoveryRelationship('CURIOSITY_COUNCIL', 'FACT', 'IMPLIES', 1.0, "Resolved: " + question);

            console.log(`[ORCHESTRATOR] ✅ Mystery "${question.substring(0, 30)}..." marked as RESOLVED.`);

        } catch (e) {
            console.error("[ORCHESTRATOR] Failed to resolve curiosity in graph:", e);
        }
    }

    // [ROBUSTNESS] Service-to-Agent Liveness Binding
    // Maps physical infrastructure services (Ports/Processes) to Virtual Agents.
    private serviceAgentMap: Record<string, string> = {
        'api_gateway': 'core-01',   // Express Server -> Orchestrator Prime
        'planner': 'strat-01',      // Planner Service -> Strategos X
        'intro_api': 'ctx-01',      // Introspection API -> The Librarian
        'ws_hub': 'core-01',        // Websocket Hub -> Shared with Core
    };

    private syncServiceToAgents() {
        this.coreServices.forEach(service => {
            if (service.status === 'ONLINE') {
                const agentId = this.serviceAgentMap[service.id];
                if (agentId) {
                    // Update Active Actor in RAM
                    if (this.activeActors.has(agentId)) {
                        const agent = this.activeActors.get(agentId)!;
                        agent.lastActive = Date.now();
                        // Also force status to WORKING if it was IDLE? 
                        // No, let it be IDLE but "Alive". 
                        // Actually, if the service IS running, the agent is technically 'WORKING' or 'AVAILABLE'.
                        // But let's just update the heartbeat to prevent Dehydration/Zombie status.
                    } else {
                        // If Service is ONLINE but Agent is OFFLINE, we should probably wake it up?
                        // For now, let's just log. Resurrections happen via hydration.
                        // console.debug(`[ORCHESTRATOR] Service ${service.name} is ONLINE but Agent ${agentId} is sleeping.`);
                    }
                }
            }
        });
    }



    // [PHASE 10] Adaptive Heartbeat
    private heartbeatInterval: number = 10000;
    private minHeartbeat: number = 5000; // [OPTIMIZED] Was 1000ms
    private maxHeartbeat: number = 60000; // [OPTIMIZED] Was 10000ms

    private adjustHeartbeat(): void {
        const activeCount = this.activeTasks.size;

        if (activeCount > 0) {
            this.heartbeatInterval = this.minHeartbeat;
        } else {
            // Decelerate if idle
            this.heartbeatInterval = Math.min(this.heartbeatInterval + 500, this.maxHeartbeat);
        }
    }

    private startLoop() {
        const loop = async () => {
            try {
                // [PHASE 10] Adaptive Speed
                this.adjustHeartbeat();

                await this.tick();
            } catch (e) {
                console.error("[ORCHESTRATOR] Tick Error:", e);
            }
            // Schedule next tick dynamically
            setTimeout(loop, this.heartbeatInterval);
        };
        loop();
    }

    public async tick() {
        // 0. Monitor Services (Every 30s)
        const now = Date.now();
        if (now - this.lastMonitorTime > 30000) {
            this.lastMonitorTime = now;
            this.coreServices = await monitoringService.checkAll(this.coreServices);

            // [ROBUSTNESS] Sync Service Health to Agent Heartbeats
            // This ensures that if the underlying microservice is alive, the Virtual Agent remains alive.
            this.syncServiceToAgents();
        }

        // 1. Dehydrate Idle Agents (Memory Management)
        this.pruneAgents();

        // 2. Run Continuum Memory Maintenance (Decay & Promotion)
        continuum.runMaintenance();

        // 3. Persist State (Throttled)
        // Only save if significant changes or every N ticks?
        // For now, let's rely on event-based persistence (when agents change state)
        // rather than loop-based persistence to save IO.

        // 4. Global Inbox Processing (Universal Communication)
        if (now % 3000 < 500) { // Every 3 seconds
            await this.processGlobalMail();
        }


        // 4. Poll Service-Based Skills (Hybrid Architecture)
        // [PA-011] Creative Director is a Service-Skill, so we poll its inbox manually here
        // In a pure actor model, the agentStreamer would handle this, but CD is 'Headless' TS logic for now.
        if (now % 5000 < 1000) { // Every 5s
            import('./skills/creativeDirectorSkill').then(({ creativeDirector }) => {
                creativeDirector.checkInbox();
            }).catch(e => console.error("Failed to poll CreativeDirector:", e));
        }

        // 5. Circadian Rhythm (Auto-Sleep Protocol)
        await this.assessSystemState(now);
    }

    private lastActivityTime = Date.now();
    private readonly AUTO_SLEEP_THRESHOLD = 5 * 60 * 1000; // 5 Minutes Idle
    private lastSleepCycleTime = 0; // [ROBUSTNESS] Prevent Sleep Loop

    // [NEW] Circadian Rhythm
    private async assessSystemState(now: number) {
        // If system is BUSY or already Sleeping, do nothing
        if (this.currentMode === SystemMode.ULTRA) return; // Never sleep in ULTRA

        // [ROBUSTNESS] Cooldown: Don't sleep if we just woke up (1 Hour Cooldown)
        if (now - this.lastSleepCycleTime < 60 * 60 * 1000) return;

        // Check global activity (simple check: last interaction)
        // In a real system, we'd check mouse/keyboard or API request rates.
        const isIdle = (now - this.lastSystemInteraction) > this.AUTO_SLEEP_THRESHOLD;

        if (isIdle) {
            // Check if we have "New Memories" pending integration?
            // For now, simple time-based.

            // Check if training service is already running
            const { trainingService } = await import('./training/trainingService');
            if (!trainingService.isBusy()) {
                console.log("[ORCHESTRATOR] 🌙 System Drowsiness Detected. Initiating Sleep Cycle...");
                this.lastSleepCycleTime = now;

                // Trigger Sleep Protocol
                const { actionExecutor } = await import('./actionExecutor');
                await actionExecutor.execute({
                    id: `sleep-${now}`,
                    agentId: 'system-circadian',
                    type: SystemProtocol.TRAINING_START as any, // Cast for ActionType compat
                    payload: {},
                    status: 'PENDING',
                    timestamp: now,
                    requiresApproval: false
                });

                // Update activity to prevent duplicate triggers immediately
                this.lastSystemInteraction = now;
            }
        }
    }

    private async processGlobalMail() {
        // [SMART SCHEDULER]
        // Prevent system saturation by limiting concurrent active agents.
        // If we are at capacity, we leave messages in the inbox (Queue) for later.

        const MAX_CONCURRENT_AGENTS = 5; // Configurable based on VRAM (e.g., 4GB = Low)
        const currentLoad = this.activeActors.size;

        if (currentLoad >= MAX_CONCURRENT_AGENTS) {
            // Optional: Check if we can dehydrate idle agents to make room?
            // For now, simpler: Just skip waking up new ones.
            // console.debug("[ORCHESTRATOR] 🚦 System at capacity. Messages queued.");
            return;
        }

        const agentsToCheck = this.knownAgentIds;

        for (const agentId of agentsToCheck) {
            // Skip if already at limit mid-loop
            if (this.activeActors.size >= MAX_CONCURRENT_AGENTS && !this.activeActors.has(agentId)) {
                continue;
            }

            // Check if has mail
            const hasMail = await systemBus.hasMail(agentId);
            if (hasMail) {
                // Special Handling for Service-Based Agents (Headless)
                if (agentId === 'mkt-lead') {
                    // Service agents don't count towards VRAM limit (mostly)
                    import('./skills/creativeDirectorSkill').then(({ creativeDirector }) => {
                        creativeDirector.checkInbox();
                    });
                    continue;
                }

                console.log(`[ORCHESTRATOR] 📬 Mail detected for ${agentId}. Waking up...`);

                // Standard LLM Agents
                await this.hydrateAgent(agentId);
                const agent = this.activeActors.get(agentId);

                if (agent) {
                    const messages = await systemBus.checkMailbox(agentId);
                    if (messages.length > 0) {
                        console.log(`[ORCHESTRATOR] 📨 Delivering ${messages.length} letters to ${agent.name}`);
                        for (const msg of messages) {
                            agentStreamer.handleIncomingMessage(agent, msg);
                        }
                    }
                }
            }
        }
    }

    private async handleCostAnomaly(agentId: string, cost: number) {
        console.log(`[ORCHESTRATOR] 🚨 EMERGENCY BRAKE: Freezing Agent ${agentId} (Cost Spike: $${cost})`);

        // 1. Freeze Agent
        const agent = this.activeActors.get(agentId); // Changed from this.agents.find to this.activeActors.get
        if (agent) {
            agent.status = AgentStatus.CRITICAL; // Changed from HIBERNATED
            // Removed agent.enabled = false; and await this.saveAgents(); as they are not in the original context
        }

        // 2. Trigger Remediation Squad (Financial/Resource Crisis)
        // Using the already imported 'remediation' service
        await remediation.mobilizeSquad(agentId, [
            `Cost Spike Detected: $${cost}`,
            `Possible Infinite Loop`,
            `Resource Exhaustion`
        ]);
    }

    private async handleDataCorruption(payload: any) {
        console.log(`[ORCHESTRATOR] 🦠 DATA CORRUPTION DETECTED: ${payload.details}`);

        // Trigger Remediation Squad (Data Integrity Crisis)
        const { remediation } = await import('./remediationService');
        await remediation.mobilizeSquad('JANITOR_SYSTEM', [
            `Data Corruption Detected by Janitor`,
            `Error: ${payload.details}`,
            `Node ID: ${payload.nodeId}`,
            `Severity: HIGH - Potential Data Loss`
        ]);
    }
    // --- PHASE 13: AUTONOMOUS ACTION HANDLER ---
    private async handleAutonomousAction(action: any) {
        // Dynamic Import to avoid circular dependency
        const { actionExecutor } = await import('./actionExecutor');

        console.log(`[ORCHESTRATOR] 🦾 Processing Action Intent from ${action.agentId}: ${action.type}`);

        // 1. Validation (Sage Mode Checks)
        // In V1, we only allow 'SYSTEM' or high-tier agents to trigger actions
        // Could call 'resourceArbiter' or 'securityJanitor' here.

        // 2. Execution
        const result = await actionExecutor.execute(action);

        // 3. Feedback Loop (Closing the Circle)
        if (result.success) {
            console.log(`[ORCHESTRATOR] ✅ Action Success: ${JSON.stringify(result.data)}`);
        } else {
            console.error(`[ORCHESTRATOR] ❌ Action Failed: ${result.error}`);
        }

        // EMIT OBSERVATION TO INTROSPECTION ENGINE
        const observationText = result.success
            ? `[ACTION_OBSERVATION] ✅ SUCCESS: ${action.type} executed. Data: ${JSON.stringify(result.data)}`
            : `[ACTION_OBSERVATION] ❌ FAILURE: ${action.type} failed. Error: ${result.error}`;

        // We emit this as a 'THOUGHT_EMISSION' but tagged as 'OBSERVATION'
        // Ideally, we'd have a specific PROTOCOL_OBSERVATION, but THOUGHT works for now if sourced correctly.
        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
            thoughts: [observationText],
            source: 'ACTION_EXECUTOR' // New source type
        });
    }

    // --- RESEARCH REQUEST HANDLER (DISCOVERY LEARNING LOOP) ---
    private async handleResearchRequest(payload: any) {
        console.log(`[ORCHESTRATOR] 🔬 Research Request received (Type: ${payload.type || 'VALIDATION'})`);

        // [BIOMIMETIC] Route Uncertainty Scans to the Librarian
        if (payload.type === 'UNCERTAINTY_SCAN') {
            return this.conductEpistemicScan(payload);
        }

        console.log(`[ORCHESTRATOR] 🔬 Research Request received for: ${payload.sourceId}`);

        try {
            const { discoveryJournal } = await import('./discoveryJournal');
            const { conductResearch, generateCitation } = await import('./researchTools');
            const { generateText } = await import('./geminiService');
            const { neuroCognitive } = await import('./neuroCognitiveService');

            const hypothesis = payload.hypothesis || 'Investigate this connection';
            const candidates = payload.candidates || [];

            if (candidates.length === 0) {
                console.log('[ORCHESTRATOR] ⚠️ No candidates in research request');
                return;
            }

            const targetNode = candidates[0]?.target_node;

            // 1. CONDUCT REAL RESEARCH using web and academic sources
            console.log(`[ORCHESTRATOR] 🔍 Searching for evidence: "${hypothesis}"`);
            const researchData = await conductResearch(hypothesis, { web: true, academic: true, maxResults: 3 });

            // 2. Build context from research results
            let evidenceContext = '';

            if (researchData.webResults.length > 0) {
                evidenceContext += '\n\n**Web Sources:**\n';
                researchData.webResults.forEach((r, i) => {
                    evidenceContext += `${i + 1}. ${r.title} (${r.source}): ${r.snippet.substring(0, 200)}...\n`;
                });
            }

            if (researchData.academicPapers.length > 0) {
                evidenceContext += '\n\n**Academic Papers:**\n';
                researchData.academicPapers.forEach((p, i) => {
                    evidenceContext += `${i + 1}. ${p.title} (${p.year}, cited ${p.citationCount}x): ${p.abstract?.substring(0, 200)}...\n`;
                });
            }

            // 3. Use LLM to analyze evidence
            const researchPrompt = `
You are a scientific research assistant validating a hypothesis.

SOURCE CONCEPT: ${payload.sourceId}
TARGET CONCEPT: ${targetNode}
HYPOTHESIS: ${hypothesis}

EVIDENCE FROM RESEARCH:
${evidenceContext || 'No external evidence found.'}

Based on the evidence above, determine:
1. Is this connection valid and meaningful?
2. What is the nature of this relationship?
3. Does the evidence support or refute the hypothesis?

Respond with:
ANALYSIS: [2-3 sentence analysis citing evidence]
CONFIDENCE: [0.0-1.0]
VERDICT: [VALID/INVALID/INSUFFICIENT_EVIDENCE]
`;

            const researchResult = await generateText(researchPrompt);
            console.log(`[ORCHESTRATOR] 📚 Analysis completed: ${researchResult?.substring(0, 150)}...`);

            // 4. Parse result
            const confidenceMatch = researchResult?.match(/CONFIDENCE:\s*([\d.]+)/i);
            const verdictMatch = researchResult?.match(/VERDICT:\s*(\w+)/i);

            const newConfidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
            const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'UNKNOWN';

            // 5. Update journal with research outcome and citations
            const hasCitations = researchData.academicPapers.length > 0 || researchData.webResults.length > 0;

            if (verdict === 'VALID' && newConfidence >= 0.7) {
                discoveryJournal.updateOutcome(payload.sourceId, targetNode, 'ACCEPTED');
                console.log(`[ORCHESTRATOR] ✅ Research confirms with evidence: ${payload.sourceId} → ${targetNode}`);

                // Log citations if available
                if (researchData.academicPapers.length > 0) {
                    const citation = generateCitation(researchData.academicPapers[0], 'APA');
                    console.log(`[ORCHESTRATOR] 📖 Primary citation: ${citation.text}`);
                }

                // Re-trigger discovery to create the relationship
                await neuroCognitive.triggerDiscoveryCycle(payload.sourceId);
            } else if (verdict === 'INVALID' || newConfidence < 0.3) {
                discoveryJournal.updateOutcome(payload.sourceId, targetNode, 'REJECTED');
                console.log(`[ORCHESTRATOR] ❌ Research rejects: ${payload.sourceId} → ${targetNode}`);
            } else {
                // Still uncertain, keep as pending
                console.log(`[ORCHESTRATOR] 🔄 Research inconclusive (${hasCitations ? 'has citations' : 'no citations'}), keeping pending`);
            }

        } catch (error) {
            console.error('[ORCHESTRATOR] Research request failed:', error);
        }
    }

    /**
     * [BIOMIMETIC] Epistemic Scan - Proactively finds "Uncertainty Gaps" in knowledge.
     * Routes to 'The_Librarian' (ctx-01) for deep memory analysis.
     */
    private async conductEpistemicScan(payload: any) {
        console.log("[ORCHESTRATOR] 🧠 Starting Epistemic Scan (Curiosity Protocol)...");

        try {
            const agentId = 'ctx-01'; // The Librarian
            await this.hydrateAgent(agentId);
            const librarian = this.activeActors.get(agentId)!;

            // Build curiosity prompt
            const prompt = `
[EPISTEMIC_SCAN_MODE]
Analyze your current cognitive state and the existing knowledge graph. 
Identify 3 specific "Uncertainty Gaps" or "Mystery Boxes" where we lack sufficient data to make a connection.

Format each gap as:
- GAP: [What we don't know]
- WHY: [Why it matters]
- TARGET: [Potential agent or tool to resolve it]
`.trim();

            const { generateAgentResponse } = await import('./geminiService');

            const response = await generateAgentResponse(
                librarian.name,
                librarian.role,
                librarian.category,
                prompt,
                null,
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                librarian.capabilities || [],
                CommunicationLevel.INTERNAL_MONOLOGUE
            );

            console.log(`[ORCHESTRATOR] 🧩 Librarian discovered potential gaps: ${response.output.substring(0, 100)}...`);

            // [FUTURE] Send discovered gaps to a curiosity pool for potential agent spawning.
            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                thoughts: ["I have discovered new areas for exploration. Internal knowledge expansion queued."]
            }, 'ORCHESTRATOR');

        } catch (e) {
            console.error("[ORCHESTRATOR] Epistemic scan failed:", e);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SYNTHESIS PIPELINE (Via Research_Synthesizer Agent)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Handle synthesis request - routes to Research_Synthesizer agent
     */
    private async handleSynthesisRequest(payload: any) {
        console.log(`[ORCHESTRATOR] 🧬 Synthesis Request received`);

        try {
            // 1. Find Research_Synthesizer agent via DCR (capability registry)
            const providerIds = capabilityRegistry.findProviders(['CAP_SYNTHESIS' as any]);
            let synthesizerAgentId = providerIds.length > 0 ? providerIds[0] : null;

            if (!synthesizerAgentId) {
                // Fallback: Try to find by name
                const allAgents = this.getAgents();
                const synthesizer = allAgents.find(a => a.id === 'Research_Synthesizer' || a.name === 'Research Synthesizer');
                synthesizerAgentId = synthesizer?.id || null;
            }

            // Import synthesis service
            const { synthesisService } = await import('./synthesisService');

            console.log(`[ORCHESTRATOR] 🧬 Agent assigned: ${synthesizerAgentId || 'SYSTEM_FALLBACK'}`);

            // Execute synthesis
            const insight = await synthesisService.synthesizeFromRecent({
                minDiscoveries: payload.minDiscoveries || 3,
                includeResearch: payload.includeResearch ?? true,
                domain: payload.domain
            });

            if (insight) {
                // Emit completion event with data as third param
                systemBus.emit(SystemProtocol.SYNTHESIS_COMPLETE, {
                    success: true,
                    insight,
                    agentId: synthesizerAgentId || 'SYSTEM_FALLBACK'
                }, 'ORCHESTRATOR');
                console.log(`[ORCHESTRATOR] ✅ Synthesis complete: "${insight.title}"`);
            } else {
                console.warn('[ORCHESTRATOR] ⚠️ No insight generated');
            }

        } catch (error) {
            console.error('[ORCHESTRATOR] Synthesis request failed:', error);
        }
    }

    /**
     * Handle paper generation request - generates paper from insight
     */
    // --- PAPER GENERATION ---
    private async handlePaperGenerationRequest(payload: any) {
        console.log(`[ORCHESTRATOR] 📝 Paper Generation Request for insight: ${payload.insightId}`);
        // ... implementation (kept same) ...
        try {
            const { paperGenerator } = await import('./paperGenerator');
            const { synthesisService } = await import('./synthesisService');

            // Get insight by ID or use most recent
            let insight = payload.insightId
                ? synthesisService.getInsight(payload.insightId)
                : synthesisService.getInsightsForPaper(0.7)[0];

            if (!insight) {
                console.warn('[ORCHESTRATOR] ⚠️ No insight available for paper generation');
                return;
            }

            // Generate paper
            const paper = await paperGenerator.generateFromInsight(insight, {
                format: payload.format || 'markdown',
                authors: payload.authors || ['Silhouette AI Research'],
                includeMethodology: payload.includeMethodology ?? true
            });

            // Run peer review if requested
            if (payload.peerReview !== false) {
                await paperGenerator.peerReview(paper.id);
            }

            // Emit completion event
            systemBus.emit(SystemProtocol.PAPER_GENERATION_COMPLETE, {
                success: true,
                paper,
                path: `output/papers/${paper.id}.${paper.format === 'latex' ? 'tex' : 'md'}`
            }, 'ORCHESTRATOR');

            console.log(`[ORCHESTRATOR] ✅ Paper generated: ${paper.title}`);

        } catch (error) {
            console.error('[ORCHESTRATOR] Paper generation failed:', error);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // UNIFIED MESSAGING LOGIC (Telegram, WhatsApp, etc.)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Handles incoming user messages from ChannelRouter
     */
    public async handleUserMessage(payload: any) {
        // payload: { sessionId, message, channel, chatId, senderId, senderName ... }
        console.log(`[ORCHESTRATOR] 📩 Processing User Message from ${payload.channel} (${payload.senderName || payload.senderId})`);

        try {
            // [EVOLUTION] WAL: Log BEFORE processing for crash recovery
            const walId = continuousMemory.logBeforeProcessing(
                'core-01',
                'MESSAGE_RECEIVED',
                { input: payload.message, sessionId: payload.sessionId }
            );

            // 1. Initial "Thinking" feedback for improved UX
            const { channelRouter } = await import('../server/channels/channelRouter');
            const thinkingMessageId = `think-${Date.now()}`;

            // Send initial ripple if the channel supports it (Telegram shows "typing...")
            await channelRouter.send(payload.channel, {
                chatId: payload.chatId,
                text: "_Silhouette is thinking..._" // Markdown italic for internal feel
            });

            // 2. Determine Agent, Complexity & Hydrate
            const complexityInfo = await this.analyzeComplexity(payload.message);
            let agentId = complexityInfo.suggestedAgentId || 'core-01';

            // [BIOMIMETIC] Check if complexity exceeds Kernel Capacity
            if (complexityInfo.score > KERNEL_COMPLEXITY_THRESHOLD) {
                console.log(`[ORCHESTRATOR] 🚀 Task complexity (${complexityInfo.score}) exceeds Kernel capacity. Spawning expert...`);
                const spawnedAgent = await agentFactory.spawnForTask(payload.message);
                if (spawnedAgent) {
                    agentId = spawnedAgent.id;
                    // Register the spawned agent for the session
                    if (!this.knownAgentIds.includes(agentId)) {
                        this.knownAgentIds.push(agentId);
                        agentPersistence.saveAgent(spawnedAgent);
                    }
                }
            }

            await this.hydrateAgent(agentId);
            const agent = this.activeActors.get(agentId)!;

            // 3. Gather Context (History + Documentation Sync)
            const { sessionManager } = await import('../server/gateway/sessionManager');
            const { documentationSync } = await import('./documentationSyncService');

            const session = sessionManager.getSession(payload.sessionId);
            const history = session ? session.messages : [];

            // Get synchronized documentation context
            const docContext = await documentationSync.getSystemContext();

            // Format history
            const historyText = history.slice(-12).map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

            // Build full prompt with documentation context
            // [EVOLUTION] Use per-agent file system for rich identity (SOUL, IDENTITY, TOOLS)
            const richIdentity = agentFileSystem.buildSystemPrompt(agentId, {
                includeMemory: true,
                includeHeartbeat: false,
                includeUser: true,
                maxMemoryLines: 30
            });

            // Fallback to basic identity if no file system context
            const identityContext = richIdentity
                ? `\n--- YOUR IDENTITY ---\n${richIdentity}\n`
                : (agent.tier === AgentTier.WORKER
                    ? `\n--- YOUR CURRENT IDENTITY ---\nYou are: ${agent.name}\nRole: ${agent.role}\nDirectives: ${agent.directives?.join(', ') || 'Execute the task efficiently.'}\nOpinion: ${agent.opinion}\n`
                    : '');

            const fullPrompt = `
${docContext}
${identityContext}

--- CONVERSATION HISTORY ---
${historyText}

--- CURRENT REQUEST ---
${payload.message}
            `.trim();

            // 4. Generate Response (with tool configuration)
            const { chatToolIntegration } = await import('./chatToolIntegration');
            const tools = await toolRegistry.getToolDeclarations();

            const response = await generateAgentResponse(
                agent.name,
                agent.role,
                agent.category,
                fullPrompt,
                null,
                undefined,
                undefined,
                { useWebSearch: true },
                {},
                agent.capabilities || [],
                CommunicationLevel.USER_FACING
            );

            // 5. Process Tool Calls and Parallel Operations
            let finalOutput = response.output;
            let outboundMedia: any[] = [];

            if (chatToolIntegration.hasToolCalls(finalOutput)) {
                console.log(`[ORCHESTRATOR] 🛠️ Executing specialized tools...`);
                const { enhancedResponse, toolResults } = await chatToolIntegration.processToolCalls(finalOutput);
                finalOutput = enhancedResponse;

                // Extract media from results
                for (const res of toolResults) {
                    if (res.success && res.result) {
                        const data = res.result;
                        if (data.url && (data.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) || res.toolName === 'generate_image')) {
                            outboundMedia.push({ type: 'image', url: data.url, caption: data.message || `Generated by ${res.toolName}` });
                        } else if (data.url && (data.url.match(/\.(mp4|mov|webm)$/i) || res.toolName === 'generate_video')) {
                            outboundMedia.push({ type: 'video', url: data.url, caption: data.message || `Video by ${res.toolName}` });
                        }
                    }
                }
            }

            // 6. Final Reply
            await channelRouter.send(payload.channel, {
                chatId: payload.chatId,
                text: finalOutput,
                media: outboundMedia.length > 0 ? outboundMedia : undefined
            });

            console.log(`[ORCHESTRATOR] 📤 Sent reply to ${payload.channel}`);

            // [EVOLUTION] WAL: Commit after successful processing
            continuousMemory.commitEntry(walId, finalOutput);

        } catch (error: any) {
            console.error(`[ORCHESTRATOR] ❌ Message handling error:`, error);
            // Notify transition error via same channel
            const { channelRouter } = await import('../server/channels/channelRouter');
            await channelRouter.send(payload.channel, {
                chatId: payload.chatId,
                text: `⚠️ I encountered an internal error: ${error.message}`
            });
        }
    }

    private async analyzeComplexity(message: string): Promise<{ score: number; suggestedAgentId: string }> {
        console.log(`[ORCHESTRATOR] 🧠 Analyzing complexity of intent...`);

        const prompt = `
Analyze the following user request and determine its technical/conceptual complexity.
Determine if it can be handled by one of our core "Kernel" agents or if it requires a specialist.

REQUEST: "${message}"

CORE AGENTS (The Kernel):
- core-01: Orchestrator Prime (General tasks, coordination)
- core-02: Intent Analyzer (Planning, complex multi-step analysis)
- core-03: Workflow Architect (System changes, code refactoring)
- ctx-01: The Librarian (Search, documentation, history)

OUTPUT RULES:
- SCORE: 0.0 (Simple chat) to 1.0 (Highly technical, multi-file code change, complex research)
- AGENT: Which of the 4 CORE IDs above fits best?

JSON ONLY:
{ "score": 0.45, "suggestedAgentId": "core-01", "reason": "..." }
`.trim();

        try {
            const { backgroundLLM } = await import('./backgroundLLMService');
            const analysis = await backgroundLLM.generate(prompt, { taskType: 'ANALYSIS' });
            const jsonMatch = analysis.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.warn("[ORCHESTRATOR] Complexity analysis failed. Fallback to base kernel.");
        }
        return { score: 0.3, suggestedAgentId: 'core-01' };
    }

    // --- DYNAMIC EXPANSION PROTOCOL ---
    private handleDynamicExpansion(payload: any) {
        // [PA-045] Robust Payload Handling (Handle potential double-wrapping)
        const name = (payload.name || payload.payload?.name || "Unknown Squad");
        console.log(`[ORCHESTRATOR] Executing Expansion Protocol: ${name} `);

        const newSquadId = `SQ_DYN_${Date.now()} `;
        const leaderId = `agt_dyn_${Date.now()} `;

        // Create new agent dynamically
        const leader: Agent = {
            id: leaderId,
            name: `${payload.name} Lead`,
            teamId: newSquadId,
            category: payload.category,
            roleType: AgentRoleType.LEADER,
            role: payload.role,
            status: AgentStatus.WORKING,
            enabled: true,
            memoryLocation: 'VRAM',
            cpuUsage: 10,
            ramUsage: 100,
            lastActive: Date.now(),
            tier: AgentTier.SPECIALIST,
            preferredMemory: 'RAM'
        };

        // Persist immediately
        agentPersistence.saveAgent(leader);
        capabilityRegistry.registerAgent(leader); // [DCR] Register new agent's capabilities
        this.knownAgentIds.push(leaderId);
        this.hydrateAgent(leaderId); // Wake up immediately

        this.squads.unshift({
            id: newSquadId,
            name: name.toUpperCase(),
            leaderId: leaderId,
            members: [leaderId],
            category: payload.category,
            active: true,
            port: 9000 + this.squads.length
        });

        // Notify System
        systemBus.emit(SystemProtocol.UI_REFRESH, { source: 'ORCHESTRATOR', message: 'Swarm Topology Updated' });
    }

    public setSmartPaging(enabled: boolean) {
        this.smartPagingEnabled = enabled;
    }

    private initializeSwarm() {
        // 0. Load Configuration from Persistence (DB)
        const config = sqliteService.getConfig('activeCategories');
        if (config && Array.isArray(config)) {
            this.setCategories(config);
            console.log(`[ORCHESTRATOR] Loaded ${config.length} active categories from DB.`);
        }

        // [EVOLUTION] Initialize Continuous Memory (WAL + crash recovery)
        try {
            continuousMemory.initialize();
        } catch (err) {
            console.error('[ORCHESTRATOR] Continuous Memory init failed (non-fatal):', err);
        }

        // 1. Check if DB exists, if not, use Genesis V2
        const existingIds = agentPersistence.getAllAgentIds();

        if (existingIds.length === 0) {
            console.log("[ORCHESTRATOR] First Run: Executing Genesis V2 Protocol...");
            // Genesis V2 is async but we fire-and-forget here since it doesn't block
            genesisV2.execute().then(report => {
                if (report.success) {
                    console.log(`[ORCHESTRATOR] Genesis V2 complete: ${report.agentsCreated.length} agents born.`);
                    this.knownAgentIds = agentPersistence.getAllAgentIds();
                    this.generateSquadsStructureOnly();
                } else {
                    console.error('[ORCHESTRATOR] Genesis V2 had failures, falling back to legacy...');
                    this.generateInitialAgents();
                }
            }).catch(() => {
                console.error('[ORCHESTRATOR] Genesis V2 crashed, falling back to legacy...');
                this.generateInitialAgents();
            });
        } else {
            console.log(`[ORCHESTRATOR] Loaded ${existingIds.length} persistent agents from disk.`);
            this.knownAgentIds = existingIds;

            // [EVOLUTION] Migrate existing agents to per-agent file system (idempotent)
            try {
                agentPersistence.migrateAllToFileSystem();
            } catch (err) {
                console.error('[ORCHESTRATOR] File system migration failed (non-fatal):', err);
            }
        }

        // [CRITICAL FIX] Always reconstruct squads, even after Genesis
        this.generateSquadsStructureOnly();

        // [DCR] Re-register capabilities from loaded agents
        // [EVOLUTION] Also register agents in conversation system
        this.knownAgentIds.forEach(id => {
            const agent = agentPersistence.loadAgent(id);
            if (agent) {
                capabilityRegistry.registerAgent(agent);
                agentConversation.registerAgent(agent);
            }
        });
    }

    private generateInitialAgents() {
        this.runGenesisMigration();
    }

    private runGenesisMigration() {
        console.log("[ORCHESTRATOR] 🌱 Initializing Biomimetic Kernel (The Seed)...");
        // INITIAL_AGENTS now contains ONLY the Kernel agents (Core + Librarian)
        const swarm = INITIAL_AGENTS.map(a => ({
            ...a,
            memoryLocation: 'DISK' as any,
            tier: AgentTier.CORE,
            preferredMemory: 'VRAM' as any
        }));

        swarm.forEach(agent => {
            agentPersistence.saveAgent(agent);
            this.knownAgentIds.push(agent.id);
        });

        console.log(`[ORCHESTRATOR] ✅ Kernel Initialization Complete. ${swarm.length} core agents persisted.`);
    }

    // [DEAD CODE REMOVED]

    private generateSquadsStructureOnly() {
        console.log("[ORCHESTRATOR] 🏗️ Reconstructing Squads from Persistent Memory...");

        // 1. Define Base Squad Structure (The skeletons)
        // Ideally this should also be persisted, but for now we reconstruct the 'teams' 
        // and populate them with the agents we actually have on disk.

        // Use the same definitions as Genesis, but empty members
        this.squads = [
            { id: 'TEAM_CORE', name: 'Orchestration Command', leaderId: 'core-01', members: [], category: 'CORE', active: true, port: 8000 },
            { id: 'TEAM_STRATEGY', name: 'Strategic Planning HQ', leaderId: 'strat-01', members: [], category: 'OPS', active: false, port: 8001 },
            { id: 'TEAM_CONTEXT', name: 'Context Transcendence', leaderId: 'ctx-01', members: [], category: 'DATA', active: false, port: 8002 },
            { id: 'TEAM_OPTIMIZE', name: 'Workflow Optimizer', leaderId: 'opt-01', members: [], category: 'OPS', active: false, port: 8003 },
            { id: 'TEAM_QA', name: 'The Inquisitors (QA)', leaderId: 'qa-01', members: [], category: 'OPS', active: false, port: 8004 },
            { id: 'TEAM_FIX', name: 'The Mechanics (Fix)', leaderId: 'fix-01', members: [], category: 'DEV', active: false, port: 8005 },
            { id: 'TEAM_SCIENCE', name: 'Innovation Labs', leaderId: 'sci-01', members: [], category: 'SCIENCE', active: false, port: 8006 }
        ];

        // Re-add Domain Squads (Dynamic Ones)
        // We scan the known agents to find Squads that might not be in the hardcoded list
        // This effectively 'discovers' dynamically created squads.

        const allAgents: Agent[] = [];
        this.knownAgentIds.forEach(id => {
            const agent = agentPersistence.loadAgent(id);
            if (agent) {
                allAgents.push(agent);

                // 2. Assign to relevant squad
                let squad = this.squads.find(s => s.id === agent.teamId);

                // If squad doesn't exist (Dynamic Squad), create it implicitly if possible
                // or restore it if we know the naming convention.
                if (!squad) {
                    // Check if it looks like a Dynamic Squad
                    if (agent.teamId.startsWith('SQ_')) {
                        // Attempt to reconstruct dynamic squad metadata
                        // Name is harder to guess, but we can try.
                        squad = {
                            id: agent.teamId,
                            name: agent.teamId.replace('SQ_', '').replace(/_/g, ' '), // Fallback name
                            leaderId: agent.roleType === AgentRoleType.LEADER ? agent.id : '', // Temp
                            members: [],
                            category: agent.category,
                            active: false,
                            port: 0 // Assign dynamically if needed
                        };
                        this.squads.push(squad);
                    }
                }

                if (squad) {
                    squad.members.push(agent.id);
                    // Ensure leader is correct if this agent claims to be leader
                    if (agent.roleType === AgentRoleType.LEADER && (!squad.leaderId || squad.leaderId !== agent.id)) {
                        squad.leaderId = agent.id;
                    }
                }
            }
        });

        console.log(`[ORCHESTRATOR] ✅ Reconstructed ${this.squads.length} squads from ${allAgents.length} agents.`);
    }

    // --- ACTOR LIFECYCLE MANAGEMENT ---


    public getAgent(agentId: string): Agent | undefined {
        // First check active actors
        if (this.activeActors.has(agentId)) {
            return this.activeActors.get(agentId);
        }
        // Then check cache
        if (this.agentCache.has(agentId)) {
            return this.agentCache.get(agentId);
        }
        // Finally, load from persistence
        const agent = agentPersistence.loadAgent(agentId);
        if (agent) {
            this.agentCache.set(agentId, agent);
        }
        return agent;
    }

    /**
     * Register an agent immediately into the active actors pool.
     * Used when creating new agents to prevent race conditions.
     */
    public registerAgent(agent: Agent): void {
        this.activeActors.set(agent.id, agent);

        // Also add to cache for persistence
        if (!this.agentCache.has(agent.id)) {
            this.agentCache.set(agent.id, agent);
        }

        // Add to known IDs if not already present
        if (!this.knownAgentIds.includes(agent.id)) {
            this.knownAgentIds.push(agent.id);
        }

        console.log(`[ORCHESTRATOR] ✅ Registered agent: ${agent.id} (${agent.name})`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIFIED CAPABILITY EXECUTION (Central Hub)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * UNIFIED CAPABILITY EXECUTION
     * 
     * Single entry point for ALL capability execution in Silhouette.
     * Routes to the appropriate executor based on capability type:
     * 
     * 1. REGISTERED_TOOL → toolExecutor (generate_image, web_search, etc.)
     * 2. AGENT_CAPABILITY → delegateToAgent via semantic search
     * 3. COMPLEX_WORKFLOW → planExecutor for multi-step tasks
     * 
     * @param capabilityName - Name of the capability/tool/skill to execute
     * @param args - Arguments for the capability
     * @param context - Execution context (requester, priority, session)
     * @returns CapabilityResult with success status and data/error
     */
    public async executeCapability(
        capabilityName: string,
        args: Record<string, any>,
        context: CapabilityContext = {}
    ): Promise<CapabilityResult> {
        const startTime = Date.now();
        const { requesterId = 'unknown', priority = 'NORMAL', sessionId } = context;

        console.log(`[ORCHESTRATOR] 🎯 executeCapability: "${capabilityName}" from ${requesterId} `);

        // Emit event for observability
        systemBus.emit(SystemProtocol.CAPABILITY_REQUEST, {
            capabilityName,
            args,
            requesterId,
            priority,
            timestamp: startTime
        }, 'ORCHESTRATOR');

        try {
            // ═══════════════════════════════════════════════════════════════
            // ROUTE 0: Core Tools - Direct routing to toolHandler
            // These are fundamental capabilities that should NEVER create plans
            // ═══════════════════════════════════════════════════════════════
            const CORE_TOOLS = [
                'generate_image', 'generate_video', 'list_visual_assets',
                'web_search', 'send_email', 'get_emails', 'read_inbox',
                'search_assets', 'manage_asset', 'preview_asset',
                'execute_code', 'read_file', 'write_file', 'list_files'
            ];

            if (CORE_TOOLS.includes(capabilityName)) {
                console.log(`[ORCHESTRATOR] 🎯 Direct routing to toolHandler: ${capabilityName} `);

                const { toolHandler } = await import('./tools/toolHandler');
                const toolResult = await toolHandler.handleFunctionCall(capabilityName, args);

                const result: CapabilityResult = {
                    success: !toolResult.error,
                    data: toolResult,
                    error: toolResult.error,
                    executedBy: 'TOOL_HANDLER',
                    executionTimeMs: Date.now() - startTime,
                    metadata: { toolName: capabilityName }
                };

                this.emitCapabilityResult(capabilityName, result, requesterId);
                return result;
            }

            // ═══════════════════════════════════════════════════════════════
            // ROUTE 1: Check if it's a registered tool
            // ═══════════════════════════════════════════════════════════════
            if (toolRegistry.hasTool(capabilityName)) {
                console.log(`[ORCHESTRATOR] 🔧 Routing to toolExecutor: ${capabilityName} `);

                const toolResult = await toolExecutor.execute(capabilityName, args);

                const result: CapabilityResult = {
                    success: !toolResult.error,
                    data: toolResult,
                    error: toolResult.error,
                    executedBy: 'TOOL',
                    executionTimeMs: Date.now() - startTime,
                    metadata: { toolName: capabilityName }
                };

                this.emitCapabilityResult(capabilityName, result, requesterId);
                return result;
            }

            // ═══════════════════════════════════════════════════════════════
            // ROUTE 2: Find best agent via semantic search
            // ═══════════════════════════════════════════════════════════════
            const agentTaskDescription = `${capabilityName}: ${JSON.stringify(args).substring(0, 200)} `;
            const bestAgents = await enhancedCapabilityRegistry.findProvidersIntelligent(
                agentTaskDescription,
                [], // No specific capabilities required
                { maxAgents: 1 }
            );

            if (bestAgents.length > 0) {
                const agentId = bestAgents[0];
                const agent = this.getAgent(agentId);

                if (agent) {
                    console.log(`[ORCHESTRATOR] 🤖 Routing to agent: ${agent.name} (${agentId})`);

                    // Hydrate the agent
                    await this.hydrateAgent(agentId);

                    // Generate response using the agent
                    const response = await generateAgentResponse(
                        agent.name,
                        agent.role,
                        agent.category || 'OPS',
                        `Execute capability "${capabilityName}" with arguments: ${JSON.stringify(args)} `,
                        null,
                        undefined,
                        undefined,
                        {},
                        {},
                        agent.capabilities || [],
                        CommunicationLevel.TECHNICAL
                    );

                    const result: CapabilityResult = {
                        success: true,
                        data: response.output,
                        executedBy: 'AGENT',
                        executionTimeMs: Date.now() - startTime,
                        metadata: {
                            agentId: agentId,
                            agentName: agent.name,
                            tokensUsed: response.usage
                        }
                    };

                    this.emitCapabilityResult(capabilityName, result, requesterId);
                    return result;
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // ROUTE 3: Fallback - Try as complex workflow via planExecutor
            // ═══════════════════════════════════════════════════════════════
            if (context.allowFallback !== false) {
                console.log(`[ORCHESTRATOR] 📋 Attempting workflow execution for: ${capabilityName} `);

                const { planGenerator } = await import('./planGenerator');
                const { planExecutor } = await import('./planExecutor');

                const plan = await planGenerator.create(
                    `${capabilityName}: ${JSON.stringify(args)} `
                );

                if (plan.steps.length > 0) {
                    const planResult = await planExecutor.execute(plan);

                    const result: CapabilityResult = {
                        success: planResult.success,
                        data: planResult.finalOutput,
                        error: planResult.errors.join('; '),
                        executedBy: 'WORKFLOW',
                        executionTimeMs: Date.now() - startTime,
                        metadata: {
                            planId: plan.id,
                            stepCount: plan.steps.length,
                            tokensUsed: planResult.totalTokens
                        }
                    };

                    this.emitCapabilityResult(capabilityName, result, requesterId);
                    return result;
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // No executor found
            // ═══════════════════════════════════════════════════════════════
            const result: CapabilityResult = {
                success: false,
                error: `Unknown capability: ${capabilityName}. Not found in tools, agents, or workflows.`,
                executedBy: 'DIRECT',
                executionTimeMs: Date.now() - startTime
            };

            this.emitCapabilityResult(capabilityName, result, requesterId);
            return result;

        } catch (error: any) {
            console.error(`[ORCHESTRATOR] ❌ Capability execution failed: `, error);

            const result: CapabilityResult = {
                success: false,
                error: error.message || 'Unknown error',
                executedBy: 'DIRECT',
                executionTimeMs: Date.now() - startTime
            };

            this.emitCapabilityResult(capabilityName, result, requesterId);
            return result;
        }
    }

    /**
     * Emit capability result for observability
     */
    private emitCapabilityResult(
        capabilityName: string,
        result: CapabilityResult,
        requesterId: string
    ): void {
        systemBus.emit(SystemProtocol.CAPABILITY_RESULT, {
            capabilityName,
            success: result.success,
            executedBy: result.executedBy,
            executionTimeMs: result.executionTimeMs,
            requesterId,
            error: result.error
        }, 'ORCHESTRATOR');
    }

    // --- PA-038: AUTONOMOUS EVOLUTION ---
    /**
     * Request evolution of an underperforming agent using AgentFactory.
     * This uses the universalprompts knowledge base to improve the agent's definition.
     */
    public async requestEvolution(agentId: string): Promise<{ success: boolean; previousScore?: number; newScore?: number }> {
        const agent = this.getAgent(agentId);
        if (!agent) {
            console.warn(`[ORCHESTRATOR] ⚠️ Evolution requested for unknown agent: ${agentId} `);
            return { success: false };
        }

        console.log(`[ORCHESTRATOR] 🧬 Requesting evolution for ${agent.name}...`);

        try {
            const result = await agentFactory.evolveAgent(agent);

            if (result.evolved) {
                // Apply evolved definition to the agent
                const evolvedDef = result.agent;

                // Update agent properties
                if (evolvedDef.systemInstruction) {
                    // Note: Agent type doesn't have systemPrompt directly, 
                    // but we can persist the improved definition
                    console.log(`[ORCHESTRATOR] ✅ Agent ${agentId} evolved.Score: ${result.analysis.comparisonScore} → ${evolvedDef.projectedScore} `);
                }

                if (evolvedDef.capabilities && Array.isArray(evolvedDef.capabilities)) {
                    agent.capabilities = evolvedDef.capabilities;
                }

                // Persist the evolved agent
                agentPersistence.saveAgent(agent);

                // Emit evolution event for UI and logging
                systemBus.emit(SystemProtocol.AGENT_EVOLVED, {
                    agentId,
                    agentName: agent.name,
                    previousScore: result.analysis.comparisonScore,
                    newScore: evolvedDef.projectedScore,
                    improvements: evolvedDef.improvements || []
                });

                // Store in memory for learning
                continuum.store(
                    `[EVOLUTION] Agent ${agent.name} evolved from score ${result.analysis.comparisonScore} to ${evolvedDef.projectedScore} `,
                    undefined,
                    ['evolution', 'agent-improvement', agentId]
                );

                // PA-039: Persist evolution metrics to SQLite
                sqliteService.logEvolution({
                    agentId,
                    agentName: agent.name,
                    previousScore: result.analysis.comparisonScore,
                    newScore: evolvedDef.projectedScore,
                    triggerType: 'MANUAL',
                    improvements: evolvedDef.improvements
                });

                return {
                    success: true,
                    previousScore: result.analysis.comparisonScore,
                    newScore: evolvedDef.projectedScore
                };
            } else {
                console.log(`[ORCHESTRATOR] ℹ️ Evolution not needed for ${agentId}: ${result.reason || 'Already optimized'} `);
                return { success: false };
            }
        } catch (error: any) {
            console.error(`[ORCHESTRATOR] ❌ Evolution failed for ${agentId}: `, error.message);
            return { success: false };
        }
    }


    public async hydrateAgent(agentId: string) {
        if (this.activeActors.has(agentId)) return; // Already awake

        const agent = agentPersistence.loadAgent(agentId);
        if (agent) {
            // --- GOD MODE: RESOURCE ARBITER CHECK ---
            const priority = agent.tier === AgentTier.CORE ? 'CRITICAL' : 'NORMAL';
            const allowed = await resourceArbiter.requestAdmission(agent, priority);
            if (!allowed) {
                // console.warn(`[ORCHESTRATOR] 🛑 Wake - up denied for ${ agent.name }(Resource Limit)`);
                return;
            }

            // LRU EVICTION LOGIC (BIO-SAFE PROTOCOL)
            let maxCapacity = 50; // Default BALANCED
            switch (this.currentMode) {
                case SystemMode.ECO: maxCapacity = 20; break;
                case SystemMode.HIGH: maxCapacity = 100; break;
                case SystemMode.ULTRA: maxCapacity = 999; break; // Effectively unlimited
            }

            if (this.activeActors.size >= maxCapacity) {
                // Find least recently used agent (ignoring CORE if possible, but hard cap is hard cap)
                let lruId = '';
                let oldestTime = Infinity;

                for (const [id, actor] of this.activeActors) {
                    // Don't evict CORE agents unless absolutely necessary (or we can have a separate reserve)
                    // For now, simple LRU.
                    if (actor.lastActive < oldestTime && actor.tier !== AgentTier.CORE) {
                        oldestTime = actor.lastActive;
                        lruId = id;
                    }
                }

                // If no non-core found, evict oldest core (emergency)
                if (!lruId) {
                    for (const [id, actor] of this.activeActors) {
                        if (actor.lastActive < oldestTime) {
                            oldestTime = actor.lastActive;
                            lruId = id;
                        }
                    }
                }

                if (lruId) {
                    // console.log(`[ORCHESTRATOR] ♻️ LRU Eviction: Dehydrating ${ lruId } to make room.`);
                    this.dehydrateAgent(lruId);
                }
            }

            agent.status = AgentStatus.IDLE;
            agent.lastActive = Date.now();
            agent.memoryLocation = agent.tier === AgentTier.CORE ? 'VRAM' : 'RAM';
            this.activeActors.set(agentId, agent);

            // [EVOLUTION] Register with conversation system on hydration
            agentConversation.registerAgent(agent);
        }
    }

    /**
     * Manually prune idle agents to free up memory.
     * @param force - If true, ignores timeouts and hibernates all IDLE agents.
     */
    public pruneAgents(force: boolean = false): number {
        if (!this.smartPagingEnabled && !force) return 0;

        let prunedCount = 0;
        const now = Date.now();

        this.activeActors.forEach(agent => {
            if (agent.status === AgentStatus.IDLE) {
                const idleTime = now - agent.lastActive;
                let timeout = 300000; // Default 5m

                // Mode Adjustments
                if (this.currentMode === SystemMode.ECO) timeout = 60000; // 1m in Eco
                if (this.currentMode === SystemMode.HIGH) timeout = 1800000; // 30m in High
                if (this.currentMode === SystemMode.ULTRA && !force) return; // Never dehydrate in Ultra unless forced

                // Tier Adjustments
                if (agent.tier === AgentTier.CORE && this.currentMode !== SystemMode.ECO && !force) return; // Core stays unless ECO or forced
                if (agent.tier === AgentTier.WORKER) timeout = timeout / 2; // Workers die faster

                if (force || idleTime > timeout) {
                    this.dehydrateAgent(agent.id);
                    prunedCount++;
                }
            }
        });

        if (prunedCount > 0) {
            console.log(`[ORCHESTRATOR] 🧹 Pruned ${prunedCount} idle agents.`);
        }
        return prunedCount;
    }

    private dehydrateAgent(agentId: string) {
        const agent = this.activeActors.get(agentId);
        if (agent) {
            agent.status = AgentStatus.OFFLINE;
            agent.memoryLocation = 'DISK'; // Symbolizes "Disk/Cold Storage"
            agent.cpuUsage = 0;
            agent.ramUsage = 0;
            agentPersistence.saveAgent(agent);
            this.activeActors.delete(agentId);

            // [EVOLUTION] Unregister from conversation system on dehydration
            agentConversation.unregisterAgent(agentId);
        }
    }



    public updateLastActive() {
        this.lastSystemInteraction = Date.now();
        if (this.currentMode === SystemMode.ECO) {
            console.log("[ORCHESTRATOR] ⚡ Wake Up Detected. Restoring BALANCED Mode.");
            this.setMode(SystemMode.BALANCED);
        }
    }

    public setMode24_7(enabled: boolean) {
        this.mode24_7 = enabled;
    }

    // --- PUBLIC API ADAPTERS (To maintain compatibility with Frontend) ---

    public getAgents(): Agent[] {
        // Return a mix of Active Agents (real data) and Inactive Agents (metadata from disk/cache)
        // For UI performance, we might want to cache the "inactive" list and only update the active ones.

        // Construct the full view for the UI
        const fullSwarm: Agent[] = this.knownAgentIds.map(id => {
            if (this.activeActors.has(id)) {
                return this.activeActors.get(id)!;
            } else {
                // Return a lightweight "Ghost" representation
                // In a real optimized app, we wouldn't load from disk every frame.
                // We rely on the fact that we loaded them at start or have a cache.
                // For now, we'll reconstruct a basic offline object or load if needed.
                // To avoid disk thrashing, we should keep a "Manifest" in memory.
                // For this implementation, we will assume the UI can handle "Offline" agents being missing 
                // OR we keep a cached list of all agents in memory but only "tick" the active ones.

                // Let's use a cached approach:
                return this.getCachedAgent(id);
            }
        });
        return fullSwarm;
    }

    private agentCache: Map<string, Agent> = new Map();

    private getCachedAgent(id: string): Agent {
        if (!this.agentCache.has(id)) {
            const loaded = agentPersistence.loadAgent(id);
            if (loaded) {
                this.agentCache.set(id, loaded);
            } else {
                // Fallback: Reconstruct from Squad Metadata if possible
                const squad = this.squads.find(s => s.members.includes(id));
                const isLeader = squad?.leaderId === id;

                const fallback: Agent = {
                    id,
                    name: isLeader ? `${squad?.name || 'Unknown'} Lead` : 'Unknown Unit',
                    status: AgentStatus.OFFLINE,
                    teamId: squad?.id || 'UNKNOWN_SQUAD',
                    category: squad?.category || 'CORE',
                    roleType: isLeader ? AgentRoleType.LEADER : AgentRoleType.WORKER,
                    role: 'Recovered Agent',
                    enabled: false,
                    memoryLocation: 'DISK',
                    cpuUsage: 0,
                    ramUsage: 0,
                    lastActive: 0,
                    tier: AgentTier.WORKER,
                    preferredMemory: 'RAM'
                };
                return fallback;
            }
        }
        return this.agentCache.get(id)!;
    }

    public getActiveCount(): number {
        return this.activeActors.size;
    }

    public getMode(): SystemMode {
        return this.currentMode;
    }

    // ... [Keep other methods like setMode, setBusinessPreset, etc. adapting them to wake up agents if needed] ...

    public setMode(mode: SystemMode) {
        this.currentMode = mode;
        this.applyMode(mode);
    }

    public setBusinessPreset(preset: BusinessType) {
        this.currentMode = SystemMode.PRESET;
        this.currentBusinessPreset = preset;
        // Logic to wake up relevant squads...
    }

    private activeCategories: Set<AgentCategory> = new Set(['CORE', 'OPS']); // Default active

    public toggleCategory(category: AgentCategory, enabled: boolean) {
        this.currentMode = SystemMode.CUSTOM;
        if (enabled) {
            this.activeCategories.add(category);
            // Wake up agents in this category
            this.squads.filter(s => s.category === category).forEach(s => {
                s.members.forEach(m => this.hydrateAgent(m));
            });
        } else {
            this.activeCategories.delete(category);
            // Dehydrate agents in this category (unless they are working)
            this.squads.filter(s => s.category === category).forEach(s => {
                s.members.forEach(m => {
                    const agent = this.activeActors.get(m);
                    if (agent && agent.status !== AgentStatus.WORKING) {
                        this.dehydrateAgent(m);
                    }
                });
            });
            sqliteService.setConfig('activeCategories', Array.from(this.activeCategories));
            systemBus.emit(SystemProtocol.UI_REFRESH, { source: 'ORCHESTRATOR', message: 'Division Toggled' });
        }
    }

    public getActiveCategories(): AgentCategory[] {
        return Array.from(this.activeCategories);
    }

    public setCategories(categories: AgentCategory[]) {
        this.activeCategories = new Set(categories);
        // Wake up agents in these categories
        categories.forEach(cat => {
            this.squads.filter(s => s.category === cat).forEach(s => {
                s.members.forEach(m => this.hydrateAgent(m));
            });
        });
    }

    public getSquads(): Squad[] {
        return this.squads;
    }

    public getSquadCountByCategory(category: AgentCategory): number {
        return this.squads.filter(s => s.category === category).length;
    }

    // --- ASYNC TASK HANDLER (PHASE 8) ---

    // --- CURIOSITY ENGINE LOGIC (V2: SWARM INTELLIGENCE) ---
    private async handleEpistemicGap(payload: any) {
        // Payload: { question, source, confidence, context }
        console.log(`[ORCHESTRATOR] 🕵️ Epistemic Gap Received: "${payload.question}"`);

        // 1. Identify The Council (Multi-Perspective Squad Leaders)
        // User Request: "Use multiple specialized teams to elevate the investigation."
        const RELEVANT_TEAMS = ['TEAM_SCIENCE', 'TEAM_STRATEGY', 'TEAM_DEV'];
        const councilMembers: Agent[] = [];

        for (const squad of this.squads) {
            if (RELEVANT_TEAMS.includes(squad.id)) {
                // Determine the correct leader or specialist
                const leaderId = squad.leaderId;
                const agent = this.getCachedAgent(leaderId) || agentPersistence.loadAgent(leaderId);

                if (agent) {
                    councilMembers.push(agent);
                } else {
                    // Fallback: Pick first member
                    const memberId = squad.members[0];
                    const member = this.getCachedAgent(memberId) || agentPersistence.loadAgent(memberId);
                    if (member) councilMembers.push(member);
                }
            }
        }

        // Add the primary researcher explicitly if not already included (sci-03 is a worker, not leader of science usually)
        const primaryResearcher = agentPersistence.loadAgent('sci-03');
        if (primaryResearcher && !councilMembers.find(a => a.id === primaryResearcher.id)) {
            councilMembers.push(primaryResearcher);
        }

        if (councilMembers.length === 0) {
            console.error("[ORCHESTRATOR] ❌ CRITICAL: No Council Members available.");
            return;
        }

        // 2. Hydrate & Prioritize
        // ... (hydration loop above)

        console.log(`[ORCHESTRATOR] 🏛️ Convening Curiosity Council: ${councilMembers.map(a => a.name).join(', ')} `);

        // 3. Gather Existing Knowledge (Context Injection)
        // Ensure the Orchestrator (via the Agent) is aware of what we ALREADY know.
        let existingContext = "No prior knowledge found.";
        try {
            // Quick retrieval using the Unified Continuum (RAM + Vector)
            const memories = await continuum.retrieve(payload.question);
            existingContext = memories.map(m => `- ${m.content} (Relevance: ${m.importance.toFixed(2)})`).join('\n');
        } catch (e) {
            console.warn("[ORCHESTRATOR] Memory lookup failed (minor):", e);
        }

        // 4. Dispatch Missions (Mode-Aware: Sequential or Parallel)
        // ✅ INTELLIGENT EXECUTION: Conserves API calls in ECO/BALANCED, maximizes speed in HIGH/ULTRA
        const useParallelExecution = this.currentMode === 'HIGH' || this.currentMode === 'ULTRA';

        if (useParallelExecution) {
            // HIGH/ULTRA MODE: Parallel Execution (Fast, uses more API calls simultaneously)
            console.log(`[ORCHESTRATOR] 🚀[${this.currentMode} MODE] Launching ${councilMembers.length} agents in PARALLEL...`);

            const agentPromises = councilMembers.map(async (agent) => {
                await this.hydrateAgent(agent.id);

                // Contextualize the prompt based on their category
                let perspective = "General Analysis";
                if (agent.category === 'SCIENCE') perspective = "Empirical Verification & Fact Checking";
                if (agent.category === 'OPS') perspective = "Strategic Implications & Application";
                if (agent.category === 'DEV') perspective = "Technical Feasibility & Implementation";

                // [PHASE 6] ROOT CAUSE MODE
                const isForensic = payload.source === 'ArchitecturalReviewBoard' || payload.source === 'ARB';
                const missionTitle = isForensic ? "🕵️ FORENSIC INVESTIGATION (ROOT CAUSE)" : "⚡ MISSION: CURIOSITY COUNCIL (JOINT INVESTIGATION)";

                const prompt = `
                ${missionTitle}
                
                TARGET SUBJECT: "${payload.question}"
SOURCE: ${payload.source} (Confidence Gap: ${Math.round((1 - payload.confidence) * 100)}%)
                YOUR ROLE: ${agent.role} (${perspective})
                
                🧠 EXISTING SYSTEM KNOWLEDGE(CONTEXT):
                ${existingContext}

OBJECTIVES:
                ${isForensic
                        ? `1. Analyze the RECURRING FAILURE described.
                2. Isolate the variables causing the regression.
                3. Propose a specific CODE FIX or ARCHITECTURAL CHANGE to prevent recurrence.
                4. Validate why previous patches failed.`
                        : `1. Analyze this mystery strictly from your specific domain perspective.
                2. Use your tools (web_search, etc.) to gather unique insights.
                3. Provide a localized conclusion that contributes to the holistic understanding.
                4. Cite sources if you use external research.`}
                
                OUTPUT FORMAT:
- Brief Analysis(2 - 3 sentences)
    - Key Insight(1 sentence)
                ${isForensic ? '- Proposed Fix (Specific Code or Architectural Change)' : '- Evidence/Citations (if applicable)'}
`;

                // [PA-041] Send tagged mission to agent's mailbox with full observability
                this.sendTaggedMessage(
                    agent.id,
                    SystemProtocol.RESEARCH_REQUEST,
                    { prompt, mission: missionTitle },
                    {
                        tag: MessageTag.AGENT_DELEGATION,
                        priority: MessagePriority.HIGH,
                        traceId: this.createTraceId(payload)
                    }
                );

                return agent.name;
            });

            // Wait for all agents to be dispatched in parallel
            const dispatchedAgents = await Promise.all(agentPromises);
            console.log(`[ORCHESTRATOR] ✅ All ${dispatchedAgents.length} agents dispatched in parallel: ${dispatchedAgents.join(', ')} `);

        } else {
            // ECO/BALANCED MODE: Sequential Execution (Slower, conserves API rate limits)
            console.log(`[ORCHESTRATOR] 🐢[${this.currentMode} MODE] Launching ${councilMembers.length} agents SEQUENTIALLY(conserving API limits)...`);

            for (const agent of councilMembers) {
                await this.hydrateAgent(agent.id);

                // Contextualize the prompt based on their category
                let perspective = "General Analysis";
                if (agent.category === 'SCIENCE') perspective = "Empirical Verification & Fact Checking";
                if (agent.category === 'OPS') perspective = "Strategic Implications & Application";
                if (agent.category === 'DEV') perspective = "Technical Feasibility & Implementation";

                // [PHASE 6] ROOT CAUSE MODE
                const isForensic = payload.source === 'ArchitecturalReviewBoard' || payload.source === 'ARB';
                const missionTitle = isForensic ? "🕵️ FORENSIC INVESTIGATION (ROOT CAUSE)" : "⚡ MISSION: CURIOSITY COUNCIL (JOINT INVESTIGATION)";

                const prompt = `
                ${missionTitle}
                
                TARGET SUBJECT: "${payload.question}"
SOURCE: ${payload.source} (Confidence Gap: ${Math.round((1 - payload.confidence) * 100)}%)
                YOUR ROLE: ${agent.role} (${perspective})
                
                🧠 EXISTING SYSTEM KNOWLEDGE(CONTEXT):
                ${existingContext}

OBJECTIVES:
                ${isForensic
                        ? `1. Analyze the RECURRING FAILURE described.
                2. Isolate the variables causing the regression.
                3. Propose a specific CODE FIX or ARCHITECTURAL CHANGE to prevent recurrence.
                4. Validate why previous patches failed.`
                        : `1. Analyze this mystery strictly from your specific domain perspective.
                2. Use your tools (web_search, etc.) to gather unique insights.
                3. Provide a localized conclusion that contributes to the holistic understanding.
                4. Cite sources if you use external research.`}
                
                OUTPUT FORMAT:
- Brief Analysis(2 - 3 sentences)
    - Key Insight(1 sentence)
                ${isForensic ? '- Proposed Fix (Specific Code or Architectural Change)' : '- Evidence/Citations (if applicable)'}
`;

                // [PA-041] Send tagged mission to agent's mailbox with full observability
                this.sendTaggedMessage(
                    agent.id,
                    SystemProtocol.RESEARCH_REQUEST,
                    { prompt, mission: missionTitle },
                    {
                        tag: MessageTag.AGENT_DELEGATION,
                        priority: MessagePriority.HIGH,
                        traceId: this.createTraceId(payload)
                    }
                );
            }

            console.log(`[ORCHESTRATOR] ✅ All ${councilMembers.length} agents dispatched sequentially.`);
        }

    }

    private async handleTaskAssignment(payload: any) {
        // Payload: { targetRole: string, taskType: string, context: any, priority: string }
        const { targetRole, taskType, context, priority } = payload;
        console.log(`[ORCHESTRATOR] 📨 Received Async Task for ${targetRole}: ${taskType} `);

        // 1. Find the best agent for the role
        let targetAgentId = targetRole;

        // If targetRole is a role name (not ID), find the agent
        if (!targetRole.startsWith('agt_') && !targetRole.startsWith('mkt-')) {
            // Logic to find agent by role... for now assume ID is passed or mapped manually
            // Simple fallback:
            if (targetRole === 'Creative_Director') targetAgentId = 'mkt-lead';
        }

        // [OMNISCIENT] Inject semantic memory context for the agent
        let enrichedContext = { ...context };
        try {
            const { continuum } = await import('./continuumMemory');
            const taskDescription = `${taskType}: ${JSON.stringify(context).substring(0, 200)} `;
            const relevantMemory = await continuum.retrieve(taskDescription, undefined, targetAgentId);

            if (relevantMemory.length > 0) {
                // Format memory as concise context (max 10 items, 100 chars each)
                const memoryContext = relevantMemory.slice(0, 10).map(m =>
                    m.content.substring(0, 100)
                ).join(' | ');
                enrichedContext.semanticMemory = memoryContext;
                console.log(`[ORCHESTRATOR] 🧠 Injected ${relevantMemory.length} memory items for ${targetRole}`);
            }
        } catch (e) {
            // Non-fatal, continue without memory context
            console.warn("[ORCHESTRATOR] Memory injection failed (non-fatal):", e);
        }

        // 2. [PA-041] Send to Inbox with proper tagging (Async Decoupling)
        const priorityLevel = priority === 'CRITICAL' ? MessagePriority.CRITICAL : MessagePriority.NORMAL;

        this.sendTaggedMessage(
            targetAgentId,
            SystemProtocol.TASK_ASSIGNMENT,
            { taskType, context: enrichedContext, correlationId: crypto.randomUUID() },
            {
                tag: MessageTag.AGENT_DELEGATION,
                priority: priorityLevel
            }
        );
    }

    // --- INTER-AGENT HELP PROTOCOL ---
    // Handles help requests from one agent to another
    private async handleHelpRequest(payload: {
        requesterId: string;
        requesterRole: string;
        targetRole: string;
        problem: string;
        context: any;
    }) {
        console.log(`[ORCHESTRATOR] 🤝 Help Request: ${payload.requesterRole} → ${payload.targetRole} `);

        // 1. Find the best helper agent for the requested role
        const helperAgentId = this.findAgentByRole(payload.targetRole);

        if (!helperAgentId) {
            console.warn(`[ORCHESTRATOR] No agent found for role: ${payload.targetRole} `);
            // Respond with error
            systemBus.emit(SystemProtocol.HELP_RESPONSE, {
                requesterId: payload.requesterId,
                helperId: 'system',
                solution: `No specialist found for role: ${payload.targetRole} `,
                success: false
            }, 'ORCHESTRATOR');
            return;
        }

        // 2. Hydrate the helper if needed
        await this.hydrateAgent(helperAgentId);

        // 3. Send help request to helper's inbox
        this.sendTaggedMessage(
            helperAgentId,
            SystemProtocol.HELP_REQUEST,
            {
                requesterId: payload.requesterId,
                requesterRole: payload.requesterRole,
                problem: payload.problem,
                context: payload.context
            },
            {
                tag: MessageTag.HELP_REQUEST,
                priority: MessagePriority.HIGH
            }
        );
    }

    // Helper to find agent by role name with dynamic fallback
    private findAgentByRole(role: string): string | null {
        const roleMap: Record<string, string> = {
            'Researcher_Pro': 'sci-03',
            'Research_Synthesizer': 'sci-02',
            'Creative_Director': 'mkt-lead',
            'Code_Architect': 'dev-01',
            'QA_Inquisitor': 'qa-01',
            'ManagerAgent': 'manager',
            'Context_Lead': 'ctx-01',
            'Memory_Agent': 'mem-01'
        };

        if (roleMap[role]) return roleMap[role];

        // Dynamic Search: Check active/known agents by Role Name or ID
        const allAgents = this.getAgents();
        const found = allAgents.find(a =>
            a.role === role ||
            a.name === role ||
            a.id === role ||
            a.role.toLowerCase().includes(role.toLowerCase()) // Fuzzy match
        );

        if (found) return found.id;

        // Semantic/Capability Fallback (Experimental)
        // If role looks like a capability (e.g. "coder", "writer"), try registry
        const providers = capabilityRegistry.findProviders([role as any]);
        if (providers.length > 0) return providers[0];

        return null;
    }

    // --- DISTRIBUTED ORCHESTRATION (PHASE 3) ---

    public async activateSquadsForStage(stage: WorkflowStage, context: any) {
        console.log(`[ORCHESTRATOR] 📣 ACTIVATE SQUADS FOR STAGE: ${stage} `);

        // 1. Identify Target Squads based on Stage
        // This validates the CHAIN OF COMMAND: System -> Orchestrator -> Squad Leader -> Swarm
        const stageAssignments: Partial<Record<WorkflowStage, string[]>> = {
            [WorkflowStage.PLANNING]: ['TEAM_STRATEGY', 'TEAM_CORE', 'TEAM_CONTEXT'],
            [WorkflowStage.EXECUTION]: ['TEAM_DEV', 'TEAM_SCIENCE', 'TEAM_MKT'],
            [WorkflowStage.QA_AUDIT]: ['TEAM_QA', 'TEAM_OPTIMIZE', 'TEAM_FIX'],
            [WorkflowStage.REMEDIATION]: ['TEAM_FIX', 'TEAM_QA'],
            [WorkflowStage.OPTIMIZATION]: ['TEAM_OPTIMIZE', 'TEAM_DEV'],
            [WorkflowStage.RESEARCH]: ['TEAM_SCIENCE', 'TEAM_CONTEXT'],
            [WorkflowStage.GENESIS]: ['TEAM_INTEGRATION', 'TEAM_DEV']
        };

        const targetSquadIds = stageAssignments[stage] || [];

        // 2. Mobilize Each Squad via its Leader
        for (const squadId of targetSquadIds) {
            const squad = this.squads.find(s => s.id === squadId);
            if (squad) {
                await this.mobilizeSquad(squad);
            }
        }
    }

    // --- LEADER-LED ACTIVATION PROTOCOL ---
    // --- LEADER-LED ACTIVATION PROTOCOL ---
    public async mobilizeSquad(squad: Squad) {
        // Step 1: Wake the Leader
        console.log(`[ORCHESTRATOR] 📞 Paging Leader of ${squad.name}...`);
        await this.hydrateAgent(squad.leaderId);

        const leader = this.activeActors.get(squad.leaderId);
        if (!leader) return;

        // Step 2: Leader assesses workload and wakes drones (Workers)
        console.log(`[LEADER] 🗣️ ${leader.name} commands: "Unit ${squad.name}, ATTENTION! WAKE UP!"`);

        // Filter out the leader from the member list to avoid double-waking
        const drones = squad.members.filter(m => m !== squad.leaderId);

        // Staggered Wake-up
        for (const droneId of drones) {
            await this.hydrateAgent(droneId);
        }

        squad.active = true;
        systemBus.emit(SystemProtocol.SQUAD_EXPANSION, {
            source: leader.name,
            message: `${squad.name} fully mobilized with ${drones.length} drones.`
        });
    }

    private applyMode(mode: SystemMode) {
        console.log(`[ORCHESTRATOR] Applying Power Mode: ${mode} `);
        switch (mode) {
            case SystemMode.ECO:
                this.smartPagingEnabled = true;
                this.setMode24_7(false);
                // Aggressively dehydrate idle agents
                this.activeActors.forEach(a => {
                    if (a.status === AgentStatus.IDLE) this.dehydrateAgent(a.id);
                });
                break;
            case SystemMode.BALANCED:
                this.smartPagingEnabled = true;
                // Standard behavior
                break;
            case SystemMode.HIGH:
                this.smartPagingEnabled = false; // Keep agents in RAM longer
                break;
            case SystemMode.ULTRA:
                this.smartPagingEnabled = false;
                this.setMode24_7(true); // Keep everything running
                // Wake up core squads
                this.squads.filter(s => s.category === 'CORE' || s.category === 'OPS').forEach(s => {
                    s.members.forEach(m => this.hydrateAgent(m));
                });
                break;
        }
    }

    public getCoreServices(): ServiceStatus[] {
        return this.coreServices;
    }

    public reassignAgent(agentId: string, targetSquadId: string) {
        // 1. Get Agent (Active or Disk)
        let agent = this.activeActors.get(agentId);

        if (!agent) {
            agent = agentPersistence.loadAgent(agentId);
        }

        if (agent) {
            const oldTeamId = agent.teamId;
            console.log(`[ORCHESTRATOR] 🔄 Reassigning ${agent.name} (${agentId}) from ${oldTeamId} to ${targetSquadId} `);

            // 2. Update Persisted Agent State
            agent.teamId = targetSquadId;
            agentPersistence.saveAgent(agent);

            // 3. Update In-Memory Cache (if not active, update cache so next load is correct)
            this.agentCache.set(agentId, agent);

            // 4. Update In-Memory Squad Membership (CRITICAL FOR UI SYNC)

            // Remove from old squad
            const oldSquad = this.squads.find(s => s.id === oldTeamId);
            if (oldSquad) {
                oldSquad.members = oldSquad.members.filter(m => m !== agentId);
            }

            // Add to new squad
            const newSquad = this.squads.find(s => s.id === targetSquadId);
            if (newSquad) {
                if (!newSquad.members.includes(agentId)) {
                    newSquad.members.push(agentId);
                }
            } else {
                console.warn(`[ORCHESTRATOR] Target squad ${targetSquadId} not found in memory map.`);
            }

            // Notify System Bus for logging/reaction
            systemBus.emit(SystemProtocol.SQUAD_REASSIGNMENT, { agentId, targetSquadId, oldTeamId });

            // Force UI Refresh
            systemBus.emit(SystemProtocol.UI_REFRESH, { source: 'ORCHESTRATOR', message: 'Reassignment Logic Complete' });

        } else {
            console.warn(`[ORCHESTRATOR] Agent ${agentId} not found for reassignment.`);
        }
    }

    private handleSquadReassignment(payload: any) {
        // This is primarily for event logging or if other services need to react.
        // The actual state mutation happens in reassignAgent(). 
        // But if this event came from another node (Distributed), we would apply it here.
        console.log(`[ORCHESTRATOR] Event: Squad Reassignment processed for ${payload.agentId}`);
    }

    public balanceMemoryLoad(vram: number) {
        // Handled by Dehydration logic in tick()
    }



    // --- ROBUSTNESS: HEARTBEAT & RESET ---

    public async updateHeartbeat(agentId: string) {
        // 1. Update In-Memory
        const agent = this.activeActors.get(agentId);
        if (agent) {
            agent.lastActive = Date.now();
        }

        // 2. Persist to SQLite (Atomic Update via Persistence Layer)
        // We bypass full save for efficiency if possible, or just save the agent.
        // For now, full save is safe enough for < 100 agents.
        if (agent) {
            agentPersistence.saveAgent(agent);
        } else {
            // If not in RAM, load, update, save
            const diskAgent = agentPersistence.loadAgent(agentId);
            if (diskAgent) {
                diskAgent.lastActive = Date.now();
                agentPersistence.saveAgent(diskAgent);
            }
        }
    }

    public async resetAgent(agentId: string) {
        console.log(`[ORCHESTRATOR] 🔄 RESETTING AGENT: ${agentId} `);

        // 1. Force Dehydrate (Kill Process/Clear Memory)
        if (this.activeActors.has(agentId)) {
            this.activeActors.delete(agentId);
        }

        // 2. Clear from cache
        this.agentCache.delete(agentId);

        // 3. Load Fresh from Disk
        const agent = agentPersistence.loadAgent(agentId);
        if (agent) {
            // 4. Sanitization
            agent.status = AgentStatus.IDLE;
            agent.currentTask = undefined;
            agent.memoryLocation = 'DISK';
            agent.cpuUsage = 0;
            agent.ramUsage = 0;
            agent.lastActive = Date.now();

            // 5. Save Clean State
            agentPersistence.saveAgent(agent);

            // [FIX] Do NOT re-hydrate immediately - let system wake on demand
            // This prevents the zombie loop where agent is reset but immediately detected again
            console.log(`[ORCHESTRATOR] ✅ Agent ${agentId} successfully reset and put to sleep.`);
        } else {
            // Agent not found on disk - if it's a dynamic agent, purge it completely
            if (agentId.startsWith('agt_dyn_')) {
                console.log(`[ORCHESTRATOR] 🧹 Dynamic agent ${agentId} not on disk.Purging...`);
                await this.purgeAgent(agentId);
            } else {
                console.error(`[ORCHESTRATOR] ❌ Failed to reset ${agentId}: Agent not found.`);
            }
        }
    }

    /**
     * Completely removes an agent from the system (for zombie cleanup of dynamic agents)
     * This is a permanent deletion - use with caution.
     */
    public async purgeAgent(agentId: string) {
        console.log(`[ORCHESTRATOR] 🗑️ PURGING AGENT: ${agentId} `);

        // 1. Remove from active actors
        this.activeActors.delete(agentId);

        // 2. Remove from cache
        this.agentCache.delete(agentId);

        // 3. Remove from known agent IDs
        const idx = this.knownAgentIds.indexOf(agentId);
        if (idx !== -1) {
            this.knownAgentIds.splice(idx, 1);
        }

        // 4. Remove from any squads
        for (const squad of this.squads) {
            const memberIdx = squad.members.indexOf(agentId);
            if (memberIdx !== -1) {
                squad.members.splice(memberIdx, 1);
            }
            // If this was the leader, mark squad as inactive
            if (squad.leaderId === agentId) {
                squad.leaderId = '';
                squad.active = false;
            }
        }

        // 5. Remove from persistence (if exists)
        try {
            agentPersistence.deleteAgent(agentId);
        } catch (e) {
            // Agent might not exist in persistence - that's OK
        }

        // 6. Unregister capabilities
        try {
            const { capabilityRegistry } = await import('./capabilityRegistry');
            capabilityRegistry.unregisterAgent(agentId);
        } catch (e) {
            // Non-critical
        }

        console.log(`[ORCHESTRATOR] ✅ Agent ${agentId} permanently purged from system.`);
    }

    // ==========================================
    // [PA-041] MESSAGE TAGGING & OBSERVABILITY
    // ==========================================

    /**
     * Classifies a message based on protocol and context
     * Returns appropriate tag and priority for the message type
     */
    private classifyMessage(
        protocol: SystemProtocol,
        context?: { source?: string; priority?: string; isUserInitiated?: boolean }
    ): { tag: MessageTag; priority: MessagePriority } {
        // User-initiated requests always get USER_REQUEST tag
        if (context?.isUserInitiated) {
            return { tag: MessageTag.USER_REQUEST, priority: MessagePriority.HIGH };
        }

        // Protocol-based classification
        const classificationMap: Partial<Record<SystemProtocol, { tag: MessageTag; priority: MessagePriority }>> = {
            // Critical system events
            [SystemProtocol.COST_ANOMALY]: { tag: MessageTag.SYSTEM, priority: MessagePriority.CRITICAL },
            [SystemProtocol.DATA_CORRUPTION]: { tag: MessageTag.SYSTEM, priority: MessagePriority.CRITICAL },
            [SystemProtocol.SECURITY_LOCKDOWN]: { tag: MessageTag.SYSTEM, priority: MessagePriority.CRITICAL },

            // High priority agent delegation
            [SystemProtocol.RESEARCH_REQUEST]: { tag: MessageTag.AGENT_DELEGATION, priority: MessagePriority.HIGH },
            [SystemProtocol.TASK_ASSIGNMENT]: { tag: MessageTag.AGENT_DELEGATION, priority: MessagePriority.HIGH },
            [SystemProtocol.SYNTHESIS_REQUEST]: { tag: MessageTag.AGENT_DELEGATION, priority: MessagePriority.HIGH },
            [SystemProtocol.PAPER_GENERATION_REQUEST]: { tag: MessageTag.AGENT_DELEGATION, priority: MessagePriority.HIGH },

            // Normal priority triggers
            [SystemProtocol.SQUAD_EXPANSION]: { tag: MessageTag.TRIGGER, priority: MessagePriority.NORMAL },
            [SystemProtocol.SQUAD_REASSIGNMENT]: { tag: MessageTag.TRIGGER, priority: MessagePriority.NORMAL },
            [SystemProtocol.AGENT_EVOLVED]: { tag: MessageTag.TRIGGER, priority: MessagePriority.NORMAL },
            [SystemProtocol.EPISTEMIC_GAP_DETECTED]: { tag: MessageTag.TRIGGER, priority: MessagePriority.NORMAL },

            // Low priority UI updates
            [SystemProtocol.UI_REFRESH]: { tag: MessageTag.SYSTEM, priority: MessagePriority.LOW },
            [SystemProtocol.THOUGHT_EMISSION]: { tag: MessageTag.TRIGGER, priority: MessagePriority.LOW },
            [SystemProtocol.NARRATIVE_UPDATE]: { tag: MessageTag.SYSTEM, priority: MessagePriority.LOW }
        };

        const classification = classificationMap[protocol];
        if (classification) {
            return classification;
        }

        // Override with context priority if provided
        if (context?.priority === 'CRITICAL') {
            return { tag: MessageTag.SYSTEM, priority: MessagePriority.CRITICAL };
        }

        // Default classification
        return { tag: MessageTag.SYSTEM, priority: MessagePriority.NORMAL };
    }

    /**
     * Sends a tagged message to an agent with full observability
     * This is the preferred method for all inter-agent communication
     */
    private sendTaggedMessage(
        targetId: string,
        protocol: SystemProtocol,
        payload: any,
        options?: {
            tag?: MessageTag;
            priority?: MessagePriority;
            traceId?: string;
            squadId?: string;
        }
    ): string {
        // Auto-classify if not provided
        const classification = options?.tag && options?.priority
            ? { tag: options.tag, priority: options.priority }
            : this.classifyMessage(protocol, payload);

        const traceId = options?.traceId || this.createTraceId(payload);
        const taskId = crypto.randomUUID();

        // Create enhanced message
        const message = systemBus.createMessage(
            'orchestrator',
            targetId,
            protocol,
            payload,
            {
                tag: classification.tag,
                priority: classification.priority,
                traceId
            }
        );

        // Track the task
        this.activeTasks.set(taskId, {
            taskId,
            agentId: targetId,
            squadId: options?.squadId,
            protocol,
            priority: classification.priority,
            assignedAt: Date.now(),
            status: 'PENDING'
        });

        // Update statistics
        this.messageStats.total++;
        this.messageStats.byTag[classification.tag]++;
        this.messageStats.byPriority[classification.priority]++;
        this.messageStats.lastHour++;

        // Send via system bus
        systemBus.send(message);

        // Enhanced logging with priority emoji
        const priorityEmoji = {
            [MessagePriority.CRITICAL]: '🚨',
            [MessagePriority.HIGH]: '⚡',
            [MessagePriority.NORMAL]: '📨',
            [MessagePriority.LOW]: '📬'
        }[classification.priority];

        console.log(`[ORCHESTRATOR] ${priorityEmoji} [${classification.tag}] Sent ${protocol} to ${targetId} [Task: ${taskId.substring(0, 8)}]`);

        return taskId;
    }

    /**
     * Emits a protocol event with metadata for observability
     * Wraps systemBus.emit with additional tracking
     */
    private emitWithMetadata(
        protocol: SystemProtocol,
        payload: any,
        options?: {
            priority?: MessagePriority;
            source?: string;
        }
    ): void {
        const priority = options?.priority || MessagePriority.NORMAL;
        const source = options?.source || 'ORCHESTRATOR';

        // Track in statistics
        const classification = this.classifyMessage(protocol);
        this.messageStats.total++;
        this.messageStats.byTag[classification.tag]++;
        this.messageStats.byPriority[priority]++;

        // Enhanced payload with metadata
        const enhancedPayload = {
            ...payload,
            _meta: {
                priority,
                timestamp: Date.now(),
                source
            }
        };

        // Priority emoji for logging
        const priorityEmoji = {
            [MessagePriority.CRITICAL]: '🚨',
            [MessagePriority.HIGH]: '⚡',
            [MessagePriority.NORMAL]: '📡',
            [MessagePriority.LOW]: '📢'
        }[priority];

        console.log(`[ORCHESTRATOR] ${priorityEmoji} Emit ${protocol} from ${source} `);

        systemBus.emit(protocol, enhancedPayload, source);
    }

    /**
     * Creates a hierarchical trace ID for end-to-end message tracking
     */
    private createTraceId(context?: any): string {
        const base = crypto.randomUUID();
        // If context has existing traceId, create child trace
        if (context?.traceId) {
            return `${context.traceId}:${base.substring(0, 8)} `;
        }
        return base;
    }

    /**
     * Updates task status (called when task completes or fails)
     */
    public updateTaskStatus(taskId: string, status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'): void {
        const task = this.activeTasks.get(taskId);
        if (task) {
            task.status = status;
            if (status === 'COMPLETED' || status === 'FAILED') {
                // Keep for audit but mark as done
                setTimeout(() => this.activeTasks.delete(taskId), 60000); // Cleanup after 1 minute
            }
        }
    }

    /**
     * [OBSERVABILITY API] Get message statistics
     */
    public getMessageStats(): MessageStats {
        return { ...this.messageStats };
    }

    /**
     * [OBSERVABILITY API] Get active tasks with details
     */
    public getActiveTasks(): ActiveTask[] {
        return Array.from(this.activeTasks.values());
    }

    /**
     * [OBSERVABILITY API] Get tasks by agent
     */
    public getTasksByAgent(agentId: string): ActiveTask[] {
        return Array.from(this.activeTasks.values()).filter(t => t.agentId === agentId);
    }

    /**
     * [OBSERVABILITY API] Get tasks by squad
     */
    public getTasksBySquad(squadId: string): ActiveTask[] {
        return Array.from(this.activeTasks.values()).filter(t => t.squadId === squadId);
    }

    /**
     * [OBSERVABILITY API] Get full system state for Command Center
     */
    public getCommandCenterState(): {
        messageStats: MessageStats;
        activeTasks: ActiveTask[];
        activeAgents: { id: string; name: string; status: AgentStatus; currentTask?: string }[];
        squads: { id: string; name: string; active: boolean; taskCount: number }[];
        mode: SystemMode;
    } {
        const activeAgentsList = Array.from(this.activeActors.values()).map(agent => ({
            id: agent.id,
            name: agent.name,
            status: agent.status,
            currentTask: Array.from(this.activeTasks.values())
                .find(t => t.agentId === agent.id && t.status !== 'COMPLETED')?.taskId
        }));

        const squadsWithTasks = this.squads.map(squad => ({
            id: squad.id,
            name: squad.name,
            active: squad.active,
            taskCount: Array.from(this.activeTasks.values())
                .filter(t => t.squadId === squad.id).length
        }));

        return {
            messageStats: this.getMessageStats(),
            activeTasks: this.getActiveTasks(),
            activeAgents: activeAgentsList,
            squads: squadsWithTasks,
            mode: this.currentMode
        };
    }

    /**
     * Resets hourly message counter (called by tick)
     */
    private resetHourlyStats(): void {
        this.messageStats.lastHour = 0;
    }

}

export const orchestrator = new AgentSwarmOrchestrator();
