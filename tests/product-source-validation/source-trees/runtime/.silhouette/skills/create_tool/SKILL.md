---
name: create_tool
description: Step-by-step procedure for creating new runtime tools in Silhouette OS using ToolFactory and ToolRegistry. Use when an existing tool doesn't meet the current need.
---

# Create Tool Skill

## When to Use
- When no existing tool can accomplish a specific task.
- When you need to compose multiple existing tools into a pipeline.
- When a frequently repeated action should be formalized as a tool.

## Prerequisites
- Check `ToolRegistry.getAllTools()` to verify no similar tool exists.
- Identify the correct handler type: BUILTIN, COMPOSED, or CODE.

## Handler Types

### BUILTIN
References an existing handler function by name. Best for wrapping system capabilities.

### COMPOSED
Chains multiple existing tools in sequence. Best for multi-step workflows.
```json
{
    "type": "COMPOSED",
    "steps": [
        { "toolName": "web_search", "inputMapping": { "query": "task_description" }, "outputAs": "search_results" },
        { "toolName": "memory_write", "inputMapping": { "content": "search_results" } }
    ]
}
```

### CODE
Executes sandboxed JavaScript code. Best for custom logic.
```json
{
    "type": "CODE",
    "code": "return { result: args.input.toUpperCase() };",
    "sandbox": true
}
```

## Step-by-Step Procedure

### 1. Define the Tool
```typescript
const myTool: DynamicTool = {
    id: 'unique-uuid-here',
    name: 'my_custom_tool',           // snake_case, globally unique
    description: 'What this tool does in one sentence.',
    parameters: {
        type: 'OBJECT',
        properties: {
            input: { type: 'STRING', description: 'What the parameter expects.' }
        },
        required: ['input']
    },
    handler: {
        type: 'CODE',
        code: 'return { processed: args.input };',
        sandbox: true
    },
    category: 'UTILITY',              // Valid: MEDIA, RESEARCH, ASSET, WORKFLOW, UTILITY, META, DEV, COMMUNICATION
    createdBy: 'SILHOUETTE',          // or 'USER', 'SYSTEM'
    enabled: true,
    usageCount: 0,
    successCount: 0,
    createdAt: Date.now(),
    version: '1.0.0',
    tags: ['custom', 'automation']
};
```

### 2. Register the Tool
```typescript
import { toolRegistry } from 'services/tools/toolRegistry';
toolRegistry.registerTool(myTool);
```

This will:
1. Validate the tool definition
2. Check for name conflicts
3. Register it in the runtime registry
4. Persist it to disk via ToolPersistence
5. Emit a SYSTEM event so all agents are notified

### 3. Verify Registration
```typescript
const exists = toolRegistry.hasTool('my_custom_tool');
const tool = toolRegistry.getTool('my_custom_tool');
```

## Rules
- Tool names must be globally unique across the entire system.
- Always use `sandbox: true` for CODE handlers to prevent unsafe execution.
- COMPOSED tools must reference only existing, registered tools.
- Test the tool after registration by calling it with sample arguments.
- If a tool consistently fails (successCount/usageCount < 0.5), consider revising or deleting it.
- To delete a tool: `toolRegistry.deleteTool('tool_name')` — this checks for dependents first.
- Valid categories: MEDIA, RESEARCH, ASSET, WORKFLOW, UTILITY, META, DEV, COMMUNICATION.
