/**
 * TOOL FACTORY - Self-Extending Tool Creation
 * 
 * Enables Silhouette to:
 * 1. Create new tools from natural language descriptions
 * 2. Compose tools from existing tools (chaining)
 * 3. Generate tool implementations automatically
 * 
 * Part of the Self-Extending Tool System (Phase 2)
 * Enhanced with Crash-Proof Resilience (Phase 4)
 */

import { Type } from "@google/genai";
import {
    DynamicTool,
    ToolHandler,
    FunctionDeclarationSchema,
    ToolCategory,
    ComposedStep,
    toolRegistry
} from './toolRegistry';
import { toolPersistence } from './toolPersistence';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

// Resilience Layer
import { withRetry, isRetryableError } from '../resilience/retryHelper';
import { operationCircuit } from '../resilience/operationCircuit';
import { toolValidator } from '../resilience/toolValidator';

// ==================== INTERFACES ====================

export interface ToolCreationRequest {
    name: string;
    purpose: string;
    category: ToolCategory;
    inputs: ToolInput[];
    output: string;
    implementation: 'COMPOSE' | 'CODE' | 'BUILTIN';
    steps?: ComposedStep[];     // For COMPOSE type
    code?: string;              // For CODE type
    handlerName?: string;       // For BUILTIN type
    tags?: string[];
}

export interface ToolInput {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required?: boolean;
    enum?: string[];
}

// ==================== TOOL FACTORY ====================

class ToolFactory {
    private static instance: ToolFactory;

    private constructor() { }

    public static getInstance(): ToolFactory {
        if (!ToolFactory.instance) {
            ToolFactory.instance = new ToolFactory();
        }
        return ToolFactory.instance;
    }

    /**
     * Create a new tool from a structured request
     * Protected by circuit breaker and pre-registration validation
     */
    public async createTool(request: ToolCreationRequest): Promise<DynamicTool> {
        console.log(`[ToolFactory] 🏭 Creating tool: ${request.name}`);

        // Use circuit breaker to protect against cascading failures
        return operationCircuit.execute('TOOL_CREATE', async () => {
            // Validate request structure
            this.validateRequest(request);

            // Build parameter schema
            const parameters = this.buildParameterSchema(request.inputs);

            // Build handler
            const handler = this.buildHandler(request);

            // Create tool definition
            const tool: DynamicTool = {
                id: `tool_${request.name}_${Date.now()}`,
                name: request.name,
                description: request.purpose,
                parameters,
                handler,
                category: request.category,
                createdBy: 'SILHOUETTE',
                enabled: true,
                usageCount: 0,
                successCount: 0,
                createdAt: Date.now(),
                version: '1.0.0',
                tags: request.tags
            };

            // Pre-registration validation (schema, references, cycles, rate limit)
            const validation = toolValidator.validate(tool);
            if (!validation.valid) {
                const errorMessages = validation.errors.map(e => `${e.code}: ${e.message}`).join('; ');
                throw new Error(`Tool validation failed: ${errorMessages}`);
            }

            // Log warnings if any
            if (validation.warnings.length > 0) {
                console.warn(`[ToolFactory] ⚠️ Warnings for ${tool.name}:`,
                    validation.warnings.map(w => w.message).join(', '));
            }

            // Register and persist
            toolRegistry.registerTool(tool);
            await toolPersistence.save(tool);

            // Emit creation event
            systemBus.emit(SystemProtocol.UI_REFRESH, {
                source: 'TOOL_FACTORY',
                message: `New tool created: ${tool.name}`,
                tool: tool
            });

            console.log(`[ToolFactory] ✅ Tool created and registered: ${tool.name}`);
            return tool;
        });
    }

