import { lancedbService } from '../lancedbService';
import { geminiService } from '../geminiService';
import { backgroundLLM } from '../backgroundLLMService';
import { AgentRoleType, AgentCategory, Agent, AgentStatus, AgentTier, SystemProtocol } from '../../types';
import { toolRegistry } from '../tools/toolRegistry';
import { systemBus } from '../systemBus';

export interface AgentBlueprint {
    roleName: string;
    description: string;
    category: AgentCategory;
    skills: string[];
}

export interface AgentAnalysis {
    agentId: string;
    strengths: string[];
    weaknesses: string[];
    improvementSuggestions: ImprovementSuggestion[];
    comparisonScore: number; // 0-100 vs best practices
}

export interface ImprovementSuggestion {
    area: 'PROMPT' | 'CAPABILITIES' | 'TOOLS' | 'WORKFLOW';
    description: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    implementation: string;
}

export class AgentFactory {

    /**
     * Get Silhouette's organizational structure context for agent creation
     */
    private getOrganizationalContext(): string {
        return `
=== SILHOUETTE ORGANIZATIONAL STRUCTURE ===

TIER HIERARCHY:
1. CORE - Critical system agents (always in VRAM, never dehydrate)
   - Orchestrator_Prime, Intent_Analyzer_Alpha, Workflow_Architect
   - Responsibilities: System coordination, high-level decision making
   - Resource Priority: Highest (reserved VRAM slots)
   
2. SPECIALIST - Expert agents (high priority, rarely dehydrate)
   - Strategos_X (Strategy), Researcher_Pro, Code_Architect, Creative_Director
   - Responsibilities: Domain expertise, complex problem solving
   - Resource Priority: High (30min idle timeout in HIGH mode)
   
3. WORKER - Execution agents (hydrate/dehydrate on demand)
   - Data analysts, developers, QA testers, content creators, etc.
   - Responsibilities: Task execution, specific operations
   - Resource Priority: Normal (5min idle timeout in BALANCED mode)

SQUAD STRUCTURE:
- Agents are organized into SQUADS (teams) by category
- Each squad has a LEADER (decision maker) and WORKERS (executors)
- Base Squads: TEAM_CORE, TEAM_STRATEGY, TEAM_CONTEXT, TEAM_OPTIMIZE, TEAM_QA, TEAM_FIX, TEAM_SCIENCE
- Dynamic squads can be created for specific projects (format: SQ_PROJECT_NAME)
- Squad members communicate via SystemBus mailbox (asynchronous messaging)

COMMUNICATION PROTOCOLS:
- Asynchronous messaging via SystemBus mailbox system
- Agents can send messages to other agents (even if offline/dehydrated)
- Messages are delivered when target agent is hydrated
- Priority levels: CRITICAL, HIGH, NORMAL, LOW
- Global mail processing runs every 3 seconds
- Agents wake up automatically when they receive mail

RESOURCE MANAGEMENT:
- Actor Model: Agents hydrate (load to RAM) and dehydrate (save to disk) dynamically
- LRU Cache Eviction: Least recently used agents are dehydrated when capacity is reached
- Mode-Aware Capacity:
  * ECO: 20 agents max, 1min idle timeout
  * BALANCED: 50 agents max, 5min idle timeout
  * HIGH: 100 agents max, 30min idle timeout
  * ULTRA: 999 agents (unlimited), never dehydrate
- CORE agents never dehydrate (except in ECO mode emergency)
- Resource Arbiter prevents system overload

AGENT LIFECYCLE:
1. Creation: Agent defined with tier, squad, role type
2. Persistence: Saved to db/agents/{id}.json
3. Registration: Registered in orchestrator.activeActors and capabilityRegistry
4. Hydration: Loaded to RAM when needed (mail, task assignment, manual wake)
5. Execution: Processes tasks, sends messages, updates state
6. Dehydration: Saved to disk and removed from RAM when idle
7. Evolution: Can be improved via AgentFactory.evolveAgent() using peer review

BEST PRACTICES FOR NEW AGENTS:
- Choose appropriate TIER based on criticality and usage frequency
- Assign to existing squad or create new dynamic squad (SQ_XXX)
- Define clear capabilities for capability registry
- Specify communication patterns (who does this agent talk to?)
- Consider resource usage (CORE = always active, WORKER = on-demand)
        `.trim();
    }

