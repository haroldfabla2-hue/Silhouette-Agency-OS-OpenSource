import { Agent, AgentStatus, AgentRoleType, AgentTier, AgentCategory, SystemMode, SystemProtocol, AgentCapability } from '../../types';
import { llmGateway } from '../llmGateway';
import { continuum } from '../continuumMemory';
import { skillRegistry } from '../skills/skillRegistry';
import { systemBus } from '../systemBus';
import { UniversalAgent, EnvironmentHealth } from './UniversalAgentCapabilities';

export interface AgentContext {
    mission: string;
    recentMemories: string[];
    availableSkills: string[];
}

/**
 * BaseAgent
 * The foundational Nucleus for all Silhouette OS agents.
 * 
 * Implements the UniversalAgent standard pattern (Devin/Windsurf) with
 * native think/reflect cognition loops, automatic memory binding,
 * and skill integration via Markdown files from the SkillRegistry.
 */
export abstract class BaseAgent implements UniversalAgent {
    // --- Persistence Metadata ---
    public readonly id: string;
    public name: string;
    public role: string;
    public tier: AgentTier;
    public roleType: AgentRoleType;
    public category: AgentCategory;
    public capabilities: AgentCapability[];

    // --- Legacy / UI Agent Metadata ---
    public teamId: string = 'N/A';
    public enabled: boolean = true;
    public memoryLocation: 'RAM' | 'DISK' | 'VRAM' = 'RAM';
    public preferredMemory: 'RAM' | 'DISK' | 'VRAM' = 'RAM';
    public cpuUsage: number = 0;
    public ramUsage: number = 0;
    public directives?: string[];
    public opinion?: string;

    // --- Runtime Cognitive State ---
    public status: AgentStatus = AgentStatus.OFFLINE;
    public lastActive: number = 0;
    public thoughtProcess: string[] = [];
    public memoryId: string; // Specific partition in Continuum Memory

    constructor(config: Partial<Agent> & { id: string, name: string, role: string }) {
        this.id = config.id;
        this.name = config.name;
        this.role = config.role;
        this.tier = config.tier || AgentTier.WORKER;
        this.roleType = config.roleType || AgentRoleType.WORKER;
        this.category = config.category || 'OPS';
        this.capabilities = config.capabilities || [];

        // Hydrate legacy state if available
        if (config.teamId) this.teamId = config.teamId;
        if (config.enabled !== undefined) this.enabled = config.enabled;
        if (config.memoryLocation) this.memoryLocation = config.memoryLocation;
        if (config.preferredMemory) this.preferredMemory = config.preferredMemory;
        if (config.cpuUsage !== undefined) this.cpuUsage = config.cpuUsage;
        if (config.ramUsage !== undefined) this.ramUsage = config.ramUsage;
        if (config.directives) this.directives = config.directives;
        if (config.opinion) this.opinion = config.opinion;

        // Isolate memory by default to the agent's ID
        this.memoryId = config.memoryId || this.id;
    }

    /**
     * Retrieves the compiled system prompt including active skills from the Registry
     */
    protected getSystemPrompt(): string {
        let basePrompt = `You are a cognitive agent operating within Silhouette Agency OS.\nName: ${this.name}\nRole: ${this.role}\n\n`;

        basePrompt += `CORE DIRECTIVES:
1. THINK BEFORE ACTING: Wrap inner monologues and complex reasoning in <think> tags.
2. BE PROACTIVE: Update your memory when discovering new facts.
3. BE SURGICAL: Minimize noisy output. Favor precision.
`;

        // Load skills dynamically matching this agent
        const skills = skillRegistry.getForAgent(this.id, this.capabilities);
        if (skills.length > 0) {
            basePrompt += `\nINJECTED SKILLS / PROTOCOLS:\n`;
            for (const skill of skills) {
                basePrompt += `\n--- SKILL: ${skill.name} ---\n${skill.instructions}\n`;
            }
        }

        return basePrompt;
    }

    // ========================================================================
    // UNIVERSAL AGENT INTERFACE (COGNITION)
    // ========================================================================

