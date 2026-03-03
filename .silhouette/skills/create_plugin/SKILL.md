---
name: create_plugin
description: Step-by-step procedure for creating a new Silhouette OS plugin following the IPlugin standard. Use this skill when you need to integrate a new external service or capability.
---

# Create Plugin Skill

## When to Use
Use this skill when you need to create a new integration or capability that should be reusable across agents. Plugins register tools that ALL agents can access.

## Prerequisites
- Read `docs/PLUGIN_STANDARD.md` for the full IPlugin interface spec.
- Check `config/plugins.json` to make sure no similar plugin already exists.
- Check existing plugins in `services/plugins/integrations/` for reference.

## Step-by-Step Procedure

### 1. Create the Plugin Directory
```
services/plugins/integrations/<pluginName>/index.ts
```

### 2. Implement the IPlugin Interface
Your plugin MUST export an object conforming to `IPlugin`:

```typescript
import { IPlugin } from '../../pluginInterface';

const myPlugin: IPlugin = {
    id: 'integration-my-service',   // Unique kebab-case ID
    name: 'My Service',             // Human name
    version: '1.0.0',
    description: 'What this plugin does.',
    author: 'Silhouette',

    tools: [
        {
            name: 'my_tool_name',           // snake_case, globally unique
            description: 'What the tool does.',
            category: 'UTILITY',            // Valid: MEDIA, RESEARCH, ASSET, WORKFLOW, UTILITY, META, DEV, COMMUNICATION
            parameters: {
                type: 'OBJECT',
                properties: {
                    paramName: { type: 'STRING', description: 'Param description.' }
                },
                required: ['paramName']
            } as any,
            handler: async (args: any) => {
                // Tool logic here
                return { result: 'success' };
            }
        }
    ],

    onInit: async () => {
        // Validate credentials, log warnings
    },

    onStop: async () => {
        // Cleanup resources
    }
};

export default myPlugin;
```

### 3. Register in plugins.json
Add an entry to `config/plugins.json`:
```json
"integration-my-service": {
    "enabled": false,
    "auto_disable_on_load": false,
    "notes": "Requires MY_API_KEY in .env.local"
}
```

### 4. Required Environment Variables
Document any required env vars in `.env.example` and in the plugin's `onInit()` warning message.

## Rules
- Tool names must be globally unique (prefix with service name).
- Handlers must be stateless — no side effects outside the tool's purpose.
- Always validate credentials in `onInit()` and warn gracefully if missing.
- Never store secrets in code — use `.env.local` or `silhouette.config.json`.
- Use valid ToolCategory values only: MEDIA, RESEARCH, ASSET, WORKFLOW, UTILITY, META, DEV, COMMUNICATION.