    /**
     * The "Super Architect" Method.
     * Uses Vector Search to find the best prompts from the Universal Library
     * and composes a superior Agent Definition.
     */
    public async architectAgent(blueprint: AgentBlueprint): Promise<any> {
        console.log(`[AGENT FACTORY] 🏗️ Architecting new agent: ${blueprint.roleName}`);

        // 1. Search Universal Knowledge for "Best Practices" related to this role
        const query = `expert prompt system instruction for ${blueprint.roleName} ${blueprint.skills.join(' ')}`;
        const embedding = await geminiService.generateEmbedding(query);

        let expertContext = "";
        let sources: string[] = [];

        if (embedding) {
            const results = await lancedbService.searchKnowledge(embedding, 5);
            results.forEach(r => {
                expertContext += `\n--- SOURCE: ${r.path} ---\n${r.content.substring(0, 500)}...\n`;
                sources.push(r.path);
            });
            console.log(`[AGENT FACTORY] 📚 Found ${results.length} expert references.`);
        }

        // 2. Synthesize the "Super Prompt" using the Architect Persona
        const systemPrompt = `
        ROLE: The Architect (System Meta-Designer for Silhouette Agency OS).
        TASK: Construct a JSON definition for a new AI Agent.
        
        ${this.getOrganizationalContext()}
        
        TARGET AGENT:
        - Role: ${blueprint.roleName}
        - Description: ${blueprint.description}
        - Proposed Category: ${blueprint.category}
        - Skills: ${blueprint.skills.join(', ')}

        REFERENCE KNOWLEDGE (Universal Library):
        ${expertContext}

        INSTRUCTION:
        Design this agent considering Silhouette's organizational structure:
        1. Which TIER is appropriate? (CORE/SPECIALIST/WORKER)
           - CORE: Critical, always active (rare)
           - SPECIALIST: Expert, high priority (for complex domains)
           - WORKER: Execution, on-demand (most common)
        
        2. Which SQUAD should it belong to?
           - Use existing squad if appropriate (TEAM_XXX)
           - Or create new dynamic squad (SQ_XXX) for specific domain
        
        3. Should it be a LEADER or WORKER within its squad?
           - LEADER: Decision maker, coordinates workers
           - WORKER: Executor, follows leader's direction
        
        4. What communication protocols will it use?
           - Who will it frequently interact with?
           - What priority level for its messages?
        
        Synthesize the provided knowledge into a highly robust, professional System Instruction.
        The instruction should be authoritative, detailed, and use correct protocols.
        
        OUTPUT FORMAT (JSON ONLY):
        {
            "id": "generated_id (kebab-case)",
            "name": "${blueprint.roleName}",
            "roleType": "LEADER or WORKER",
            "category": "${blueprint.category}",
            "tier": "CORE, SPECIALIST, or WORKER",
            "teamId": "TEAM_XXX or SQ_XXX",
            "systemInstruction": "The full synthesized prompt with organizational awareness...",
            "description": "${blueprint.description}",
            "capabilities": ["Determine best capabilities based on skills"],
            "communicationProtocol": {
                "preferredLevel": "NORMAL",
                "frequentContacts": ["agent-id-1", "agent-id-2"],
                "mailboxPriority": "NORMAL"
            },
            "directives": ["Primary directive based on role"],
            "initialOpinion": "Initial perspective statement"
        }
        `;

        const response = await geminiService.generateText(systemPrompt);

        try {
            // Clean markdown code blocks
            let cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();

            // Extract JSON object if embedded in text
            const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanJson = jsonMatch[0];
            }

            // Debug: Log if parsing looks problematic
            if (!cleanJson.startsWith('{') || !cleanJson.endsWith('}')) {
                console.warn("[AGENT FACTORY] ⚠️ Response may not be valid JSON. Raw:", cleanJson.substring(0, 200));
            }

            const agentDefinition = JSON.parse(cleanJson);

            // Add metadata
            agentDefinition.metadata = {
                createdBy: 'AgentFactory',
                sources: sources,
                timestamp: Date.now()
            };

            return agentDefinition;

        } catch (e) {
            console.error("[AGENT FACTORY] ❌ Failed to parse Architect Output.", e);
            console.error("[AGENT FACTORY] 📝 Raw Response (first 500 chars):", response.substring(0, 500));
            throw new Error("Architect failed to produce valid definition.");
        }
    }

    /**
     * Analyze an existing agent against best practices from universalprompts
     */
    public async analyzeAgent(agent: Agent): Promise<AgentAnalysis> {
        console.log(`[AGENT FACTORY] 🔍 Analyzing agent: ${agent.name}`);

        // Get best practices for this type of agent
        const query = `best practices system prompt for ${agent.category} ${agent.role} AI agent`;
        const embedding = await geminiService.generateEmbedding(query);

        let bestPractices = "";
        if (embedding) {
            const results = await lancedbService.searchKnowledge(embedding, 5);
            results.forEach(r => {
                bestPractices += `\n${r.content.substring(0, 800)}\n`;
            });
        }

        // Get available tools for context
        const availableTools = toolRegistry.getAllTools().map(t => t.name).join(', ');

        const analysisPrompt = `
You are an expert AI Agent Auditor. Analyze this agent against industry best practices.

AGENT UNDER REVIEW:
- Name: ${agent.name}
- Category: ${agent.category}
- Role: ${agent.role || 'General Worker'}
- Status: ${agent.status}
- Tier: ${agent.tier}

BEST PRACTICES FROM EXPERT SYSTEMS:
${bestPractices}

AVAILABLE TOOLS IN SYSTEM:
${availableTools}

TASK:
1. Identify STRENGTHS of this agent
2. Identify WEAKNESSES compared to best practices
3. Suggest specific IMPROVEMENTS
4. Rate this agent 0-100 vs best practices

OUTPUT FORMAT (JSON ONLY):
{
    "strengths": ["strength1", "strength2"],
    "weaknesses": ["weakness1", "weakness2"],
    "improvementSuggestions": [
        {
            "area": "PROMPT|CAPABILITIES|TOOLS|WORKFLOW",
            "description": "What to improve",
            "priority": "HIGH|MEDIUM|LOW",
            "implementation": "How to implement"
        }
    ],
    "comparisonScore": 75
}
`;

        try {
            const response = await geminiService.generateText(analysisPrompt);
            const jsonMatch = response.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('Failed to parse analysis');
            }

            const analysis = JSON.parse(jsonMatch[0]);
            return {
                agentId: agent.id,
                ...analysis
            };
        } catch (error) {
            console.error(`[AGENT FACTORY] Failed to analyze ${agent.name}:`, error);
            return {
                agentId: agent.id,
                strengths: [],
                weaknesses: ['Analysis failed'],
                improvementSuggestions: [],
                comparisonScore: 0
            };
        }
    }

    /**
     * Evolve an existing agent - improve its definition using universalprompts
     */
    public async evolveAgent(agent: Agent): Promise<any> {
        console.log(`[AGENT FACTORY] 🧬 Evolving agent: ${agent.name}`);

        // First, analyze the agent
        const analysis = await this.analyzeAgent(agent);

        if (analysis.comparisonScore >= 90) {
            console.log(`[AGENT FACTORY] ✅ Agent ${agent.name} is already highly optimized (${analysis.comparisonScore}/100)`);
            return { evolved: false, reason: 'Already optimized', score: analysis.comparisonScore };
        }

        // Get improvement knowledge
        const weaknessQuery = analysis.weaknesses.join(' ') + ' improvement solution';
        const embedding = await geminiService.generateEmbedding(weaknessQuery);

        let improvementKnowledge = "";
        if (embedding) {
            const results = await lancedbService.searchKnowledge(embedding, 5);
            results.forEach(r => {
                improvementKnowledge += `\n${r.content.substring(0, 600)}\n`;
            });
        }

        const evolutionPrompt = `
You are the Agent Evolver. Your task is to upgrade an existing agent definition.

CURRENT AGENT:
- Name: ${agent.name}
- Category: ${agent.category}
- Role: ${agent.role}
- Current Score: ${analysis.comparisonScore}/100

IDENTIFIED WEAKNESSES:
${analysis.weaknesses.join('\n- ')}

TOP IMPROVEMENTS NEEDED:
${analysis.improvementSuggestions.slice(0, 3).map(s => `- ${s.area}: ${s.description}`).join('\n')}

KNOWLEDGE TO APPLY:
${improvementKnowledge}

TASK:
Create an EVOLVED version of this agent that addresses the weaknesses.
Keep the core identity but significantly improve capabilities and instructions.

OUTPUT FORMAT (JSON ONLY):
{
    "id": "${agent.id}",
    "name": "${agent.name}",
    "category": "${agent.category}",
    "systemInstruction": "The new, improved system instruction...",
    "capabilities": ["New enhanced capabilities"],
    "improvements": ["List of improvements made"],
    "projectedScore": 85
}
`;

        try {
            const response = await geminiService.generateText(evolutionPrompt);
            const jsonMatch = response.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('Failed to parse evolution output');
            }

            const evolvedAgent = JSON.parse(jsonMatch[0]);
            evolvedAgent.metadata = {
                evolvedBy: 'AgentFactory',
                previousScore: analysis.comparisonScore,
                evolvedAt: Date.now()
            };

            console.log(`[AGENT FACTORY] 🚀 Evolved ${agent.name}: ${analysis.comparisonScore} → ${evolvedAgent.projectedScore}`);
            return { evolved: true, agent: evolvedAgent, analysis };

        } catch (error) {
            console.error(`[AGENT FACTORY] Failed to evolve ${agent.name}:`, error);
            return { evolved: false, error: String(error) };
        }
    }

    /**
     * DYNAMIC AGENT SPAWNING
     * Creates a specialized agent on-the-fly for a specific task.
     * Uses backgroundLLM to analyze the task and generate the optimal agent.
     */
    public async spawnForTask(taskDescription: string): Promise<Agent | null> {
        console.log(`[AGENT FACTORY] 🚀 Spawning agent for task: "${taskDescription.substring(0, 50)}..."`);

        try {
            // 1. Analyze task to determine best agent type
            const analysisPrompt = `Analyze this task and determine the best agent type:
Task: ${taskDescription}

Available agent categories: CORE, WORKFLOW, MEDIA, DATA, RESEARCH, CREATIVE, CODE
Available tools: ${toolRegistry.getAllTools().map(t => t.name).slice(0, 10).join(', ')}

Respond with JSON:
{
    "category": "CATEGORY_NAME",
    "roleName": "Descriptive Role Name",
    "skills": ["skill1", "skill2", "skill3"],
    "requiredTools": ["tool_name1", "tool_name2"],
    "reason": "Why this type of agent is best for this task"
}`;

            const analysisResponse = await backgroundLLM.generate(analysisPrompt, {
                taskType: 'ANALYSIS',
                priority: 'MEDIUM'
            });

            // Parse analysis
            const jsonMatch = analysisResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to analyze task');
            }

            const analysis = JSON.parse(jsonMatch[0]);
            console.log(`[AGENT FACTORY] 📊 Task analysis: ${analysis.category} - ${analysis.roleName}`);

            // 2. Search universalprompts for relevant patterns
            const patternQuery = `${analysis.category} ${analysis.skills.join(' ')} agent system prompt best practices`;
            const embedding = await geminiService.generateEmbedding(patternQuery);

            let patternContext = "";
            if (embedding) {
                const results = await lancedbService.searchKnowledge(embedding, 3);
                results.forEach(r => {
                    patternContext += `\n--- PATTERN: ${r.path} ---\n${r.content.substring(0, 400)}...\n`;
                });
            }

            // 3. Generate the agent using architectAgent
            const blueprint: AgentBlueprint = {
                roleName: analysis.roleName,
                description: taskDescription,
                category: analysis.category as AgentCategory,
                skills: analysis.skills
            };

            const agentDefinition = await this.architectAgent(blueprint);

            // 4. Convert to Agent type (conforming to Agent interface)
            const spawnedAgent: Agent = {
                id: agentDefinition.id || `spawned_${Date.now()}`,
                name: agentDefinition.name,
                teamId: 'dynamic',
                role: analysis.roleName,
                roleType: AgentRoleType.WORKER,
                category: analysis.category as AgentCategory,
                status: AgentStatus.IDLE,
                tier: AgentTier.WORKER, // Ephemeral by default
                enabled: true,
                preferredMemory: 'RAM',
                memoryLocation: 'RAM',
                cpuUsage: 0,
                ramUsage: 0,
                lastActive: Date.now(),
                currentTask: taskDescription.substring(0, 100),
                capabilities: agentDefinition.capabilities || analysis.skills,
                // [PHASE 17] Standardization
                memoryId: `mem_${agentDefinition.id || Date.now()}`,
                directives: agentDefinition.directives || [`Execute task: ${taskDescription}`],
                opinion: agentDefinition.initialOpinion || "I am ready to work."
            };

            console.log(`[AGENT FACTORY] ✅ Spawned agent: ${spawnedAgent.name} (${spawnedAgent.id})`);

            // Emit AGENT_SPAWNED event for CapabilityAwarenessService
            systemBus.emit(SystemProtocol.AGENT_SPAWNED, {
                agent: spawnedAgent
            }, 'AgentFactory');

            return spawnedAgent;

        } catch (error: any) {
            console.error(`[AGENT FACTORY] ❌ Failed to spawn agent:`, error.message);
            return null;
        }
    }

    /**
     * Batch evolve multiple agents
     */
    public async evolveAll(agents: Agent[]): Promise<{
        total: number;
        evolved: number;
        skipped: number;
        failed: number;
        results: any[];
    }> {
        console.log(`[AGENT FACTORY] 🧬 Starting batch evolution for ${agents.length} agents...`);

        const results: any[] = [];
        let evolved = 0, skipped = 0, failed = 0;

        for (const agent of agents) {
            try {
                const result = await this.evolveAgent(agent);
                results.push({ agent: agent.name, ...result });

                if (result.evolved) evolved++;
                else if (result.reason === 'Already optimized') skipped++;
                else failed++;

            } catch (error) {
                results.push({ agent: agent.name, error: String(error) });
                failed++;
            }
        }

        console.log(`[AGENT FACTORY] ✅ Batch evolution complete: ${evolved} evolved, ${skipped} skipped, ${failed} failed`);
        return { total: agents.length, evolved, skipped, failed, results };
    }
}

export const agentFactory = new AgentFactory();