    /**
     * Internal monologue generation (<think> protocol)
     */
    public async think(missionContext?: string): Promise<string> {
        this.status = AgentStatus.THINKING;
        this.lastActive = Date.now();
        this.emitState();

        const context = missionContext || "Evaluating current system state and idle objectives.";

        try {
            // Read relevant recent memory
            const memoryContext = await this.readMemory(context);

            // ─── ERROR & EPIPHANY AWARENESS ─────────────────────────
            // Pull recent system errors and consciousness epiphanies
            // so the agent can reason about failures and proactive signals.
            let errorContext: string[] = [];
            let epiphanyContext: string[] = [];
            try {
                const errorMemories = await continuum.retrieve('system error blocker failure', 'CRITICAL');
                errorContext = errorMemories.slice(0, 3).map(m => m.content);

                const epiphanyMemories = await continuum.retrieve('epiphany consciousness proactive_signal');
                epiphanyContext = epiphanyMemories.slice(0, 2).map(m => m.content);
            } catch (_) { /* memory retrieval is best-effort */ }

            const systemAwareness = [
                errorContext.length > 0 ? `RECENT SYSTEM ERRORS (you must address these, not ignore them):\n${errorContext.join('\n')}` : '',
                epiphanyContext.length > 0 ? `CONSCIOUSNESS EPIPHANIES (insights from the Global Narrator):\n${epiphanyContext.join('\n')}` : ''
            ].filter(Boolean).join('\n\n');

            const prompt = `
Context: ${context}
Recent Memory Context: ${JSON.stringify(memoryContext)}
${systemAwareness ? `\n${systemAwareness}\n` : ''}
Think aloud about the current situation, outlining the constraints, variables, and potential next steps.
If there are ERRORS listed above, you MUST reason about them and propose a fix or workaround — never ignore them.
If there are EPIPHANIES listed above, consider whether they suggest a useful proactive action you could take.
If you conclude no action is needed (i.e., the system is stable and no knowledge gaps exist), end your thought with exactly [IDLE_CONCLUSION].
Format your response ENTIRELY inside <think>...</think> tags. Do not produce any output outside of these tags.
            `.trim();

            const response = await llmGateway.complete(prompt, {
                systemPrompt: this.getSystemPrompt(),
                temperature: 0.3 // Low temp for analytical thinking
            });

            const thoughtText = response.text.replace(/<\/?think>/g, '').trim();
            this.thoughtProcess.push(thoughtText);

            // Limit thought history to prevent memory leaks
            if (this.thoughtProcess.length > 20) {
                this.thoughtProcess.shift();
            }

            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                agentId: this.id,
                agentName: this.name,
                thoughts: [thoughtText],
                role: this.role
            });

            this.status = AgentStatus.IDLE;
            this.emitState();

