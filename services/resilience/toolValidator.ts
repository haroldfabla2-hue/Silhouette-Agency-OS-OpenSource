/**
 * TOOL VALIDATOR - Pre-Registration Validation
 * 
 * Validates tools before they are registered to prevent:
 * 1. Invalid schemas
 * 2. Malicious code
 * 3. Reference errors
 * 4. Circular dependencies
 * 
 * Part of the Crash-Proof Resilience Layer (Phase 4)
 */

import { DynamicTool, ToolHandler, ComposedStep, toolRegistry } from '../tools/toolRegistry';
import { dependencyGraph } from '../tools/dependencyGraph';

// ==================== INTERFACES ====================

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    code: string;
    message: string;
    field?: string;
}

export interface ValidationWarning {
    code: string;
    message: string;
    suggestion?: string;
}

// ==================== VALIDATOR ====================

class ToolValidator {
    private static instance: ToolValidator;

    // Rate limiting
    private creationTimestamps: number[] = [];
    private readonly MAX_CREATIONS_PER_MINUTE = 5;

    private constructor() { }

    public static getInstance(): ToolValidator {
        if (!ToolValidator.instance) {
            ToolValidator.instance = new ToolValidator();
        }
        return ToolValidator.instance;
    }

    /**
     * Full validation of a tool before registration
     */
    public validate(tool: Partial<DynamicTool>): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // 1. Required fields
        this.validateRequiredFields(tool, errors);

        // 2. Name format
        this.validateName(tool.name, errors, warnings);

        // 3. Handler validation
        if (tool.handler) {
            this.validateHandler(tool.handler, tool.name || 'unknown', errors, warnings);
        }

        // 4. Schema validation
        if (tool.parameters) {
            this.validateSchema(tool.parameters, errors);
        }

        // 5. Rate limiting
        this.validateRateLimit(errors);

        // 6. Duplicate check
        this.validateNoDuplicate(tool.name || '', errors);

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate required fields
     */
    private validateRequiredFields(tool: Partial<DynamicTool>, errors: ValidationError[]): void {
        if (!tool.name) {
            errors.push({ code: 'MISSING_NAME', message: 'Tool name is required' });
        }
        if (!tool.description) {
            errors.push({ code: 'MISSING_DESCRIPTION', message: 'Tool description is required' });
        }
        if (!tool.handler) {
            errors.push({ code: 'MISSING_HANDLER', message: 'Tool handler is required' });
        }
        if (!tool.category) {
            errors.push({ code: 'MISSING_CATEGORY', message: 'Tool category is required' });
        }
    }

    /**
     * Validate name format
     */
    private validateName(name: string | undefined, errors: ValidationError[], warnings: ValidationWarning[]): void {
        if (!name) return;

        // Must be snake_case
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
            errors.push({
                code: 'INVALID_NAME_FORMAT',
                message: 'Tool name must be snake_case starting with a letter',
                field: 'name'
            });
        }

        // Warn on very short names
        if (name.length < 3) {
            warnings.push({
                code: 'SHORT_NAME',
                message: 'Tool name is very short',
                suggestion: 'Consider using a more descriptive name'
            });
        }

