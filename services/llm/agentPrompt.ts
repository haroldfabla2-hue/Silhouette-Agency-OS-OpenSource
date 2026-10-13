/**
 * AGENT PROMPT PREPARATION (R1)
 *
 * Assembles the system prompt for agent/chat inference exactly once per
 * request, independent of which provider ends up answering. Extracted from
 * the former geminiService.generateAgentResponseStream: same context
 * gathering, same promptCompiler call, same capability suffixes.
 */

import { promptCompiler } from '../promptCompiler';
import { CommunicationLevel, IntrospectionLayer, WorkflowStage } from '../../types';
import type { AgentInferenceRequest, InferenceCapabilities, PreparedAgentRequest } from './inference';

const DEFAULT_CAPABILITIES: Required<InferenceCapabilities> = {
    webSearch: false,
    codeExecution: false,
    imageGeneration: false,
    memoryWrite: false
};

export async function prepareAgentRequest(req: AgentInferenceRequest): Promise<PreparedAgentRequest> {
    const context = req.context ?? undefined;
    const level = req.level ?? CommunicationLevel.USER_FACING;
    const capabilities: Required<InferenceCapabilities> = { ...DEFAULT_CAPABILITIES, ...(req.capabilities || {}) };

    // 1. GATHER CONTEXT (same sources as before the unification)
    const uiCtx = (await import('../uiContext')).uiContext;
    const screenContext = uiCtx.getContext();
    const narrativeState = (await import('../narrativeService')).narrative.getState();

    // Hardware & System Context
    let systemContext = "";
    if (context?.systemMetrics) {
        const m = context.systemMetrics;
        // Defensive coding: Ensure values are numbers, defaulting to 0 if undefined
        const cpu = m.realCpu ?? 0;
        const ram = m.jsHeapSize ?? 0;
        const vram = m.vramUsage ?? 0;
        systemContext += `\n[REAL-TIME HARDWARE]: CPU: ${cpu.toFixed(1)}%, RAM: ${ram.toFixed(0)}MB, VRAM: ${vram.toFixed(0)}MB`;
    }
    if (context?.orchestratorState) {
        const o = context.orchestratorState;
        systemContext += `\n[ORCHESTRATOR REALITY]: Active Agents: ${o.activeCount}`;
        if (o.squads && o.squads.length > 0) {
            systemContext += `\n[SQUAD STATUS]:\n${o.squads.map((s: any) => `- ${s.name}: ${s.status}`).join('\n')}`;
        }
    }
    if (context?.systemMode) {
        systemContext += `\n[BIO-SAFE PROTOCOL]: Current Mode: ${context.systemMode}`;
    }
    if (screenContext.activeTab) {
        systemContext += `\n[SCREEN]: Active Tab: ${screenContext.activeTab}`;
    }

    if (screenContext.activeFile) {
        systemContext += `\n[EDITING]: ${screenContext.activeFile.name}\n\`\`\`\n${screenContext.activeFile.content}\n\`\`\``;
    }

    // Only include narrative context for non-user-facing communication
    // For user chat, this was causing ZhipuAI to output JSON instead of natural language
    const narrativeContext = level === CommunicationLevel.USER_FACING
        ? '' // Don't include internal state for user chat - it confuses the LLM
        : `
[NARRATIVE CORTEX - ACTIVE STATE]:
- CURRENT FOCUS: ${narrativeState.currentFocus}
- SESSION GOAL: ${narrativeState.sessionGoal}
        `.trim();

    // 2. Build Prompt
    let systemPrompt = promptCompiler.compile(level, {
        role: req.role,
        category: req.category,
        task: req.task,
        contextData: `
${systemContext}
${narrativeContext}
${context?.relevantMemory || ''} 
        `.trim(),
        constraints: [
            `Introspection Depth: ${req.introspectionDepth ?? IntrospectionLayer.OPTIMAL}`,
            `Workflow Stage: ${req.stage ?? WorkflowStage.EXECUTION}`
        ]
    });

    // 3. Capability suffixes (textual channel preserved for every provider;
    //    web search / code execution additionally map to native tools where supported)
    if (capabilities.webSearch) {
        systemPrompt += `\n[CAPABILITY: WEB_SEARCH] You can search the web for real-time info.`;
    }
    if (capabilities.codeExecution) {
        systemPrompt += `\n[CAPABILITY: CODE_EXECUTION] You can run Python code.`;
    }
    if (capabilities.imageGeneration) {
        systemPrompt += `\n[CAPABILITY: IMAGE_GENERATION] Output [IMAGINE: <prompt>] to create images.`;
    }
    if (capabilities.memoryWrite) {
        systemPrompt += `\n[CAPABILITY: MEMORY_WRITE] Output [AUTHORIZE_MEMORY: <content>] to save knowledge.`;
    }

    return {
        agentName: req.agentName,
        category: req.category,
        level,
        systemPrompt,
        task: req.task,
        chatHistory: context?.chatHistory || [],
        relevantMemory: context?.relevantMemory || '',
        capabilities,
        model: req.model,
        temperature: req.temperature ?? 0.7,
        maxTokens: req.maxTokens ?? 2048,
        toolCaller: context?.toolCaller,
        lane: req.lane ?? 'conversational',
        signal: req.signal
    };
}
