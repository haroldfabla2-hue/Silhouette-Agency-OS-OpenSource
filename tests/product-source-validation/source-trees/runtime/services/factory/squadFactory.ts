import { backgroundLLM } from '../backgroundLLMService';
import { agentFactory, AgentBlueprint } from './AgentFactory';
import { Agent, AgentCategory, AgentRoleType, AgentTier, AgentStatus, SystemProtocol } from '../../types';
import { lancedbService } from '../lancedbService';
import { geminiService } from '../geminiService';
import { systemBus } from '../systemBus';

export interface SquadRequest {
    goal: string;
    budget?: 'ECO' | 'BALANCED' | 'HIGH';
    context?: string;
}

export interface SquadMemberBlueprint {
    roleName: string;
    category: AgentCategory;
    focus: string;
    tier: AgentTier;
}

export interface SquadBlueprint {
    name: string;
    description: string;
    strategy: string;
    members: SquadMemberBlueprint[];
}

export interface Squad {
    id: string;
    name: string;
    goal: string;
    leaderId: string;
    memberIds: string[];
    agents: Agent[];
    createdAt: number;
}

export class SquadFactory {

    /**
     * Decomposes a high-level goal into a squad structure
     */
    private async designSquad(request: SquadRequest): Promise<SquadBlueprint> {
        console.log(`[SQUAD FACTORY] 🧠 Designing squad for goal: "${request.goal}"`);

        const systemPrompt = `
        ROLE: Elite Organizational Architect.
        TASK: Design an AI Agent Squad (Team) to achieve a specific goal.
        
        GOAL: "${request.goal}"
        CONTEXT: "${request.context || 'General Task'}"
        BUDGET: ${request.budget || 'BALANCED'}

        Available Tiers:
        - CORE: Critical, always online (Use sparingly, max 1)
        - SPECIALIST: Expert, high capability (Use for key roles)
        - WORKER: Execution, task-focused (Use for bulk work)

        Available Categories:
        - CORE, WORKFLOW, MEDIA, DATA, RESEARCH, CREATIVE, CODE, USER, SOCIAL, FINANCE

        INSTRUCTIONS:
        1. Define a Squad Name (e.g., "Alpha Marketing Team").
        2. Define a high-level Strategy.
        3. Break down the goal into 3-5 distinct roles.
        4. Assign a Leader (SPECIALIST/CORE) and Members (WORKER/SPECIALIST).
        5. Justify the composition.

        OUTPUT JSON:
        {
            "name": "Squad Name",
            "description": "Brief description",
            "strategy": "Execution strategy",
            "members": [
                {
                    "roleName": "Specific Role Title",
                    "category": "CATEGORY_ENUM",
                    "focus": "Main responsibility",
                    "tier": "TIER_ENUM"
                }
            ]
        }
        `;

        const response = await backgroundLLM.generate(systemPrompt, {
            taskType: 'ANALYSIS',
            priority: 'HIGH'
        });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Failed to design squad: Invalid JSON");

        return JSON.parse(jsonMatch[0]);
    }

