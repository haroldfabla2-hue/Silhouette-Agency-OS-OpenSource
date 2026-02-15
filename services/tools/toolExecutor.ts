/**
 * TOOL EXECUTOR - Executes Dynamic Tools
 * 
 * Handles execution of:
 * 1. BUILTIN tools (delegates to toolHandler)
 * 2. COMPOSED tools (chains multiple tools)
 * 3. CODE tools (sandboxed code execution)
 * 
 * Part of the Self-Extending Tool System (Phase 2)
 */

import { DynamicTool, ComposedStep, toolRegistry } from './toolRegistry';
import { toolPersistence } from './toolPersistence';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

class ToolExecutor {
    private static instance: ToolExecutor;
    private builtinHandler: any = null;

    private constructor() { }

    public static getInstance(): ToolExecutor {
        if (!ToolExecutor.instance) {
            ToolExecutor.instance = new ToolExecutor();
        }
        return ToolExecutor.instance;
    }

    /**
     * Execute a tool by name with given arguments
     */
    public async execute(toolName: string, args: any): Promise<any> {
        const tool = toolRegistry.getTool(toolName);

        if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
        }

        if (!tool.enabled) {
            throw new Error(`Tool is disabled: ${toolName}`);
        }

        console.log(`[ToolExecutor] ⚡ Executing: ${toolName}`, args);
        const startTime = Date.now();

