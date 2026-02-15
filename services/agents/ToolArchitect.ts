/**
 * TOOL ARCHITECT - Meta-Evolution Agent for Tool Creation
 * 
 * A specialized agent that:
 * 1. Analyzes existing agents to identify capability gaps
 * 2. Queries universalprompts via LanceDB for best patterns
 * 3. Creates tools that agents need to work effectively
 * 4. Works in tandem with AgentFactory for continuous improvement
 * 
 * Part of the Meta-Evolution System (Phase 3)
 */

import { lancedbService } from '../lancedbService';
import { geminiService } from '../geminiService';
import { backgroundLLM } from '../backgroundLLMService';
import { toolFactory, ToolCreationRequest, ToolInput } from '../tools/toolFactory';
import { toolRegistry, ToolCategory, DynamicTool } from '../tools/toolRegistry';
import { systemBus } from '../systemBus';
import { SystemProtocol, Agent, AgentCategory } from '../../types';

// ==================== INTERFACES ====================

export interface AgentCapabilityGap {
    agentId: string;
    agentName: string;
    category: AgentCategory;
    missingCapabilities: string[];
    suggestedTools: ToolSuggestion[];
}

export interface ToolSuggestion {
    name: string;
    purpose: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
    basedOn?: string; // Source from universalprompts
}

export interface EvolutionReport {
    timestamp: number;
    agentsAnalyzed: number;
    gapsIdentified: AgentCapabilityGap[];
    toolsCreated: string[];
    totalImprovements: number;
}

// ==================== TOOL ARCHITECT ====================

class ToolArchitect {
    private static instance: ToolArchitect;

    private constructor() { }

    public static getInstance(): ToolArchitect {
        if (!ToolArchitect.instance) {
            ToolArchitect.instance = new ToolArchitect();
        }
        return ToolArchitect.instance;
    }

