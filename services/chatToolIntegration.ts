/**
 * CHAT TOOL INTEGRATION SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Bridges the chat interface with the dynamic tool system.
 * 
 * Features:
 * 1. Detects tool invocation requests in chat
 * 2. Executes tools via toolExecutor
 * 3. Records experiences for learning
 * 4. Auto-creates missing tools using toolFactory
 */

import { toolRegistry, DynamicTool } from './tools/toolRegistry';
import { toolExecutor } from './tools/toolExecutor';
import { toolFactory } from './tools/toolFactory';
import { orchestrator } from './orchestrator'; // Unified Capability Execution
import { experienceBuffer } from './experienceBuffer';
import { FunctionDeclaration } from '@google/genai';

// Patterns to detect tool invocation in chat response
const TOOL_INVOCATION_PATTERNS = [
    // Pattern: [TOOL: tool_name(arg1, arg2)]
    /\[TOOL:\s*(\w+)\((.*?)\)\]/gi,
    // Pattern: [EXECUTE: tool_name {args}]
    /\[EXECUTE:\s*(\w+)\s*(\{.*?\})\]/gi,
    // Pattern: [IMAGINE: prompt] for images (legacy)
    /\[IMAGINE:\s*(.*?)\]/gi,
    // Pattern: [SEARCH: query] for web search (legacy)
    /\[SEARCH:\s*(.*?)\]/gi,
];

// Mapping from legacy tags to tool names
const LEGACY_TAG_MAP: Record<string, string> = {
    'IMAGINE': 'generate_image',
    'SEARCH': 'web_search',
};

export interface ToolCallResult {
    toolName: string;
    success: boolean;
    result?: any;
    error?: string;
    executionTimeMs: number;
}

export interface ParsedToolCall {
    toolName: string;
    args: Record<string, any>;
    originalMatch: string;
}

class ChatToolIntegration {
    /**
     * Get tool declarations for LLM function calling
     * Returns Gemini-compatible FunctionDeclaration array
     */
    getToolDeclarations(): FunctionDeclaration[] {
        try {
            return toolRegistry.getToolDeclarations();
        } catch (e) {
            console.warn('[CHAT_TOOLS] Failed to get tool declarations:', e);
            return [];
        }
    }

    /**
     * Get tool descriptions for system prompt injection
     * Use this when direct function calling isn't supported
     */
    getToolInstructionsForPrompt(): string {
        const tools = toolRegistry.getAllTools().filter(t => t.enabled);

        if (tools.length === 0) return '';

        const toolDescriptions = tools.map(t => {
            const params = Object.entries(t.parameters.properties || {})
                .map(([name, info]: [string, any]) => `${name}: ${info.type} - ${info.description}`)
                .join(', ');
            return `- **${t.name}**: ${t.description}\n  Parameters: ${params || 'none'}`;
        }).join('\n');

        return `
[AVAILABLE TOOLS]
You have access to the following tools. To use a tool, output EXACTLY this format:
[TOOL: tool_name(param1="value1", param2="value2")]

Available Tools:
${toolDescriptions}

IMPORTANT: Only use tools when the user explicitly requests an action that requires them.
For general questions, respond conversationally without using tools.
`;
    }

    /**
     * Parse tool calls from LLM response text
     * Handles both structured [TOOL:...] format and legacy [IMAGINE:...] tags
     */
    parseToolCalls(responseText: string): ParsedToolCall[] {
        const calls: ParsedToolCall[] = [];

        // Pattern 1: [TOOL: name(args)]
        const toolPattern = /\[TOOL:\s*(\w+)\((.*?)\)\]/gi;
        let match;
        while ((match = toolPattern.exec(responseText)) !== null) {
            const toolName = match[1];
            const argsString = match[2];
            calls.push({
                toolName,
                args: this.parseArgs(argsString),
                originalMatch: match[0]
            });
        }

        // Pattern 2: [IMAGINE: prompt] -> generate_image
        const imaginePattern = /\[IMAGINE:\s*(.*?)\]/gi;
        while ((match = imaginePattern.exec(responseText)) !== null) {
            calls.push({
                toolName: 'generate_image',
                args: { prompt: match[1], style: 'PHOTOREALISTIC' },
                originalMatch: match[0]
            });
        }

        // Pattern 3: [SEARCH: query] -> web_search
        const searchPattern = /\[SEARCH:\s*(.*?)\]/gi;
        while ((match = searchPattern.exec(responseText)) !== null) {
            calls.push({
                toolName: 'web_search',
                args: { query: match[1] },
                originalMatch: match[0]
            });
        }

        return calls;
    }

    /**
     * Parse arguments string into object
     * Handles: name="value", name=123, name=true
     */
    private parseArgs(argsString: string): Record<string, any> {
        const args: Record<string, any> = {};

        // Pattern: param="value" or param='value' or param=value
        const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
        let match;

        while ((match = argPattern.exec(argsString)) !== null) {
            const [, name, quotedDouble, quotedSingle, unquoted] = match;
            const value = quotedDouble ?? quotedSingle ?? unquoted;

            // Try to parse as JSON (number, boolean)
            try {
                args[name] = JSON.parse(value);
            } catch {
                args[name] = value;
            }
        }

        return args;
    }