    /**
     * Compose a tool from existing tools (chaining)
     */
    public async composeTool(
        name: string,
        purpose: string,
        category: ToolCategory,
        steps: ComposedStep[],
        inputs?: ToolInput[],
        tags?: string[]
    ): Promise<DynamicTool> {
        console.log(`[ToolFactory] 🔗 Composing tool: ${name} from ${steps.length} steps`);

        // Validate all referenced tools exist
        for (const step of steps) {
            if (!toolRegistry.hasTool(step.toolName)) {
                throw new Error(`Referenced tool not found: ${step.toolName}`);
            }
        }

        // Check for cycles BEFORE creating the tool
        const { dependencyGraph } = await import('./dependencyGraph');
        for (const step of steps) {
            if (dependencyGraph.wouldCreateCycle(name, step.toolName)) {
                throw new Error(
                    `Circular dependency detected: ${name} → ${step.toolName} would create a cycle`
                );
            }
        }

        // Auto-derive inputs if not provided
        const derivedInputs = inputs || this.deriveInputsFromSteps(steps);

        // Create the tool
        const tool = await this.createTool({
            name,
            purpose,
            category,
            inputs: derivedInputs,
            output: 'Result from composed tool chain',
            implementation: 'COMPOSE',
            steps,
            tags
        });

        // Register dependencies in the graph
        for (const step of steps) {
            const depTool = toolRegistry.getTool(step.toolName);
            const versionConstraint = depTool?.version ? `^${depTool.version}` : '*';
            dependencyGraph.addDependency(name, step.toolName, versionConstraint);
        }

        console.log(`[ToolFactory] 📊 Registered ${steps.length} dependencies for ${name}`);
        return tool;
    }

    /**
     * Create tool from natural language description using LLM
     */
    public async createFromDescription(
        description: string,
        category: ToolCategory = 'WORKFLOW'
    ): Promise<DynamicTool> {
        console.log(`[ToolFactory] 🧠 Creating tool from description: "${description.substring(0, 50)}..."`);

        // Use Gemini to generate tool spec
        const { geminiService } = await import('../geminiService');

        const prompt = `
You are a tool design expert. Create a tool specification for the following requirement:

"${description}"

Respond with a JSON object in this exact format:
{
    "name": "tool_name_snake_case",
    "purpose": "Clear description of what the tool does",
    "category": "${category}",
    "inputs": [
        {"name": "input_name", "type": "string|number|boolean|array|object", "description": "What this input is for", "required": true}
    ],
    "output": "Description of what the tool returns",
    "implementation": "COMPOSE",
    "steps": [
        {"toolName": "existing_tool_name", "inputMapping": {"param": "{{input_name}}"}, "outputAs": "result1"}
    ],
    "tags": ["tag1", "tag2"]
}

Available tools you can compose from:
${this.getAvailableToolsForPrompt()}

IMPORTANT: Only use tools that exist in the list above. If you need a tool that doesn't exist, use implementation: "CODE" instead and provide the code.
`;

        // Use retry with exponential backoff for LLM calls
        const result = await withRetry(
            async () => {
                const response = await geminiService.generateText(prompt);
                const jsonMatch = response.match(/\{[\s\S]*\}/);

                if (!jsonMatch) {
                    throw new Error('Failed to extract JSON from LLM response');
                }

                return JSON.parse(jsonMatch[0]) as ToolCreationRequest;
            },
            {
                maxRetries: 3,
                baseDelayMs: 2000,
                retryCondition: isRetryableError
            }
        );

        if (!result.success) {
            console.error('[ToolFactory] ❌ Failed to create from description after retries:', result.error);
            throw result.error || new Error('Failed to create tool from description');
        }

        // Create tool via circuit-protected createTool
        return this.createTool(result.result!);
    }

    /**
     * Clone and modify an existing tool
     */
    public async cloneTool(
        sourceName: string,
        newName: string,
        modifications?: Partial<ToolCreationRequest>
    ): Promise<DynamicTool | null> {
        const source = toolRegistry.getTool(sourceName);
        if (!source) {
            console.error(`[ToolFactory] ❌ Source tool not found: ${sourceName}`);
            return null;
        }

        const clonedTool: DynamicTool = {
            ...source,
            id: `tool_${newName}_${Date.now()}`,
            name: newName,
            description: modifications?.purpose || source.description,
            createdBy: 'SILHOUETTE',
            usageCount: 0,
            successCount: 0,
            createdAt: Date.now(),
            version: '1.0.0',
            tags: modifications?.tags || source.tags
        };

        toolRegistry.registerTool(clonedTool);
        await toolPersistence.save(clonedTool);

        console.log(`[ToolFactory] 📋 Cloned ${sourceName} → ${newName}`);
        return clonedTool;
    }

