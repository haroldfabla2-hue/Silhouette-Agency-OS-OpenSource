/**
 * CAPABILITY TYPES
 * 
 * Unified type definitions for the capability execution system.
 * Used by orchestrator.executeCapability() and all callers.
 */

/**
 * Result of executing any capability (tool, agent, or workflow)
 */
export interface CapabilityResult {
    success: boolean;
    data?: any;
    error?: string;
    executedBy: CapabilityExecutor;
    executionTimeMs: number;
    metadata?: CapabilityMetadata;
}

/**
 * Who/what executed the capability
 */
export type CapabilityExecutor = 'TOOL' | 'AGENT' | 'WORKFLOW' | 'DIRECT' | 'TOOL_HANDLER';

/**
 * Metadata about the execution
 */
export interface CapabilityMetadata {
    toolName?: string;
    agentId?: string;
    agentName?: string;
    planId?: string;
    stepCount?: number;
    tokensUsed?: number;
}

/**
 * Request context for capability execution
 */
export interface CapabilityContext {
    requesterId?: string;           // Who is requesting (agent ID, 'chat', 'api')
    priority?: CapabilityPriority;  // Execution priority
    sessionId?: string;             // Chat session for context
    timeout?: number;               // Max execution time in ms
    allowFallback?: boolean;        // Whether to try fallback executors
}

/**
 * Priority levels for capability execution
 */
export type CapabilityPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

/**
 * Full capability request structure
 */
export interface CapabilityRequest {
    name: string;
    args: Record<string, any>;
    context?: CapabilityContext;
}

/**
 * Capability type detected during routing
 */
export type CapabilityType =
    | 'REGISTERED_TOOL'      // In toolRegistry
    | 'AGENT_CAPABILITY'     // Matches an agent's capabilities
    | 'COMPLEX_WORKFLOW'     // Requires multi-step planning
    | 'UNKNOWN';
