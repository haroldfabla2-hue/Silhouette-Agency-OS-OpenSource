/**
 * PLAN GENERATOR SERVICE
 * 
 * Converts user intent into a multi-step execution plan.
 * The plan specifies which agents handle each step, in what order,
 * and with what custom prompts.
 * 
 * Key features:
 * - Intent analysis to determine complexity
 * - Agent selection based on task requirements
 * - Dependency graph for step ordering
 * - Token/RPM estimation for resource management
 */

import { v4 as uuidv4 } from 'uuid';
import { geminiService } from './geminiService';
import { agentRegistry } from './registry/AgentRegistry';
import { AgentCapability, CommunicationLevel } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PlanStep {
    order: number;
    agentId: string;
    agentRole: string;
    taskDescription: string;
    customPrompt?: string;
    dependsOn: number[];  // Step numbers this step depends on
    priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
    estimatedTokens: number;
    requiredCapabilities: AgentCapability[];
}

export interface ExecutionPlan {
    id: string;
    originalRequest: string;
    intent: string;
    complexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
    steps: PlanStep[];
    estimatedTotalTokens: number;
    estimatedRPM: number;
    createdAt: number;
}

export interface IntentAnalysis {
    intent: string;
    complexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
    requiredCapabilities: AgentCapability[];
    suggestedAgents: string[];
    needsResearch: boolean;
    needsCreative: boolean;
    needsExecution: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT ROLE MAPPING
// ═══════════════════════════════════════════════════════════════════════════

const CAPABILITY_TO_AGENT: Record<string, string[]> = {
    'research': ['sci-03', 'ctx-01'],           // Researcher_Pro, Context Lead
    'synthesis': ['sci-02', 'sci-01'],          // Research_Synthesizer, Science Lead
    'code': ['dev-01', 'dev-02', 'dev-03'],     // Developer agents
    'creative': ['mkt-lead', 'mkt-01'],         // Creative Director, Marketing
    'qa': ['qa-01', 'qa-02'],                   // QA agents
    'planning': ['core-strategy'],              // Strategos_X
    'memory': ['mem-01'],                       // Memory Agent
    'default': ['manager']                      // ManagerAgent fallback
};

// ═══════════════════════════════════════════════════════════════════════════
// PLAN GENERATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

class PlanGenerator {
    private readonly SIMPLE_THRESHOLD = 50;   // tokens
    private readonly COMPLEX_THRESHOLD = 200; // tokens

    /**
     * Analyze user intent and generate an execution plan
     */
    public async create(userRequest: string): Promise<ExecutionPlan> {
        console.log(`[PLAN_GENERATOR] 📋 Creating plan for: "${userRequest.substring(0, 50)}..."`);

        // 1. Analyze intent
        const analysis = await this.analyzeIntent(userRequest);
        console.log(`[PLAN_GENERATOR] 🎯 Intent: ${analysis.intent} (${analysis.complexity})`);

        // 2. Generate steps based on complexity
        let steps: PlanStep[];

        switch (analysis.complexity) {
            case 'SIMPLE':
                steps = this.generateSimplePlan(userRequest, analysis);
                break;
            case 'MODERATE':
                steps = this.generateModeratePlan(userRequest, analysis);
                break;
            case 'COMPLEX':
                steps = await this.generateComplexPlan(userRequest, analysis);
                break;
            default:
                steps = this.generateSimplePlan(userRequest, analysis);
        }

        // 3. Calculate estimates
        const estimatedTotalTokens = steps.reduce((sum, s) => sum + s.estimatedTokens, 0);
        const estimatedRPM = steps.length; // Each step = 1 API call

        const plan: ExecutionPlan = {
            id: `plan_${uuidv4().substring(0, 8)}`,
            originalRequest: userRequest,
            intent: analysis.intent,
            complexity: analysis.complexity,
            steps,
            estimatedTotalTokens,
            estimatedRPM,
            createdAt: Date.now()
        };

        console.log(`[PLAN_GENERATOR] ✅ Plan created: ${steps.length} steps, ~${estimatedTotalTokens} tokens`);
        return plan;
    }

    /**
     * Analyze the user's intent using LLM
     */
    private async analyzeIntent(userRequest: string): Promise<IntentAnalysis> {
        const prompt = `Analyze this user request and return JSON:
"${userRequest}"

Return ONLY valid JSON:
{
    "intent": "brief description of what user wants",
    "complexity": "SIMPLE" | "MODERATE" | "COMPLEX",
    "requiredCapabilities": ["research", "code", "creative", "qa", "planning"],
    "needsResearch": boolean,
    "needsCreative": boolean,
    "needsExecution": boolean
}

COMPLEXITY GUIDE:
- SIMPLE: Single action, quick response (greeting, simple question, lookup)
- MODERATE: 2-3 steps, some context needed (explain + example, research + summarize)
- COMPLEX: 4+ steps, multiple specialists (build feature, create campaign, analyze deeply)`;

        try {
            const response = await geminiService.generateAgentResponse(
                'Intent_Analyzer',
                'PlanGenerator',
                'CORE',
                prompt,
                null,
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.TECHNICAL,
                'gemini-1.5-flash' // Fast model for analysis
            );

            const json = JSON.parse(response.output.replace(/```json/g, '').replace(/```/g, '').trim());

            return {
                intent: json.intent || 'general request',
                complexity: json.complexity || 'SIMPLE',
                requiredCapabilities: json.requiredCapabilities || [],
                suggestedAgents: this.mapCapabilitiesToAgents(json.requiredCapabilities || []),
                needsResearch: json.needsResearch || false,
                needsCreative: json.needsCreative || false,
                needsExecution: json.needsExecution || false
            };
        } catch (e) {
            console.warn('[PLAN_GENERATOR] Intent analysis failed, using defaults:', e);
            return {
                intent: 'general request',
                complexity: 'SIMPLE',
                requiredCapabilities: [],
                suggestedAgents: ['manager'],
                needsResearch: false,
                needsCreative: false,
                needsExecution: false
            };
        }
    }