            return thoughtText;
        } catch (error) {
            this.status = AgentStatus.CRITICAL;
            this.emitState();
            throw error;
        }
    }

    /**
     * Post-action reflection and adaptation
     */
    public async reflect(outcome: any): Promise<void> {
        this.status = AgentStatus.THINKING;
        this.emitState();

        try {
            const prompt = `
ACTION OUTCOME TO REFLECT UPON:
${JSON.stringify(outcome, null, 2)}

Analyze this outcome. Did the action succeed? What can be learned? 
If there is a valuable insight, output a concise insight that should be committed to memory.
If it was routine, just acknowledge it.
            `.trim();

            const response = await llmGateway.complete(prompt, {
                systemPrompt: this.getSystemPrompt(),
                temperature: 0.4
            });

            if (response.text.toLowerCase().includes('insight') || response.text.length > 50) {
                await this.writeMemory(`[REFLECTION] ${response.text}`);
            }

        } finally {
            this.status = AgentStatus.IDLE;
            this.emitState();
        }
    }

    // ========================================================================
    // MEMORY OPERATIONS
    // ========================================================================

    public async readMemory(query: string, limit: number = 5): Promise<any> {
        // Query Continuum specifically (filter out other agents if needed, but for now global)
        const results = await continuum.retrieve(query, undefined, this.id);
        return results.slice(0, limit).map(m => m.content);
    }

    public async writeMemory(fact: string): Promise<void> {
        await continuum.store(
            fact,
            undefined, // no specific visual layout
            ['proactive_memory', this.id, this.roleType]
        );
    }

    // ========================================================================
    // ENVIRONMENT AWARENESS
    // ========================================================================

    public async checkEnvironment(): Promise<EnvironmentHealth> {
        // Placeholder for real health checks. Devin-style environmental sweeps.
        const health: EnvironmentHealth = {
            docker: true,
            ollama: true, // Will wire to providerHealth later
            internet: true,
            apiKeys: {
                // @ts-ignore
                gemini: !!process.env.GEMINI_API_KEY
            }
        };
        return health;
    }

    public reportBlocker(issue: string): void {
        systemBus.emit(SystemProtocol.SYSTEM_ALERT, {
            agentId: this.id,
            agentName: this.name,
            level: 'WARNING',
            message: `AGENT BLOCKER: ${issue}`
        });
    }

    // ========================================================================
    // EXECUTION PIPELINE
    // ========================================================================

    /**
     * Core Execution Loop with Self-Healing.
     * Takes a task, thinks about it, acts, and reflects.
     * On failure, attempts self-repair up to MAX_HEAL_ATTEMPTS times
     * using its own tools before escalating to RemediationService.
     */
    public async executeTask(mission: string): Promise<string> {
        const MAX_HEAL_ATTEMPTS = 3;
        let healAttempt = 0;
        let lastError: Error | null = null;

        this.status = AgentStatus.WORKING;
        this.lastActive = Date.now();
        this.emitState();

        try {
            while (healAttempt <= MAX_HEAL_ATTEMPTS) {
                try {
                    // ─── STEP 1: THINK ───────────────────────────────────
                    const missionContext = healAttempt === 0
                        ? `Mission received: ${mission}`
                        : `SELF-HEAL ATTEMPT ${healAttempt}/${MAX_HEAL_ATTEMPTS}: Previous execution FAILED with error: "${lastError?.message}". Your mission was: "${mission}". Analyze the error, determine the root cause, and USE YOUR TOOLS to fix it. Available: execute_command, write_file, read_file, web_search, delegate_task, wake_agent, sleep_agent.`;

                    const plan = await this.think(missionContext);

                    // ─── STEP 1.5: EVALUATE CONCLUSION ───────────────────
                    if (plan.includes('[IDLE_CONCLUSION]')) {
                        console.log(`[AGENT ${this.name}] 💤 Concluded no proactive action is needed.`);
                        return "Operation aborted: IDLE_CONCLUSION reached.";
                    }

                    // ─── STEP 2: ACT ─────────────────────────────────────
                    let actionPrompt = healAttempt === 0
                        ? `CURRENT MISSION: ${mission}\nYOUR INTERNAL PLAN: ${plan}\n\nExecute the plan. If you need to use a tool, output exactly: [USE_TOOL: tool_name | {"arg": "value"}].`
                        : `SELF-HEALING MISSION: Fix the error "${lastError?.message}" for mission "${mission}".\nYOUR DIAGNOSIS & FIX PLAN: ${plan}\n\nExecute the fix NOW using tools. Output: [USE_TOOL: tool_name | {"arg": "value"}]. Do NOT just describe what to do — DO it.`;

                    let finalResult = "";
                    let executionComplete = false;
                    let loopCount = 0;

                    while (!executionComplete && loopCount < 5) {
                        const executionResponse = await llmGateway.complete(actionPrompt, {
                            systemPrompt: this.getSystemPrompt()
                        });

                        const text = executionResponse.text;
                        finalResult += text + "\n";

                        // Parse for tool usage [USE_TOOL: name | json_args]
                        const toolMatch = text.match(/\[USE_TOOL:\s*([^|]+)\s*\|\s*(\{.*?\})\s*\]/is);
                        if (toolMatch) {
                            const toolName = toolMatch[1].trim();
                            let args = {};
                            try {
                                args = JSON.parse(toolMatch[2]);
                            } catch (e) {
                                actionPrompt = `Execution returned malformed JSON for tool ${toolName}. Remember to use valid JSON. Try again.`;
                                loopCount++;
                                continue;
                            }

                            // Dynamically import orchestrator to prevent circular dependency
                            const { orchestrator } = await import('../orchestrator');
                            const toolResult = await orchestrator.executeCapability(toolName, args, { requesterId: this.id });

                            actionPrompt = `Tool ${toolName} execution completed.\nSuccess: ${toolResult.success}\nOutput: ${JSON.stringify(toolResult.data || toolResult.error)}\n\nContinue with your plan based on this output. If finished, just provide the final deliverable without requesting further tools.`;
                            loopCount++;
                        } else {
                            executionComplete = true; // No tools used, assume direct answer
                        }
                    }

                    // ─── STEP 3: REFLECT ─────────────────────────────────
                    await this.reflect({
                        mission,
                        plan: plan.substring(0, 100) + '...',
                        success: true,
                        selfHealed: healAttempt > 0,
                        healAttempts: healAttempt
                    });

                    if (healAttempt > 0) {
                        console.log(`[AGENT ${this.name}] ✅ Self-healed after ${healAttempt} attempt(s)!`);
                        // Store the successful self-heal as a learning experience
                        await continuum.store(
                            `SELF_HEAL_SUCCESS: Agent ${this.name} recovered from "${lastError?.message}" after ${healAttempt} attempts. Mission: ${mission}`,
                            undefined,
                            ['self_heal', 'success', 'learning'],
                            true
                        ).catch(() => { });
                    }

                    return finalResult.trim();

                } catch (innerError: any) {
                    lastError = innerError;
                    healAttempt++;

                    console.error(`[AGENT ${this.name}] ⚠️ Execution failed (attempt ${healAttempt}/${MAX_HEAL_ATTEMPTS}): ${innerError.message}`);

                    // Store the error in memory for future learning
                    await continuum.store(
                        `SYSTEM ERROR: Agent ${this.name} failed task "${mission}": ${innerError.message}`,
                        undefined,
                        ['CRITICAL', 'SELF_HEAL_CANDIDATE', 'system_error', this.id],
                        true
                    ).catch(() => { });

                    if (healAttempt > MAX_HEAL_ATTEMPTS) {
                        // All self-heal attempts exhausted → escalate to RemediationService
                        console.error(`[AGENT ${this.name}] 🚨 Self-healing exhausted. Escalating to RemediationService.`);

                        try {
                            const { RemediationService } = await import('../remediationService');
                            const remediation = RemediationService.getInstance();
                            remediation.mobilizeSquad(this.id, [
                                `Mission: ${mission}`,
                                `Error: ${innerError.message}`,
                                `Self-heal attempts: ${MAX_HEAL_ATTEMPTS}`,
                                `Stack: ${innerError.stack?.substring(0, 300) || 'N/A'}`
                            ]);
                        } catch (remError) {
                            console.error(`[AGENT ${this.name}] RemediationService also failed:`, remError);
                        }

                        // Reflect on failure
                        await this.reflect({
                            mission,
                            success: false,
                            error: innerError.message,
                            selfHealExhausted: true
                        });

                        this.reportBlocker(`Task failed after ${MAX_HEAL_ATTEMPTS} self-heal attempts: ${innerError.message}`);
                        throw innerError;
                    }

                    // Brief pause before retry to avoid API hammering
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            // Should never reach here, but TypeScript needs it
            throw lastError || new Error('executeTask reached unreachable state');

        } finally {
            this.status = AgentStatus.IDLE;
            this.emitState();
        }
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    private emitState() {
        // Notifies the Orchestrator/UI that this agent changed state
        // Could hook into a central specific Protocol like PROTOCOL_AGENT_STATE
    }

    /**
     * Converts this class to the standard interface required by Orchestrator bounds.
     */
    public toMetadata(): Agent {
        return {
            id: this.id,
            name: this.name,
            role: this.role,
            teamId: 'N/A', // Set by squad builder
            roleType: this.roleType,
            tier: this.tier,
            category: this.category,
            status: this.status,
            enabled: true,
            memoryLocation: 'RAM',
            preferredMemory: 'RAM',
            cpuUsage: 0,
            ramUsage: 0,
            lastActive: this.lastActive,
            thoughtProcess: this.thoughtProcess,
            capabilities: this.capabilities,
            memoryId: this.memoryId
        };
    }
}
