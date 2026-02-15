/**
 * PLAN EXECUTOR SERVICE
 * 
 * Executes multi-step plans while respecting:
 * - Resource limits (RAM/CPU/VRAM via ResourceArbiter)
 * - RPM limits (via ProviderHealthManager)
 * - System congestion (via CongestionManager)
 * - Agent lifecycle (hydration/dehydration)
 * 
 * This is the "homeostatic" execution engine that maintains
 * system stability while orchestrating agent work.
 */

import { ExecutionPlan, PlanStep } from './planGenerator';
import { promptCompiler } from './promptCompiler';
import { resourceArbiter } from './resourceArbiter';
import { providerHealth } from './providerHealthManager';
import { congestionManager } from './congestionManager';
import { orchestrator } from './orchestrator';
import { geminiService } from './geminiService';
import { systemBus } from './systemBus';
import { SystemProtocol, CommunicationLevel, AgentStatus, AgentRoleType, AgentTier } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface StepResult {
    stepOrder: number;
    agentId: string;
    output: string;
    success: boolean;
    tokensUsed: number;
    executionTimeMs: number;
    error?: string;
}

export interface PlanExecutionResult {
    planId: string;
    success: boolean;
    steps: StepResult[];
    finalOutput: string;
    totalTokens: number;
    totalTimeMs: number;
    errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAN EXECUTOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

class PlanExecutor {
    private readonly MAX_WAIT_TIME_MS = 30000; // 30 seconds max wait for resources
    private readonly CONGESTION_PAUSE_MS = 2000; // 2 second pause when congested

    /**
     * Execute a plan respecting all homeostatic constraints
     */
    public async execute(plan: ExecutionPlan): Promise<PlanExecutionResult> {
        console.log(`[PLAN_EXECUTOR] 🚀 Executing plan: ${plan.id} (${plan.steps.length} steps)`);

        const startTime = Date.now();
        const results: Map<number, StepResult> = new Map();
        const errors: string[] = [];

        // Emit plan start
        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            planId: plan.id,
            status: 'STARTED',
            totalSteps: plan.steps.length
        }, 'PLAN_EXECUTOR');

        // Execute steps in order, respecting dependencies
        for (const step of plan.steps) {
            // 1. Check dependencies are complete
            const depsReady = step.dependsOn.every(dep => results.has(dep));
            if (!depsReady) {
                console.warn(`[PLAN_EXECUTOR] ⏳ Step ${step.order} waiting on dependencies: ${step.dependsOn}`);
                // In a real async system, we'd queue this. For now, we assume ordered execution.
            }

            // 2. Execute the step with all homeostatic checks
            try {
                const result = await this.executeStep(step, plan, results);
                results.set(step.order, result);

                if (!result.success) {
                    errors.push(`Step ${step.order} failed: ${result.error}`);

                    // Decide whether to continue or abort
                    if (step.priority === 'CRITICAL') {
                        console.error(`[PLAN_EXECUTOR] ❌ CRITICAL step failed. Aborting plan.`);
                        break;
                    }
                }
            } catch (e: any) {
                errors.push(`Step ${step.order} exception: ${e.message}`);
                results.set(step.order, {
                    stepOrder: step.order,
                    agentId: step.agentId,
                    output: '',
                    success: false,
                    tokensUsed: 0,
                    executionTimeMs: 0,
                    error: e.message
                });
            }
        }

        // Compile final output from all successful steps
        const successfulResults = Array.from(results.values())
            .filter(r => r.success)
            .map(r => r.output);

        // CRITICAL FIX: Synthesize final output in USER_FACING language
        // This prevents JSON from technical agents leaking into chat
        let finalOutput = 'Plan execution failed';
        if (successfulResults.length > 0) {
            finalOutput = await this.synthesizeFinalOutput(
                plan.originalRequest,
                successfulResults
            );
        }

        const totalTokens = Array.from(results.values())
            .reduce((sum, r) => sum + r.tokensUsed, 0);

        const executionResult: PlanExecutionResult = {
            planId: plan.id,
            success: errors.length === 0,
            steps: Array.from(results.values()),
            finalOutput,
            totalTokens,
            totalTimeMs: Date.now() - startTime,
            errors
        };