        // Warn on very long names
        if (name.length > 50) {
            warnings.push({
                code: 'LONG_NAME',
                message: 'Tool name is very long',
                suggestion: 'Consider using a shorter name'
            });
        }
    }

    /**
     * Validate handler based on type
     */
    private validateHandler(
        handler: ToolHandler,
        toolName: string,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): void {
        switch (handler.type) {
            case 'BUILTIN':
                if (!handler.handlerName) {
                    errors.push({
                        code: 'MISSING_HANDLER_NAME',
                        message: 'BUILTIN handler requires handlerName'
                    });
                }
                break;

            case 'COMPOSED':
                this.validateComposedHandler(handler.steps, toolName, errors, warnings);
                break;

            case 'CODE':
                this.validateCodeHandler(handler.code, errors, warnings);
                break;
        }
    }

    /**
     * Validate COMPOSED handler
     */
    private validateComposedHandler(
        steps: ComposedStep[],
        toolName: string,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): void {
        if (!steps || steps.length === 0) {
            errors.push({
                code: 'EMPTY_STEPS',
                message: 'COMPOSED handler requires at least one step'
            });
            return;
        }

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];

            // Check if referenced tool exists
            if (!toolRegistry.hasTool(step.toolName)) {
                errors.push({
                    code: 'UNKNOWN_TOOL_REFERENCE',
                    message: `Step ${i + 1} references unknown tool: ${step.toolName}`,
                    field: `steps[${i}].toolName`
                });
            }

            // Check for circular dependency
            if (dependencyGraph.wouldCreateCycle(toolName, step.toolName)) {
                errors.push({
                    code: 'CIRCULAR_DEPENDENCY',
                    message: `Step ${i + 1} would create circular dependency: ${toolName} → ${step.toolName}`,
                    field: `steps[${i}].toolName`
                });
            }

            // Check input mapping
            if (!step.inputMapping || Object.keys(step.inputMapping).length === 0) {
                warnings.push({
                    code: 'EMPTY_INPUT_MAPPING',
                    message: `Step ${i + 1} has no input mapping`,
                    suggestion: 'Add input mappings for tool parameters'
                });
            }
        }
    }

    /**
     * Validate CODE handler
     */
    private validateCodeHandler(code: string, errors: ValidationError[], warnings: ValidationWarning[]): void {
        if (!code || code.trim().length === 0) {
            errors.push({
                code: 'EMPTY_CODE',
                message: 'CODE handler requires non-empty code'
            });
            return;
        }

        // Check for dangerous patterns
        const dangerousPatterns = [
            { pattern: /require\s*\(/gi, code: 'REQUIRE_USAGE', message: 'Use of require() is not allowed' },
            { pattern: /import\s+/gi, code: 'IMPORT_USAGE', message: 'Use of import statements is not allowed' },
            { pattern: /eval\s*\(/gi, code: 'EVAL_USAGE', message: 'Use of eval() is not allowed' },
            { pattern: /Function\s*\(/gi, code: 'FUNCTION_CONSTRUCTOR', message: 'Use of Function constructor is not allowed' },
            { pattern: /process\./gi, code: 'PROCESS_ACCESS', message: 'Access to process object is not allowed' },
            { pattern: /child_process/gi, code: 'CHILD_PROCESS', message: 'Use of child_process is not allowed' },
            { pattern: /fs\./gi, code: 'FS_ACCESS', message: 'Direct filesystem access is not allowed' },
            { pattern: /\.exec\s*\(/gi, code: 'EXEC_USAGE', message: 'Use of .exec() is not allowed' },
            { pattern: /global\./gi, code: 'GLOBAL_ACCESS', message: 'Access to global object is not allowed' }
        ];

        for (const { pattern, code: errorCode, message } of dangerousPatterns) {
            if (pattern.test(code)) {
                errors.push({ code: errorCode, message, field: 'code' });
            }
        }

        // Warn on long code
        if (code.length > 10000) {
            warnings.push({
                code: 'LONG_CODE',
                message: 'Code is very long (>10000 chars)',
                suggestion: 'Consider breaking into smaller tools'
            });
        }
    }

    /**
     * Validate schema structure
     */
    private validateSchema(schema: any, errors: ValidationError[]): void {
        if (!schema.type) {
            errors.push({
                code: 'MISSING_SCHEMA_TYPE',
                message: 'Schema must have a type property'
            });
        }

        if (schema.type !== 'OBJECT' && schema.type !== 'object') {
            errors.push({
                code: 'INVALID_SCHEMA_TYPE',
                message: 'Schema type must be OBJECT'
            });
        }

        if (schema.properties && typeof schema.properties !== 'object') {
            errors.push({
                code: 'INVALID_PROPERTIES',
                message: 'Schema properties must be an object'
            });
        }
    }

    /**
     * Rate limiting validation
     */
    private validateRateLimit(errors: ValidationError[]): void {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // Clean old timestamps
        this.creationTimestamps = this.creationTimestamps.filter(ts => ts > oneMinuteAgo);

        if (this.creationTimestamps.length >= this.MAX_CREATIONS_PER_MINUTE) {
            errors.push({
                code: 'RATE_LIMIT_EXCEEDED',
                message: `Too many tool creations. Limit: ${this.MAX_CREATIONS_PER_MINUTE}/minute`
            });
        } else {
            this.creationTimestamps.push(now);
        }
    }

    /**
     * Check for duplicate tool names
     */
    private validateNoDuplicate(name: string, errors: ValidationError[]): void {
        if (name && toolRegistry.hasTool(name)) {
            errors.push({
                code: 'DUPLICATE_NAME',
                message: `Tool with name "${name}" already exists`
            });
        }
    }

    /**
     * Reset rate limiter (for testing)
     */
    public resetRateLimit(): void {
        this.creationTimestamps = [];
    }
}

export const toolValidator = ToolValidator.getInstance();