    /**
     * Spawns a full squad based on the request
     */
    public async spawnSquad(request: SquadRequest): Promise<Squad> {
        console.log(`[SQUAD FACTORY] 🚀 Spawning Squad for: ${request.goal}`);

        // 1. Design the Squad
        const blueprint = await this.designSquad(request);
        const squadId = `SQ_${blueprint.name.replace(/\s+/g, '_').toUpperCase()}_${Date.now().toString().slice(-4)}`;

        const agents: Agent[] = [];
        const memberIds: string[] = [];
        let leaderId = '';

        console.log(`[SQUAD FACTORY] 📋 Blueprint: ${blueprint.name} (${blueprint.members.length} members)`);

        // 2. Architect and Spawn each member
        for (const memberBP of blueprint.members) {
            console.log(`[SQUAD FACTORY] 🏗️ Processing role: ${memberBP.roleName}...`);

            // [OPTIMIZATION] Phase 2a: RECRUITMENT (Semantic Search) to prevent duplicates
            // Check if we already have an agent that fits this exact role description
            let existingAgentId: string | null = null;
            let existingAgentName: string | null = null;

            try {
                const { enhancedCapabilityRegistry } = await import('../enhancedCapabilityRegistry');
                const recruitmentCandidates = await enhancedCapabilityRegistry.findProvidersIntelligent(
                    `Role: ${memberBP.roleName}. Focus: ${memberBP.focus}. Strategy: ${blueprint.strategy}`,
                    [], // No hard capability requirements for general recruitment
                    { maxAgents: 1 }
                );

                if (recruitmentCandidates.length > 0) {
                    const candidateId = recruitmentCandidates[0];
                    // We need to fetch the agent to double check confidence/relevance if possible, 
                    // but findProvidersIntelligent already filters somewhat.
                    // Ideally we'd get the score, but the interface returns IDs.
                    // As a proxy, since we asked for 1 best match, we'll assume it's good if it exists.
                    // But let's check agentPersistence to be sure it's not BUSY/CRITICAL if that matters.
                    // For now, simple recruitment:
                    existingAgentId = candidateId;
                    const { orchestrator } = await import('../orchestrator');
                    const candidate = orchestrator.getAgent(candidateId);
                    if (candidate) existingAgentName = candidate.name;
                    console.log(`[SQUAD FACTORY] 🤝 Recruited existing agent: ${existingAgentName} (${existingAgentId})`);
                }
            } catch (e) {
                console.warn("[SQUAD FACTORY] Recruitment failed, falling back to spawning:", e);
            }

            if (existingAgentId && existingAgentName) {
                // REUSE EXISTING AGENT
                agents.push({
                    ...await import('../orchestrator').then(o => o.orchestrator.getAgent(existingAgentId!)!),
                    // Update current task context maybe?
                    currentTask: `Assigned to Squad ${blueprint.name}: ${memberBP.roleName}`
                });
                memberIds.push(existingAgentId);

                // Determine leader logic for recruited agents too
                const recruitedAgent = agents[agents.length - 1];
                if (!leaderId && (recruitedAgent.roleType === AgentRoleType.LEADER || memberBP.tier !== AgentTier.WORKER)) {
                    leaderId = recruitedAgent.id;
                }

                continue; // Skip spawning
            }

            // Phase 2b: ARCHITECTURE (If recruitment failed)
            console.log(`[SQUAD FACTORY] 🧬 No existing agent found. Spawning new...`);

            const agentBlueprint: AgentBlueprint = {
                roleName: memberBP.roleName,
                description: `Member of ${blueprint.name}. Focus: ${memberBP.focus}. Strategy: ${blueprint.strategy}`,
                category: memberBP.category,
                skills: [memberBP.focus] // Initial seed
            };

            // 2c. Architect the agent
            const definition = await agentFactory.architectAgent(agentBlueprint);

            // 2d. Create Agent Instance
            const agent: Agent = {
                id: definition.id || `${squadId}_${memberBP.roleName.replace(/\s+/g, '_').toLowerCase()}`,
                name: definition.name,
                role: memberBP.roleName,
                category: memberBP.category,
                tier: memberBP.tier,
                // Assign to this Squad
                teamId: squadId,
                roleType: (memberBP.tier === AgentTier.CORE || memberBP.tier === AgentTier.SPECIALIST) ? AgentRoleType.LEADER : AgentRoleType.WORKER, // Heuristic
                status: AgentStatus.IDLE,
                enabled: true,
                preferredMemory: 'RAM',
                memoryLocation: 'RAM',
                cpuUsage: 0,
                ramUsage: 0,
                lastActive: Date.now(),
                currentTask: 'Initializing...',
                capabilities: definition.capabilities || [],
                // systemInstruction: definition.systemInstruction, // Removed as it's not in Agent type
                metadata: {
                    squadId: squadId,
                    squadName: blueprint.name,
                    createdAt: Date.now(),
                    systemInstruction: definition.systemInstruction // Store in metadata instead
                }
            };

            // 2e. Persist the new Agent
            try {
                const { agentPersistence } = await import('../agentPersistence');
                const { capabilityRegistry } = await import('../capabilityRegistry'); // Use base or enhanced, base is enough for registration

                agentPersistence.saveAgent(agent);
                capabilityRegistry.registerAgent(agent);
                console.log(`[SQUAD FACTORY] 💾 Persisted new agent: ${agent.name}`);
            } catch (err) {
                console.error(`[SQUAD FACTORY] Failed to persist agent ${agent.name}:`, err);
            }

            agents.push(agent);
            memberIds.push(agent.id);

            // Emit AGENT_SPAWNED event for CapabilityAwarenessService
            systemBus.emit(SystemProtocol.AGENT_SPAWNED, {
                agent,
                squadId
            }, 'SquadFactory');

            // Determine leader (first Specialst/Core or just first one)
            if (!leaderId && (agent.roleType === AgentRoleType.LEADER || memberBP.tier !== AgentTier.WORKER)) {
                leaderId = agent.id;
            }
        }

        // Fallback leader
        if (!leaderId && agents.length > 0) leaderId = agents[0].id;

        const squad: Squad = {
            id: squadId,
            name: blueprint.name,
            goal: request.goal,
            leaderId,
            memberIds,
            agents,
            createdAt: Date.now()
        };

        // Emit SQUAD_FORMED event for CapabilityAwarenessService
        systemBus.emit(SystemProtocol.SQUAD_FORMED, {
            squad: {
                id: squad.id,
                name: squad.name,
                category: blueprint.name.includes('Security') ? 'CYBERSEC' : 'OPS',
                leaderId: squad.leaderId,
                members: squad.memberIds
            }
        }, 'SquadFactory');

        console.log(`[SQUAD FACTORY] ✅ Squad Spawned: ${squad.name} (Leader: ${leaderId})`);
        return squad;
    }
}

export const squadFactory = new SquadFactory();