    // ==================== PRIVATE HELPERS ====================

    private validateRequest(request: ToolCreationRequest): void {
        if (!request.name || !request.purpose) {
            throw new Error('Tool name and purpose are required');
        }

        if (!/^[a-z][a-z0-9_]*$/.test(request.name)) {
            throw new Error('Tool name must be snake_case starting with a letter');
        }

        if (toolRegistry.hasTool(request.name)) {
            throw new Error(`Tool already exists: ${request.name}`);
        }

        if (request.implementation === 'COMPOSE' && (!request.steps || request.steps.length === 0)) {
            throw new Error('COMPOSE implementation requires steps');
        }

        if (request.implementation === 'CODE' && !request.code) {
            throw new Error('CODE implementation requires code');
        }
    }

    private buildParameterSchema(inputs: ToolInput[]): FunctionDeclarationSchema {
        const properties: FunctionDeclarationSchema['properties'] = {};
        const required: string[] = [];

        for (const input of inputs) {
            properties[input.name] = {
                type: this.mapInputType(input.type),
                description: input.description
            };

            if (input.enum) {
                properties[input.name].enum = input.enum;
            }

            if (input.required !== false) {
                required.push(input.name);
            }
        }

        return {
            type: 'OBJECT',
            properties,
            required: required.length > 0 ? required : undefined
        };
    }

    private mapInputType(type: ToolInput['type']): string {
        const typeMap: Record<string, string> = {
            'string': 'STRING',
            'number': 'NUMBER',
            'boolean': 'BOOLEAN',
            'array': 'ARRAY',
            'object': 'OBJECT'
        };
        return typeMap[type] || 'STRING';
    }

    private buildHandler(request: ToolCreationRequest): ToolHandler {
        switch (request.implementation) {
            case 'COMPOSE':
                return {
                    type: 'COMPOSED',
                    steps: request.steps || []
                };
            case 'CODE':
                return {
                    type: 'CODE',
                    code: request.code || '',
                    sandbox: true
                };
            case 'BUILTIN':
                return {
                    type: 'BUILTIN',
                    handlerName: request.handlerName || ''
                };
            default:
                throw new Error(`Unknown implementation type: ${request.implementation}`);
        }
    }

    private deriveInputsFromSteps(steps: ComposedStep[]): ToolInput[] {
        const inputs: Map<string, ToolInput> = new Map();

        for (const step of steps) {
            for (const [param, expression] of Object.entries(step.inputMapping)) {
                // Extract variable references like {{variable_name}}
                const matches = expression.match(/\{\{(\w+)\}\}/g);
                if (matches) {
                    for (const match of matches) {
                        const varName = match.replace(/\{\{|\}\}/g, '');
                        if (!inputs.has(varName)) {
                            inputs.set(varName, {
                                name: varName,
                                type: 'string',
                                description: `Input for ${step.toolName}.${param}`,
                                required: true
                            });
                        }
                    }
                }
            }
        }

        return Array.from(inputs.values());
    }

    private getAvailableToolsForPrompt(): string {
        const tools = toolRegistry.getAllTools();
        return tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
    }

    /**
     * Get factory statistics
     */
    public getStats(): { toolsCreated: number; byCategory: Record<string, number> } {
        const allTools = toolRegistry.getAllTools();
        const silhouetteTools = allTools.filter(t => t.createdBy === 'SILHOUETTE');

        const byCategory: Record<string, number> = {};
        for (const tool of silhouetteTools) {
            byCategory[tool.category] = (byCategory[tool.category] || 0) + 1;
        }

        return {
            toolsCreated: silhouetteTools.length,
            byCategory
        };
    }
}

export const toolFactory = ToolFactory.getInstance();