        // Emit plan completion
        systemBus.emit(SystemProtocol.WORKFLOW_UPDATE, {
            planId: plan.id,
            status: executionResult.success ? 'COMPLETED' : 'FAILED',
            totalSteps: plan.steps.length,
            completedSteps: results.size,
            errors: errors.length
        }, 'PLAN_EXECUTOR');

        console.log(`[PLAN_EXECUTOR] ${executionResult.success ? '✅' : '❌'} Plan ${plan.id} completed in ${executionResult.totalTimeMs}ms`);
        return executionResult;
    }

    /**
     * Execute a single step with all homeostatic checks
     */
    private async executeStep(
        step: PlanStep,
        plan: ExecutionPlan,
        previousResults: Map<number, StepResult>
    ): Promise<StepResult> {
        const stepStart = Date.now();
        console.log(`[PLAN_EXECUTOR] 📍 Step ${step.order}/${plan.steps.length}: ${step.agentRole}`);

        // ═══════════════════════════════════════════════════════════════════
        // HOMEOSTATIC CHECK 1: Resource Arbiter (RAM/CPU/VRAM)
        // ═══════════════════════════════════════════════════════════════════
        const arbiterApproved = await this.waitForResources(step);
        if (!arbiterApproved) {
            return {
                stepOrder: step.order,
                agentId: step.agentId,
                output: '',
                success: false,
                tokensUsed: 0,
                executionTimeMs: Date.now() - stepStart,
                error: 'Resource arbiter timeout'
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        // HOMEOSTATIC CHECK 2: Provider Health (RPM limits)
        // ═══════════════════════════════════════════════════════════════════
        if (!providerHealth.isAvailable('gemini')) {
            console.log(`[PLAN_EXECUTOR] ⚠️ Gemini unavailable, checking fallbacks...`);
            // In production, we'd try other providers here
        }

        // ═══════════════════════════════════════════════════════════════════
        // HOMEOSTATIC CHECK 3: Congestion Manager (Backpressure)
        // ═══════════════════════════════════════════════════════════════════
        if (congestionManager.isCongested()) {
            console.log(`[PLAN_EXECUTOR] 🚦 System congested. Pausing...`);
            await this.pause(this.CONGESTION_PAUSE_MS);
        }

        // ═══════════════════════════════════════════════════════════════════
        // HYDRATE AGENT (Load into memory)
        // ═══════════════════════════════════════════════════════════════════
        try {
            await orchestrator.hydrateAgent(step.agentId);
        } catch (e) {
            console.warn(`[PLAN_EXECUTOR] Could not hydrate ${step.agentId}, using direct call`);
        }

        // ═══════════════════════════════════════════════════════════════════
        // COMPILE CUSTOM PROMPT
        // ═══════════════════════════════════════════════════════════════════
        const previousOutputs = step.dependsOn
            .map(dep => previousResults.get(dep)?.output)
            .filter((o): o is string => !!o);

        const customPrompt = promptCompiler.compilePlanStep({
            agentRole: step.agentRole,
            agentId: step.agentId,
            stepNumber: step.order,
            totalSteps: plan.steps.length,
            taskDescription: step.taskDescription,
            previousStepResults: previousOutputs,
            originalUserRequest: plan.originalRequest,
            capabilities: step.requiredCapabilities
        });

        // ═══════════════════════════════════════════════════════════════════
        // EXECUTE STEP (LLM Call)
        // ═══════════════════════════════════════════════════════════════════
        congestionManager.updateQueueSize(1); // Increment queue

        try {
            const response = await geminiService.generateAgentResponse(
                step.agentRole,
                'PlanExecutor',
                'EXECUTION',
                step.taskDescription,
                previousOutputs.join('\n\n'),
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.TECHNICAL
            );

            // Report success to provider health
            providerHealth.reportSuccess('gemini');

            // ═══════════════════════════════════════════════════════════════
            // UNIFIED CAPABILITY EXECUTION: Process any tool calls in response
            // ═══════════════════════════════════════════════════════════════
            let finalOutput = response.output;
            const toolCalls = this.extractToolCalls(response.output);

            if (toolCalls.length > 0) {
                console.log(`[PLAN_EXECUTOR] 🔧 Found ${toolCalls.length} tool calls in step ${step.order}`);

                for (const toolCall of toolCalls) {
                    try {
                        const capResult = await orchestrator.executeCapability(
                            toolCall.name,
                            toolCall.args,
                            { requesterId: `plan_step_${step.order}`, priority: 'NORMAL' }
                        );

                        // Inject tool result into output
                        const resultSummary = capResult.success
                            ? `[Tool ${toolCall.name} completed: ${JSON.stringify(capResult.data).substring(0, 200)}]`
                            : `[Tool ${toolCall.name} failed: ${capResult.error}]`;

                        finalOutput = finalOutput.replace(toolCall.originalMatch, resultSummary);
                    } catch (toolError: any) {
                        console.warn(`[PLAN_EXECUTOR] Tool ${toolCall.name} failed:`, toolError.message);
                    }
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // FALLBACK: Auto-detect image generation intent when agent didn't use [TOOL:]
            // ═══════════════════════════════════════════════════════════════
            const hasImageToolCall = toolCalls.some(tc => tc.name === 'generate_image');
            const isImageRequest = this.detectImageGenerationIntent(plan.originalRequest);

            if (isImageRequest && !hasImageToolCall && step.agentRole === 'Creative_Director') {
                console.log(`[PLAN_EXECUTOR] 🎨 FALLBACK: Detected image request but no [TOOL:] tag. Auto-generating...`);

                // Extract the best image prompt from the agent's response
                const extractedPrompt = this.extractImagePromptFromText(response.output, plan.originalRequest);

                if (extractedPrompt) {
                    try {
                        const imgResult = await orchestrator.executeCapability(
                            'generate_image',
                            { prompt: extractedPrompt, style: 'PHOTOREALISTIC', aspectRatio: '16:9' },
                            { requesterId: `plan_step_${step.order}_fallback`, priority: 'NORMAL' }
                        );

                        if (imgResult.success) {
                            finalOutput += `\n\n[IMAGEN GENERADA AUTOMÁTICAMENTE]\n${JSON.stringify(imgResult.data)}`;
                            console.log(`[PLAN_EXECUTOR] ✅ Fallback image generation succeeded`);
                        }
                    } catch (e: any) {
                        console.warn(`[PLAN_EXECUTOR] Fallback image generation failed:`, e.message);
                    }
                }
            }

            return {
                stepOrder: step.order,
                agentId: step.agentId,
                output: finalOutput,
                success: true,
                tokensUsed: response.usage || 0,
                executionTimeMs: Date.now() - stepStart
            };

        } catch (e: any) {
            // Report failure to provider health
            providerHealth.reportFailure('gemini', e.message);

            return {
                stepOrder: step.order,
                agentId: step.agentId,
                output: '',
                success: false,
                tokensUsed: 0,
                executionTimeMs: Date.now() - stepStart,
                error: e.message
            };

        } finally {
            congestionManager.updateQueueSize(-1); // Decrement queue
            resourceArbiter.release(); // Release resources

            // Dehydrate agent if not needed soon
            // (In production, we'd check if next steps need this agent)
            // orchestrator.dehydrateAgent(step.agentId);
        }
    }

    /**
     * Wait for resources to become available
     */
    private async waitForResources(step: PlanStep): Promise<boolean> {
        const mockAgent = {
            id: step.agentId,
            name: step.agentRole,
            role: step.agentRole,
            status: AgentStatus.IDLE,
            cpuUsage: 0,
            ramUsage: 0,
            memoryLocation: 'RAM' as const,
            lastActive: Date.now(),
            teamId: 'EXECUTION',
            category: 'OPS' as const,
            roleType: AgentRoleType.WORKER,
            enabled: true,
            tier: AgentTier.SPECIALIST,
            preferredMemory: 'RAM' as const
        };

        return resourceArbiter.requestAdmission(mockAgent, step.priority);
    }

    /**
     * Helper to pause execution
     */
    private pause(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Synthesize final output in USER_FACING natural language
     * This prevents JSON from technical agent responses from leaking into chat
     */
    private async synthesizeFinalOutput(
        originalRequest: string,
        stepResults: string[]
    ): Promise<string> {
        try {
            // Combine all step results for synthesis context
            const combinedResults = stepResults.join('\n\n---\n\n');

            const synthesisPrompt = `You are Silhouette, responding to the user's request.

ORIGINAL USER REQUEST:
"${originalRequest}"

COLLECTED INFORMATION FROM SPECIALISTS:
${combinedResults}

YOUR TASK:
Using the information above, provide a natural, conversational response to the user's request.
- Speak naturally in the user's language (Spanish if request was in Spanish)
- DO NOT output JSON, status objects, or technical artifacts
- DO NOT say "ejecutando", "procesando", or similar status messages
- Synthesize the key information into a helpful, direct answer
- Be concise but complete

RESPOND NOW:`;

            const response = await geminiService.generateAgentResponse(
                'Silhouette',
                'FinalSynthesis',
                'SYNTHESIS',
                synthesisPrompt,
                null,
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.USER_FACING,
                'gemini-1.5-flash' // Fast model for synthesis
            );

            return response.output || combinedResults;

        } catch (e: any) {
            console.warn('[PLAN_EXECUTOR] Final synthesis failed, returning raw output:', e.message);
            // Fallback: return the last step result
            return stepResults[stepResults.length - 1] || 'Task completed.';
        }
    }

    /**
     * Handle help requests during plan execution
     */
    public async handleHelpRequest(
        requesterId: string,
        requesterRole: string,
        problem: string,
        context: any
    ): Promise<string> {
        // Find best helper agent
        const helperRole = this.findBestHelper(problem);
        const helperId = this.mapRoleToAgentId(helperRole);

        console.log(`[PLAN_EXECUTOR] 🤝 Help request from ${requesterRole} → ${helperRole}`);

        // Compile help prompt
        const helpPrompt = promptCompiler.compileHelpRequest({
            requesterId,
            requesterRole,
            helperId,
            helperRole,
            problem,
            context
        });

        try {
            const response = await geminiService.generateAgentResponse(
                helperRole,
                'HelpHandler',
                'SUPPORT',
                problem,
                JSON.stringify(context),
                undefined,
                undefined,
                { useWebSearch: false },
                {},
                [],
                CommunicationLevel.EXECUTIVE
            );

            // Emit help response
            systemBus.emit(SystemProtocol.HELP_RESPONSE, {
                requesterId,
                helperId,
                solution: response.output
            }, helperId);

            return response.output;

        } catch (e: any) {
            console.error(`[PLAN_EXECUTOR] Help request failed:`, e);
            return `Unable to provide help: ${e.message}`;
        }
    }

    private findBestHelper(problem: string): string {
        const problemLower = problem.toLowerCase();

        if (problemLower.includes('research') || problemLower.includes('information')) {
            return 'Researcher_Pro';
        }
        if (problemLower.includes('code') || problemLower.includes('implement')) {
            return 'Code_Architect';
        }
        if (problemLower.includes('design') || problemLower.includes('creative')) {
            return 'Creative_Director';
        }
        if (problemLower.includes('quality') || problemLower.includes('test')) {
            return 'QA_Inquisitor';
        }

        return 'ManagerAgent';
    }

    private mapRoleToAgentId(role: string): string {
        const mapping: Record<string, string> = {
            'Researcher_Pro': 'sci-03',
            'Code_Architect': 'dev-01',
            'Creative_Director': 'mkt-lead',
            'QA_Inquisitor': 'qa-01',
            'ManagerAgent': 'manager'
        };
        return mapping[role] || 'manager';
    }

    /**
     * Extract tool calls from agent response text
     * Matches patterns like [TOOL: name(arg="value")] or [EXECUTE: name {...}]
     */
    private extractToolCalls(text: string): Array<{ name: string; args: Record<string, any>; originalMatch: string }> {
        const calls: Array<{ name: string; args: Record<string, any>; originalMatch: string }> = [];

        // Pattern 1: [TOOL: name(args)]
        const toolPattern = /\[TOOL:\s*(\w+)\((.*?)\)\]/gi;
        let match;
        while ((match = toolPattern.exec(text)) !== null) {
            calls.push({
                name: match[1],
                args: this.parseToolArgs(match[2]),
                originalMatch: match[0]
            });
        }

        // Pattern 2: [EXECUTE: name {json}]
        const executePattern = /\[EXECUTE:\s*(\w+)\s*(\{.*?\})\]/gi;
        while ((match = executePattern.exec(text)) !== null) {
            try {
                calls.push({
                    name: match[1],
                    args: JSON.parse(match[2]),
                    originalMatch: match[0]
                });
            } catch {
                // Invalid JSON, skip
            }
        }

        return calls;
    }

    /**
     * Parse tool arguments string into object
     */
    private parseToolArgs(argsString: string): Record<string, any> {
        const args: Record<string, any> = {};
        const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
        let match;

        while ((match = argPattern.exec(argsString)) !== null) {
            const [, name, quotedDouble, quotedSingle, unquoted] = match;
            const value = quotedDouble ?? quotedSingle ?? unquoted;
            try {
                args[name] = JSON.parse(value);
            } catch {
                args[name] = value;
            }
        }

        return args;
    }

    /**
     * Detect if the original request is asking for image generation
     */
    private detectImageGenerationIntent(request: string): boolean {
        const imageKeywords = [
            'genera una imagen', 'crea una imagen', 'generar imagen',
            'generate an image', 'create an image', 'make an image',
            'imagen de', 'image of', 'foto de', 'photo of',
            'ilustración', 'illustration', 'visual', 'picture',
            'diseña', 'design', 'dibuja', 'draw'
        ];

        const lowerRequest = request.toLowerCase();
        return imageKeywords.some(keyword => lowerRequest.includes(keyword));
    }

    /**
     * Extract the best image prompt from agent response text
     * When agent provides options or descriptions instead of using [TOOL:]
     */
    private extractImagePromptFromText(agentResponse: string, originalRequest: string): string | null {
        // Priority 1: Look for the agent's generated prompt (they often write good ones)
        // Pattern: text after "prompt:" or similar
        const promptPatterns = [
            /"prompt":\s*"([^"]{30,500})"/i,
            /prompt[:\s]+["']([^"']{30,500})["']/i,
            /genera(?:ndo|r)?.*?:\s*["']?([^"'\n]{30,300})/i,
        ];

        for (const pattern of promptPatterns) {
            const match = agentResponse.match(pattern);
            if (match && match[1]) {
                console.log(`[PLAN_EXECUTOR] 📝 Extracted prompt via pattern: "${match[1].substring(0, 80)}..."`);
                return match[1];
            }
        }

        // Priority 2: Look for substantial quoted text that looks like an image description
        const quotedMatches = agentResponse.match(/"([^"]{30,500})"/g);
        if (quotedMatches && quotedMatches.length > 0) {
            const bestMatch = quotedMatches
                .map(m => m.replace(/"/g, ''))
                .find(m =>
                    m.length > 50 &&
                    !m.includes('Option') &&
                    !m.includes('TOOL') &&
                    (m.includes('image') || m.includes('photo') || m.includes('drone') ||
                        m.includes('mountain') || m.includes('person') || m.includes('shot'))
                );

            if (bestMatch) {
                console.log(`[PLAN_EXECUTOR] 📝 Extracted prompt from quotes: "${bestMatch.substring(0, 80)}..."`);
                return bestMatch;
            }
        }

        // Priority 3: Clean the original request but preserve the core description
        // Match the actual content after common intro phrases
        const contentMatch = originalRequest.match(
            /(?:genera|crea|quiero|haz|make|create|generate).*?(?:imagen|image|foto|photo).*?(?:de|of|:)\s*(.+)/i
        );

        if (contentMatch && contentMatch[1]) {
            const cleanPrompt = contentMatch[1].trim();
            if (cleanPrompt.length > 20) {
                console.log(`[PLAN_EXECUTOR] 📝 Extracted core from request: "${cleanPrompt.substring(0, 80)}..."`);
                return cleanPrompt;
            }
        }

        // Priority 4: Just use the full original request as-is (better than broken text)
        if (originalRequest.length > 30) {
            console.log(`[PLAN_EXECUTOR] 📝 Using full original request as prompt`);
            return originalRequest;
        }

        return null;
    }
}

export const planExecutor = new PlanExecutor();
