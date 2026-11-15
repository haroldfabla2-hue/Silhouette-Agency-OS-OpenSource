/**
 * TOOL STANDARD
 * 
 * Defines the standard interface for all tools in Silhouette Agency OS.
 * Tools that conform to this standard have:
 * - JSON Schema validated inputs/outputs
 * - Error boundaries that don't crash the agent
 * - Health checks for reliability monitoring
 * - Version tracking for compatibility
 */

// ═══════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════

/** JSON Schema-like type for tool parameters */
export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description: string;
    required: boolean;
    default?: any;
    enum?: any[];
}

/** Result from tool execution */
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: {
        executionTimeMs: number;
        retried: boolean;
        cached: boolean;
    };
}

/** Standard tool interface */
export interface StandardTool {
    /** Unique tool identifier */
    id: string;
    /** Semantic version */
    version: string;
    /** Human-readable name */
    name: string;
    /** Description for LLM function calling */
    description: string;
    /** Input parameters schema */
    inputSchema: ToolParameter[];
    /** Category for grouping tools */
    category: 'SYSTEM' | 'RESEARCH' | 'CREATIVE' | 'DATA' | 'COMMUNICATION' | 'UTILITY';

    /** Execute the tool with validated input */
    execute(input: Record<string, any>): Promise<ToolResult>;

    /** Validate input before execution */
    validate(input: Record<string, any>): ValidationResult;

    /** Check if the tool is functional */
    healthCheck(): Promise<boolean>;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Validates tool input against the defined schema.
 */
export function validateToolInput(input: Record<string, any>, schema: ToolParameter[]): ValidationResult {
    const errors: string[] = [];

    for (const param of schema) {
        const value = input[param.name];

        if (param.required && (value === undefined || value === null)) {
            errors.push(`Missing required parameter: ${param.name}`);
            continue;
        }

        if (value !== undefined && value !== null) {
            const actualType = Array.isArray(value) ? 'array' : typeof value;
            if (actualType !== param.type) {
                errors.push(`Parameter "${param.name}" expected ${param.type} but got ${actualType}`);
            }

            if (param.enum && !param.enum.includes(value)) {
                errors.push(`Parameter "${param.name}" must be one of: ${param.enum.join(', ')}`);
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Wraps a tool's execute function with error boundaries and timing.
 * Prevents tool crashes from killing the agent.
 */
export async function safeExecute(tool: StandardTool, input: Record<string, any>): Promise<ToolResult> {
    const start = Date.now();

    // 1. Validate input
    const validation = tool.validate(input);
    if (!validation.valid) {
        return {
            success: false,
            error: `Input validation failed: ${validation.errors.join('; ')}`,
            metadata: { executionTimeMs: Date.now() - start, retried: false, cached: false }
        };
    }

    // 2. Execute with error boundary
    try {
        const result = await tool.execute(input);
        result.metadata = {
            executionTimeMs: Date.now() - start,
            retried: false,
            cached: false,
            ...result.metadata
        };
        return result;
    } catch (error: any) {
        console.error(`[TOOL_STANDARD] 💥 Tool "${tool.id}" crashed:`, error.message);
        return {
            success: false,
            error: `Tool execution error: ${error.message}`,
            metadata: { executionTimeMs: Date.now() - start, retried: false, cached: false }
        };
    }
}