        try {
            let result: any;

            switch (tool.handler.type) {
                case 'BUILTIN':
                    result = await this.executeBuiltin(tool, args);
                    break;
                case 'COMPOSED':
                    result = await this.executeComposed(tool, args);
                    break;
                case 'CODE':
                    result = await this.executeCode(tool, args);
                    break;
                default:
                    throw new Error(`Unknown handler type for tool: ${toolName}`);
            }

            // Record successful usage
            toolRegistry.recordUsage(toolName, true);
            await toolPersistence.updateUsage(toolName, true);

            const duration = Date.now() - startTime;
            console.log(`[ToolExecutor] ✅ ${toolName} completed in ${duration}ms`);

            return result;

        } catch (error: any) {
            // Record failed usage
            toolRegistry.recordUsage(toolName, false);
            await toolPersistence.updateUsage(toolName, false);

            console.error(`[ToolExecutor] ❌ ${toolName} failed:`, error);
            throw error;
        }
    }

    /**
     * Execute builtin tool (delegates to original toolHandler)
     */
    private async executeBuiltin(tool: DynamicTool, args: any): Promise<any> {
        if (!this.builtinHandler) {
            const { toolHandler } = await import('./toolHandler');
            this.builtinHandler = toolHandler;
        }

        // Call the original handler
        return this.builtinHandler.handleFunctionCall(tool.name, args);
    }

    /**
     * Execute composed tool (chain of tools)
     */
    private async executeComposed(tool: DynamicTool, args: any): Promise<any> {
        if (tool.handler.type !== 'COMPOSED') {
            throw new Error('Handler is not COMPOSED type');
        }

        const steps = tool.handler.steps;
        const context: Record<string, any> = { ...args };
        let lastResult: any = null;

        console.log(`[ToolExecutor] 🔗 Executing composed tool with ${steps.length} steps`);

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            console.log(`[ToolExecutor] 📍 Step ${i + 1}/${steps.length}: ${step.toolName}`);

            // Resolve input mappings
            const stepArgs = this.resolveInputMappings(step.inputMapping, context, lastResult);

            // Execute the step
            const result = await this.execute(step.toolName, stepArgs);

            // Store result in context if outputAs is specified
            if (step.outputAs) {
                context[step.outputAs] = result;
            }

            lastResult = result;
        }

        // Return aggregated results or last result
        return {
            success: true,
            lastResult,
            context
        };
    }

    /**
     * Execute code tool (sandboxed)
     */
    private async executeCode(tool: DynamicTool, args: any): Promise<any> {
        if (tool.handler.type !== 'CODE') {
            throw new Error('Handler is not CODE type');
        }

        const { code, sandbox } = tool.handler;

        if (sandbox) {
            return this.executeSandboxedCode(code, args);
        } else {
            // Non-sandboxed execution (requires explicit approval)
            console.warn(`[ToolExecutor] ⚠️ Executing non-sandboxed code for ${tool.name}`);
            return this.executeUnsandboxedCode(code, args);
        }
    }

    /**
     * Resolve input mappings with variable substitution
     */
    private resolveInputMappings(
        mapping: Record<string, string>,
        context: Record<string, any>,
        lastResult: any
    ): Record<string, any> {
        const resolved: Record<string, any> = {};

        for (const [param, expression] of Object.entries(mapping)) {
            resolved[param] = this.resolveExpression(expression, context, lastResult);
        }

        return resolved;
    }

    /**
     * Resolve a single expression
     */
    private resolveExpression(expression: string, context: Record<string, any>, lastResult: any): any {
        // Handle special {{$last}} reference
        if (expression === '{{$last}}') {
            return lastResult;
        }

        // Handle variable references {{variable_name}}
        const varMatch = expression.match(/^\{\{(\w+)\}\}$/);
        if (varMatch) {
            const varName = varMatch[1];
            return context[varName];
        }

        // Handle expressions with embedded variables
        let resolved = expression;
        const matches = expression.match(/\{\{(\w+)\}\}/g);
        if (matches) {
            for (const match of matches) {
                const varName = match.replace(/\{\{|\}\}/g, '');
                const value = context[varName];
                resolved = resolved.replace(match, String(value ?? ''));
            }
        }

        return resolved;
    }

    /**
     * Execute code in sandboxed environment
     */
    private async executeSandboxedCode(code: string, args: any): Promise<any> {
        // Use VM2 or similar for true sandboxing
        // For now, use Function constructor with limited scope

        const allowedModules = {
            // Expose safe utilities
            console: {
                log: (...a: any[]) => console.log('[Sandbox]', ...a),
                warn: (...a: any[]) => console.warn('[Sandbox]', ...a),
                error: (...a: any[]) => console.error('[Sandbox]', ...a)
            },
            JSON,
            Math,
            Date,
            Array,
            Object,
            String,
            Number,
            Boolean
        };

        try {
            // Create isolated function
            const wrappedCode = `
                return (async function(args, modules) {
                    const { console, JSON, Math, Date, Array, Object, String, Number, Boolean } = modules;
                    ${code}
                })
            `;

            const fn = new Function(wrappedCode)();
            const result = await fn(args, allowedModules);

            return result;
        } catch (error: any) {
            console.error('[ToolExecutor] Sandbox execution error:', error);
            throw new Error(`Sandboxed code execution failed: ${error.message}`);
        }
    }

    /**
     * Execute code without sandbox (dangerous, requires approval)
     */
    private async executeUnsandboxedCode(code: string, args: any): Promise<any> {
        // This should only be used for trusted, user-approved code
        console.warn('[ToolExecutor] ⚠️ EXECUTING UNSANDBOXED CODE');

        try {
            const fn = new Function('args', `return (async () => { ${code} })()`);
            return await fn(args);
        } catch (error: any) {
            console.error('[ToolExecutor] Unsandboxed execution error:', error);
            throw new Error(`Code execution failed: ${error.message}`);
        }
    }

    /**
     * Validate tool execution is safe
     */
    public validateExecution(toolName: string): { safe: boolean; reason?: string } {
        const tool = toolRegistry.getTool(toolName);

        if (!tool) {
            return { safe: false, reason: 'Tool not found' };
        }

        if (!tool.enabled) {
            return { safe: false, reason: 'Tool is disabled' };
        }

        if (tool.handler.type === 'CODE' && !tool.handler.sandbox) {
            return { safe: false, reason: 'Unsandboxed code requires explicit approval' };
        }

        return { safe: true };
    }
}

export const toolExecutor = ToolExecutor.getInstance();