    /**
     * Map required capabilities to agent IDs
     */
    private mapCapabilitiesToAgents(capabilities: string[]): string[] {
        const agents: Set<string> = new Set();

        for (const cap of capabilities) {
            const mapped = CAPABILITY_TO_AGENT[cap.toLowerCase()];
            if (mapped) {
                agents.add(mapped[0]); // Take primary agent for capability
            }
        }

        if (agents.size === 0) {
            agents.add('manager');
        }

        return Array.from(agents);
    }

    /**
     * Generate a simple 1-step plan (direct response)
     */
    private generateSimplePlan(request: string, analysis: IntentAnalysis): PlanStep[] {
        return [{
            order: 1,
            agentId: 'manager',
            agentRole: 'ManagerAgent',
            taskDescription: request,
            dependsOn: [],
            priority: 'NORMAL',
            estimatedTokens: 500,
            requiredCapabilities: []
        }];
    }

    /**
     * Generate a moderate 2-3 step plan
     */
    private generateModeratePlan(request: string, analysis: IntentAnalysis): PlanStep[] {
        const steps: PlanStep[] = [];
        let order = 1;

        // Step 1: Research if needed
        if (analysis.needsResearch) {
            steps.push({
                order: order++,
                agentId: 'sci-03',
                agentRole: 'Researcher_Pro',
                taskDescription: `Research the following topic to gather information: "${request}"`,
                dependsOn: [],
                priority: 'HIGH',
                estimatedTokens: 800,
                requiredCapabilities: [AgentCapability.RESEARCH]
            });
        }

        // Step 2: Process/Create if needed
        if (analysis.needsCreative) {
            steps.push({
                order: order++,
                agentId: 'mkt-lead',
                agentRole: 'Creative_Director',
                taskDescription: `Create content based on: "${request}"`,
                dependsOn: analysis.needsResearch ? [1] : [],
                priority: 'NORMAL',
                estimatedTokens: 600,
                requiredCapabilities: [AgentCapability.VISUAL_DESIGN]
            });
        }

        // Final Step: Synthesize and respond
        steps.push({
            order: order++,
            agentId: 'manager',
            agentRole: 'ManagerAgent',
            taskDescription: `Synthesize results and respond to: "${request}"`,
            dependsOn: steps.length > 0 ? [steps.length] : [],
            priority: 'NORMAL',
            estimatedTokens: 500,
            requiredCapabilities: []
        });

        return steps;
    }

    /**
     * Generate a complex multi-step plan using LLM
     */
    private async generateComplexPlan(request: string, analysis: IntentAnalysis): Promise<PlanStep[]> {
        const availableAgents = agentRegistry.getAllAgents()
            .map(a => `- ${a.id}: ${a.role} (${a.capabilities?.join(', ') || 'general'})`)
            .join('\n');

        const prompt = `Create an execution plan for this complex request:
"${request}"

Available agents:
${availableAgents}

Return ONLY valid JSON array of steps:
[
    {
        "order": 1,
        "agentId": "agent-id",
        "agentRole": "Agent Role Name",
        "taskDescription": "Specific task for this agent",
        "dependsOn": [],
        "priority": "CRITICAL|HIGH|NORMAL|LOW"
    }
]

RULES:
- Maximum 5 steps
- Use dependsOn to chain steps that need previous results
- Start with research/planning, end with synthesis
- Include specific, actionable task descriptions`;

        try {
            const response = await geminiService.generateAgentResponse(
                'Plan_Architect',
                'PlanGenerator',
                'CORE',
                prompt,
                null,
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.TECHNICAL
            );

            const steps = JSON.parse(response.output.replace(/```json/g, '').replace(/```/g, '').trim());

            return steps.map((s: any) => ({
                order: s.order,
                agentId: s.agentId || 'manager',
                agentRole: s.agentRole || 'ManagerAgent',
                taskDescription: s.taskDescription,
                dependsOn: s.dependsOn || [],
                priority: s.priority || 'NORMAL',
                estimatedTokens: 600,
                requiredCapabilities: []
            }));
        } catch (e) {
            console.warn('[PLAN_GENERATOR] Complex plan generation failed, using moderate plan:', e);
            return this.generateModeratePlan(request, analysis);
        }
    }

    /**
     * Validate a plan for correctness
     */
    public validatePlan(plan: ExecutionPlan): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Check for empty steps
        if (plan.steps.length === 0) {
            errors.push('Plan has no steps');
        }

        // Check for circular dependencies
        for (const step of plan.steps) {
            if (step.dependsOn.includes(step.order)) {
                errors.push(`Step ${step.order} depends on itself`);
            }

            for (const dep of step.dependsOn) {
                if (dep >= step.order) {
                    errors.push(`Step ${step.order} depends on future step ${dep}`);
                }
            }
        }

        // Check for missing agents
        for (const step of plan.steps) {
            if (!step.agentId || !step.agentRole) {
                errors.push(`Step ${step.order} missing agent information`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

export const planGenerator = new PlanGenerator();