    /**
     * Analyze a single agent and identify capability gaps
     */
    public async analyzeAgent(agent: Agent): Promise<AgentCapabilityGap> {
        console.log(`[ToolArchitect] 🔍 Analyzing agent: ${agent.name}`);

        // Get current tools available to this agent category
        const categoryTools = toolRegistry.getToolsByCategory(
            this.mapAgentCategoryToToolCategory(agent.category)
        );
        const availableToolNames = categoryTools.map(t => t.name);

        // Query universalprompts for what tools this type of agent SHOULD have
        const query = `tools capabilities functions for ${agent.category} ${agent.role} agent`;
        const embedding = await geminiService.generateEmbedding(query);

        let expertKnowledge = "";
        let sources: string[] = [];

        if (embedding) {
            const results = await lancedbService.searchKnowledge(embedding, 5);
            results.forEach(r => {
                expertKnowledge += `\n--- ${r.path} ---\n${r.content.substring(0, 1000)}\n`;
                sources.push(r.path);
            });
        }

        // Use LLM to identify gaps
        const analysisPrompt = `
You are the Tool Architect, an expert at analyzing AI agents and identifying their capability gaps.

AGENT UNDER ANALYSIS:
- Name: ${agent.name}
- Category: ${agent.category}
- Role: ${agent.role || 'General'}
- Current Status: ${agent.status}

CURRENTLY AVAILABLE TOOLS:
${availableToolNames.join(', ') || 'None specific to this category'}

EXPERT KNOWLEDGE FROM UNIVERSAL LIBRARY:
${expertKnowledge}

TASK:
Identify what capabilities this agent is MISSING to be more effective.
Compare against industry best practices from the expert knowledge.

OUTPUT FORMAT (JSON ONLY):
{
    "missingCapabilities": ["capability1", "capability2"],
    "suggestedTools": [
        {
            "name": "tool_name_snake_case",
            "purpose": "What the tool does",
            "priority": "HIGH|MEDIUM|LOW",
            "reason": "Why this agent needs this tool",
            "basedOn": "Source from universal library if applicable"
        }
    ]
}
`;

        try {
            // Use GENERAL task (ZhipuAI - FREE) for analysis
            const response = await backgroundLLM.generate(analysisPrompt, {
                taskType: 'GENERAL',
                priority: 'LOW'
            });
            const jsonMatch = response.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('Failed to parse analysis');
            }

            const analysis = JSON.parse(jsonMatch[0]);

            return {
                agentId: agent.id,
                agentName: agent.name,
                category: agent.category,
                missingCapabilities: analysis.missingCapabilities || [],
                suggestedTools: analysis.suggestedTools || []
            };
        } catch (error) {
            console.error(`[ToolArchitect] ❌ Failed to analyze ${agent.name}:`, error);
            return {
                agentId: agent.id,
                agentName: agent.name,
                category: agent.category,
                missingCapabilities: [],
                suggestedTools: []
            };
        }
    }

    /**
     * Analyze all agents and identify system-wide gaps
     */
    public async analyzeAllAgents(agents: Agent[]): Promise<AgentCapabilityGap[]> {
        console.log(`[ToolArchitect] 🔬 Analyzing ${agents.length} agents for capability gaps...`);

        const gaps: AgentCapabilityGap[] = [];

        for (const agent of agents) {
            const gap = await this.analyzeAgent(agent);
            if (gap.suggestedTools.length > 0) {
                gaps.push(gap);
            }
        }

        console.log(`[ToolArchitect] 📊 Found ${gaps.length} agents with capability gaps`);
        return gaps;
    }

    /**
     * Create a tool based on a suggestion, using universalprompts as reference
     */
    public async createToolFromSuggestion(suggestion: ToolSuggestion): Promise<DynamicTool | null> {
        console.log(`[ToolArchitect] 🏗️ Creating tool from suggestion: ${suggestion.name}`);

        // Check if tool already exists
        if (toolRegistry.hasTool(suggestion.name)) {
            console.log(`[ToolArchitect] ⚠️ Tool already exists: ${suggestion.name}`);
            return null;
        }

        // Search universalprompts for implementation patterns
        const query = `implementation function tool ${suggestion.name} ${suggestion.purpose}`;
        const embedding = await geminiService.generateEmbedding(query);

        let implementationPatterns = "";
        if (embedding) {
            const results = await lancedbService.searchKnowledge(embedding, 3);
            results.forEach(r => {
                implementationPatterns += `\n${r.content.substring(0, 800)}\n`;
            });
        }

        // Use LLM to design the tool
        const designPrompt = `
You are the Tool Architect. Design a complete tool specification.

TOOL TO CREATE:
- Name: ${suggestion.name}
- Purpose: ${suggestion.purpose}
- Priority: ${suggestion.priority}
- Reason: ${suggestion.reason}

REFERENCE PATTERNS FROM EXPERT SYSTEMS:
${implementationPatterns}

Design the tool following best practices. Include proper input validation.

OUTPUT FORMAT (JSON ONLY):
{
    "name": "${suggestion.name}",
    "purpose": "${suggestion.purpose}",
    "category": "MEDIA|RESEARCH|ASSET|WORKFLOW|UTILITY",
    "inputs": [
        {"name": "param_name", "type": "string|number|boolean|array", "description": "...", "required": true}
    ],
    "output": "Description of what the tool returns",
    "implementation": "COMPOSE",
    "steps": [
        {"toolName": "existing_tool", "inputMapping": {"param": "{{input}}"}, "outputAs": "result"}
    ],
    "tags": ["tag1", "tag2"]
}

If no existing tools can be composed, use implementation: "CODE" with sandbox: true.
`;

        try {
            // Use CODE task (DeepSeek) for tool design - this is where we need code expertise
            const response = await backgroundLLM.generate(designPrompt, {
                taskType: 'CODE',
                priority: 'MEDIUM'
            });
            const jsonMatch = response.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('Failed to parse tool design');
            }

            const toolSpec = JSON.parse(jsonMatch[0]) as ToolCreationRequest;

            // Create the tool via factory
            const tool = await toolFactory.createTool(toolSpec);

            // Emit event
            systemBus.emit(SystemProtocol.UI_REFRESH, {
                source: 'TOOL_ARCHITECT',
                message: `Created tool: ${tool.name}`,
                tool: tool.name
            });

            return tool;
        } catch (error) {
            console.error(`[ToolArchitect] ❌ Failed to create tool ${suggestion.name}:`, error);
            return null;
        }
    }

    /**
     * Execute a full evolution cycle: analyze all agents, create needed tools
     */
    public async evolve(agents: Agent[]): Promise<EvolutionReport> {
        console.log('[ToolArchitect] 🧬 Starting evolution cycle...');
        const startTime = Date.now();

        // 1. Analyze all agents
        const gaps = await this.analyzeAllAgents(agents);

        // 2. Collect all high-priority suggestions
        const highPrioritySuggestions: ToolSuggestion[] = [];
        for (const gap of gaps) {
            for (const suggestion of gap.suggestedTools) {
                if (suggestion.priority === 'HIGH') {
                    highPrioritySuggestions.push(suggestion);
                }
            }
        }

        // 3. Create tools (limit to prevent runaway)
        const MAX_TOOLS_PER_CYCLE = 3;
        const toolsToCreate = highPrioritySuggestions.slice(0, MAX_TOOLS_PER_CYCLE);
        const createdTools: string[] = [];

        for (const suggestion of toolsToCreate) {
            const tool = await this.createToolFromSuggestion(suggestion);
            if (tool) {
                createdTools.push(tool.name);
            }
        }

        const report: EvolutionReport = {
            timestamp: Date.now(),
            agentsAnalyzed: agents.length,
            gapsIdentified: gaps,
            toolsCreated: createdTools,
            totalImprovements: createdTools.length
        };

        console.log(`[ToolArchitect] ✅ Evolution cycle complete in ${Date.now() - startTime}ms`);
        console.log(`[ToolArchitect] 📊 Created ${createdTools.length} new tools`);

        return report;
    }

    /**
     * Get tool recommendations for a specific capability
     */
    public async recommendToolsFor(capability: string): Promise<ToolSuggestion[]> {
        console.log(`[ToolArchitect] 🎯 Getting recommendations for: ${capability}`);

        const query = `tools for ${capability} capability function`;
        const embedding = await geminiService.generateEmbedding(query);

        let expertKnowledge = "";
        if (embedding) {
            const results = await lancedbService.searchKnowledge(embedding, 5);
            results.forEach(r => {
                expertKnowledge += `\n${r.content.substring(0, 500)}\n`;
            });
        }

        const prompt = `
Based on the following expert knowledge, suggest tools for the capability: "${capability}"

EXPERT KNOWLEDGE:
${expertKnowledge}

OUTPUT FORMAT (JSON array):
[
    {
        "name": "tool_name",
        "purpose": "What it does",
        "priority": "HIGH",
        "reason": "Why it's needed"
    }
]
`;

        try {
            const response = await geminiService.generateText(prompt);
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (error) {
            console.error('[ToolArchitect] Failed to get recommendations:', error);
        }

        return [];
    }

    // ==================== PRIVATE HELPERS ====================

    private mapAgentCategoryToToolCategory(category: AgentCategory): ToolCategory {
        const mapping: Record<string, ToolCategory> = {
            'CREATIVE': 'MEDIA',
            'TECHNICAL': 'UTILITY',
            'RESEARCH': 'RESEARCH',
            'ADMINISTRATIVE': 'WORKFLOW',
            'COMMUNICATION': 'WORKFLOW'
        };
        return mapping[category] || 'UTILITY';
    }
}

export const toolArchitect = ToolArchitect.getInstance();