    /**
     * Execute a single tool call
     */
    async executeTool(toolName: string, args: Record<string, any>): Promise<ToolCallResult> {
        const startTime = Date.now();

        console.log(`[CHAT_TOOLS] 🔧 Executing tool: ${toolName}`, args);

        try {
            // Check if tool exists
            if (!toolRegistry.hasTool(toolName)) {
                console.log(`[CHAT_TOOLS] ⚠️ Tool not found: ${toolName}, attempting auto-creation...`);

                // Try to create the tool dynamically
                const created = await this.tryCreateTool(toolName, args);
                if (!created) {
                    return {
                        toolName,
                        success: false,
                        error: `Tool "${toolName}" not found and could not be auto-created`,
                        executionTimeMs: Date.now() - startTime
                    };
                }
            }

            // Execute the tool via orchestrator (unified capability execution)
            const capabilityResult = await orchestrator.executeCapability(toolName, args, {
                requesterId: 'chat',
                priority: 'NORMAL'
            });

            // Extract result data
            const result = capabilityResult.data;

            // Record success (already done by orchestrator, but keep for backward compat)
            if (capabilityResult.success) {
                toolRegistry.recordUsage(toolName, true);
            }

            await experienceBuffer.recordSuccess(
                `Tool ${toolName}`,
                JSON.stringify(args).substring(0, 100),
                'Chat tool execution succeeded',
                'CHAT'
            );

            console.log(`[CHAT_TOOLS] ✅ Tool ${toolName} completed in ${Date.now() - startTime}ms`);

            return {
                toolName,
                success: true,
                result,
                executionTimeMs: Date.now() - startTime
            };

        } catch (error: any) {
            console.error(`[CHAT_TOOLS] ❌ Tool ${toolName} failed:`, error);

            // Record failure
            toolRegistry.recordUsage(toolName, false);

            await experienceBuffer.recordFailure(
                `Tool ${toolName}`,
                JSON.stringify(args).substring(0, 100),
                error.message,
                `Investigate ${toolName} implementation`,
                'CHAT'
            );

            return {
                toolName,
                success: false,
                error: error.message,
                executionTimeMs: Date.now() - startTime
            };
        }
    }

    /**
     * Process all tool calls from response text
     */
    async processToolCalls(responseText: string): Promise<{
        toolResults: ToolCallResult[];
        enhancedResponse: string;
    }> {
        const calls = this.parseToolCalls(responseText);

        if (calls.length === 0) {
            return { toolResults: [], enhancedResponse: responseText };
        }

        console.log(`[CHAT_TOOLS] 📋 Found ${calls.length} tool call(s) to process`);

        const results: ToolCallResult[] = [];
        let enhancedResponse = responseText;

        for (const call of calls) {
            const result = await this.executeTool(call.toolName, call.args);
            results.push(result);

            // Replace tool tag with result in response
            const resultText = this.formatResultForDisplay(call.toolName, result);
            enhancedResponse = enhancedResponse.replace(call.originalMatch, resultText);
        }

        return { toolResults: results, enhancedResponse };
    }

    /**
     * Format tool result for display in chat
     */
    private formatResultForDisplay(toolName: string, result: ToolCallResult): string {
        if (!result.success) {
            return `[⚠️ Tool Error: ${result.error}]`;
        }

        // Special formatting for common tools
        switch (toolName) {
            case 'generate_image':
                if (result.result?.url) {
                    return `\n\n![Generated Image](${result.result.url})\n`;
                }
                if (result.result?.localPath) {
                    return `\n\n[🖼️ Image generated: ${result.result.localPath}]\n`;
                }
                return `[🖼️ Image: ${JSON.stringify(result.result)}]`;

            case 'web_search':
                if (Array.isArray(result.result)) {
                    return `\n**Search Results:**\n${result.result.slice(0, 3).map((r: any) =>
                        `- [${r.title}](${r.url})`
                    ).join('\n')}\n`;
                }
                return `[🔍 ${JSON.stringify(result.result)}]`;

            default:
                // Generic formatting
                const preview = JSON.stringify(result.result).substring(0, 200);
                return `[✅ ${toolName}: ${preview}${preview.length >= 200 ? '...' : ''}]`;
        }
    }

    /**
     * Try to auto-create a missing tool
     */
    private async tryCreateTool(toolName: string, args: Record<string, any>): Promise<boolean> {
        try {
            console.log(`[CHAT_TOOLS] 🏭 Attempting to create tool: ${toolName}`);

            // Infer purpose from name and args
            const purpose = this.inferToolPurpose(toolName, args);

            await toolFactory.createFromDescription(purpose, 'WORKFLOW');

            console.log(`[CHAT_TOOLS] ✅ Successfully created tool: ${toolName}`);
            return true;

        } catch (error: any) {
            console.warn(`[CHAT_TOOLS] ⚠️ Failed to auto-create tool ${toolName}:`, error.message);
            return false;
        }
    }

    /**
     * Infer tool purpose from name and arguments
     */
    private inferToolPurpose(toolName: string, args: Record<string, any>): string {
        const argsList = Object.keys(args).join(', ');
        const nameParts = toolName.split('_').join(' ');
        return `Create a tool that can ${nameParts}. It should accept these inputs: ${argsList || 'none'}`;
    }

    /**
     * Check if response contains any tool calls
     */
    hasToolCalls(responseText: string): boolean {
        return TOOL_INVOCATION_PATTERNS.some(pattern => pattern.test(responseText));
    }
}

export const chatToolIntegration = new ChatToolIntegration();
