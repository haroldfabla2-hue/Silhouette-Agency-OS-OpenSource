# Standard for Silhouette Plugins (TypeScript)

This document defines the standard for creating **Plugins** in Silhouette.
A Plugin is a **code-based module** that extends the core engine with new executable Tools and functionality.

## 1. Structure
Plugins reside in `src/plugins/<category>/<plugin-name>/`.
Each plugin is a folder containing at least an `index.ts`.

```
src/plugins/integrations/github/
├── index.ts        # Plugin Definition (Entry Point)
├── tools.ts        # Tool Implementation functions
└── types.ts        # Interfaces
```

## 2. The `IPlugin` Interface
All plugins must export a default object implementing `IPlugin`.

```typescript
import { IPlugin } from '../../pluginInterface';
import * as tools from './tools';

const plugin: IPlugin = {
    id: 'integration-github',
    name: 'GitHub Integration',
    version: '1.0.0',
    description: 'Provides tools to interact with GitHub repositories.',
    author: 'Silhouette',
    
    // Define tools exposed by this plugin
    tools: [
        {
            name: 'github_create_issue',
            description: 'Creates a new issue',
            category: 'DEV',
            parameters: { ...schema... },
            handler: tools.createIssue // Function reference
        }
    ],
    
    // Lifecycle hooks
    onInit: async () => {
        // Validate API Key
        if (!process.env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN");
    }
};

export default plugin;
```

## 3. Creating Tools
Tools are pure async functions.

```typescript
// tools.ts
export const createIssue = async (args: { title: string, body: string }) => {
    // Implementation using Octokit or fetch
    return { issueUrl: '...' };
};
```

## 4. Registration
To activate a plugin:
1.  Import it in `src/server/plugins/index.ts` (or the main loader).
2.  Add it to the `PluginRegistry`.

## 5. Development Rules
1.  **Stateless**: Tools should be stateless where possible.
2.  **Error Handling**: Throw informative errors.
3.  **Security**: Validate all inputs. Do not assume safe execution.
