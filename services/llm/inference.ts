/**
 * INFERENCE CONTRACT (R1: chat-gateway unification)
 *
 * One typed contract for every conversational/agent inference in the system.
 * Provider transports live exclusively in per-provider adapters
 * (streamAdapters.ts); fallback policy lives exclusively in the router
 * (agentInferenceRouter.ts). Callers (chat, agent streams, fact extraction)
 * never talk to a provider SDK directly.
 */

import { AgentCapability, type CommunicationLevel, type IntrospectionLayer, type WorkflowStage } from '../../types';
import type { ToolCaller } from '../communication/helpProtocol';

export type InferenceErrorKind =
    | 'unavailable'       // provider not configured / circuit open / service down
    | 'auth'              // credential rejected
    | 'rate-limit'        // provider throttled the request
    | 'network'           // transport failure before a response
    | 'timeout'           // deadline exceeded
    | 'invalid-response'  // provider answered with something unusable
    | 'provider-error'    // any other provider-side failure
    | 'mid-stream';       // failure after the first token was already emitted

/** Typed inference error. Never delivered as chat text: errors travel out of band. */
export class InferenceError extends Error {
    readonly provider: string;
    readonly kind: InferenceErrorKind;
    constructor(provider: string, kind: InferenceErrorKind, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'InferenceError';
        this.provider = provider;
        this.kind = kind;
    }
}

/** Capabilities the caller wants. Adapters implement them natively when the provider supports it, textually otherwise. */
export interface InferenceCapabilities {
    webSearch?: boolean;
    codeExecution?: boolean;
    imageGeneration?: boolean;
    memoryWrite?: boolean;
}

/** One conversational/agent inference request: messages, context, model, capabilities and metadata. */
export interface AgentInferenceRequest {
    agentName: string;
    role: string;
    category: string;
    task: string;
    context?: {
        relevantMemory?: string;
        chatHistory?: { role: string; content: string }[];
        systemMetrics?: { realCpu?: number; jsHeapSize?: number; vramUsage?: number };
        orchestratorState?: { activeCount?: number; squads?: { name: string; status: string }[] };
        systemMode?: string;
        toolCaller?: ToolCaller;
        [key: string]: unknown;
    } | null;
    capabilities?: InferenceCapabilities;
    level?: CommunicationLevel;
    introspectionDepth?: IntrospectionLayer;
    stage?: WorkflowStage;
    /** Explicit model override (adapter-specific meaning). */
    model?: string;
    /**
     * Provider that `model` belongs to. When set, the fallback chain strips the
     * override for every OTHER provider (a Gemini model id 404s on Groq/Ollama).
     * Unset preserves legacy behavior (override attempted everywhere).
     */
    modelProvider?: string;
    /** Explicit provider preference: attempted first, fallback order preserved afterwards. */
    preferredProvider?: string;
    /** Scheduling lane: conversational traffic preempts background work in provider queues (R2). */
    lane?: 'conversational' | 'background';
    /** Cancellation: aborted requests are removed from provider queues and fetches. */
    signal?: AbortSignal;
    temperature?: number;
    maxTokens?: number;
    metadata?: Record<string, unknown>;
}

/** Prepared form of a request: prompt assembled once, shared by every adapter attempt. */
export interface PreparedAgentRequest {
    agentName: string;
    category: string;
    level: CommunicationLevel;
    systemPrompt: string;
    task: string;
    chatHistory: { role: string; content: string }[];
    relevantMemory: string;
    capabilities: Required<InferenceCapabilities>;
    model?: string;
    modelProvider?: string;
    temperature: number;
    maxTokens: number;
    toolCaller?: ToolCaller;
    lane: 'conversational' | 'background';
    signal?: AbortSignal;
}

export type InferenceEvent =
    /**
     * Emitted exactly once per successful attempt, immediately before the first
     * text event. Names the provider THAT ANSWERED, never the attempted one.
     */
    | { type: 'provider'; provider: string; model?: string }
    | { type: 'text'; text: string };

export interface InferenceCompletion {
    text: string;
    provider: string;
    model?: string;
}

/** Maps legacy AgentCapability flags onto the inference capability contract. */
export function capabilitiesFromAgentCapabilities(agentCapabilities: AgentCapability[]): InferenceCapabilities {
    return {
        webSearch: agentCapabilities.includes(AgentCapability.TOOL_WEB_SEARCH),
        codeExecution: agentCapabilities.includes(AgentCapability.TOOL_CODE_EXECUTION),
        imageGeneration: agentCapabilities.includes(AgentCapability.TOOL_IMAGE_GENERATION),
        memoryWrite: agentCapabilities.includes(AgentCapability.TOOL_MEMORY_WRITE)
    };
}
