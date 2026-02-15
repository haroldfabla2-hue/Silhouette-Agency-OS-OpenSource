import { IPlugin } from './pluginInterface';
import { toolRegistry, DynamicTool } from '../tools/toolRegistry';
import { skillRegistry } from '../skills/skillRegistry';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';

/**
 * PLUGIN REGISTRY
 * 
 * Manages the lifecycle of plugins:
 * 1. Loading (Registration)
 * 2. Initialization (onInit)
 * 3. Activation (Registering tools/skills)
 * 4. Startup (onStart)
 */
class PluginRegistry {
    private static instance: PluginRegistry;
    private plugins: Map<string, IPlugin> = new Map();
    private initialized: boolean = false;

    private constructor() { }

    public static getInstance(): PluginRegistry {
        if (!PluginRegistry.instance) {
            PluginRegistry.instance = new PluginRegistry();
        }
        return PluginRegistry.instance;
    }

    /**
     * Register a plugin with the system.
     * This adds it to the registry but does not initialize it yet.
     */
    public register(plugin: IPlugin): void {
        if (this.plugins.has(plugin.id)) {
            console.warn(`[PluginRegistry] ⚠️ Overwriting plugin: ${plugin.id}`);
        }
        this.plugins.set(plugin.id, plugin);
        console.log(`[PluginRegistry] 📦 Registered plugin: ${plugin.name} v${plugin.version}`);
    }

    /**
     * Initialize all registered plugins.
     * This calls onInit(), registers tools to ToolRegistry, and creates Skills.
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('[PluginRegistry] 🚀 Initializing plugins...');

        // [PHASE 16] Dynamic Plugin Management with Power Awareness
        let pluginConfig: any = {};
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const configPath = path.join(process.cwd(), 'config', 'plugins.json');
            const data = await fs.readFile(configPath, 'utf-8');
            pluginConfig = JSON.parse(data);
        } catch (e) {
            console.warn('[PluginRegistry] No config/plugins.json found, defaulting to ALL ENABLED.');
        }

        // Check Power/CPU State for Auto-Disable
        let highLoadMode = false;
        try {
            const si = await import('systeminformation');
            const load = await si.currentLoad();
            const threshold = pluginConfig.auto_disable_threshold_cpu || 80;
            if (load.currentLoad > threshold) {
                console.warn(`[PluginRegistry] 🔥 High CPU Load (${load.currentLoad.toFixed(1)}% > ${threshold}%). Activating Adaptive Plugin Throttling.`);
                highLoadMode = true;
            }
        } catch (e) {
            // Ignore if systeminformation fails, assume normal load
        }

        for (const [id, plugin] of this.plugins) {
            const config = pluginConfig.plugins?.[plugin.id];

            // 1. Manual Disable
            if (config?.enabled === false) {
                console.log(`[PluginRegistry] ⏸️ Skipping disabled plugin: ${plugin.name} (${plugin.id})`);
                continue;
            }

            // 2. Auto-Disable on High Load
            if (highLoadMode && config?.auto_disable_on_load === true) {
                console.log(`[PluginRegistry] 📉 Auto-disabling heavy plugin due to system load: ${plugin.name} (${plugin.id})`);
                continue;
            }

            try {
                // 1. Lifecycle: onInit
                if (plugin.onInit) {
                    await plugin.onInit();
                }

                // 2. Register Tools
                for (const toolDef of plugin.tools) {
                    const dynamicTool: DynamicTool = {
                        id: `plugin_${plugin.id}_${toolDef.name}`,
                        name: toolDef.name,
                        description: toolDef.description,
                        parameters: toolDef.parameters,
                        category: toolDef.category,
                        handler: {
                            type: 'CODE',
                            code: '[Compiled Plugin Code]',
                            sandbox: false // Plugins are trusted code for now
                        },
                        createdBy: 'SYSTEM', // Plugin tools are considered System tools
                        enabled: true,
                        usageCount: 0,
                        successCount: 0,
                        createdAt: Date.now(),
                        version: plugin.version,
                        tags: ['plugin', plugin.id]
                    };

                    // We need a way to pass the actual handler function to the ToolHandler
                    // For now, we will rely on a separate map in the ToolHandler or update ToolRegistry
                    // to support direct function references (Runtime Tools).
                    // Since ToolRegistry stores "handler" as a serializable object for DB, 
                    // we need to bridge this.

                    // BRIDGE STRATEGY: 
                    // We will register the tool in ToolRegistry for metadata purposes (LLM context),
                    // but the execution will need to be routed.
                    // The standard ToolHandler will need a "PLUGIN" handler type or we overload BUILTIN.
                    // Let's use 'BUILTIN' type but prefix the handlerName so ToolHandler can find it.

                    // Actually, the cleanest way is to have ToolRegistry support a "runtime" cache
                    // of handlers that doesn't go to DB.

                    // Checks if we need to extend ToolHandler to support this.
                    // For Phase 1, we will register them as BUILTIN and assume ToolHandler
                    // has been updated to lookup in PluginRegistry.

                    toolRegistry.registerTool({
                        ...dynamicTool,
                        handler: { type: 'BUILTIN', handlerName: `PLUGIN:${plugin.id}:${toolDef.name}` }
                    });
                }

                // 3. Register Skills
                if (plugin.skills) {
                    for (const skill of plugin.skills) {
                        skillRegistry.register(skill);
                    }
                }

                // 4. Lifecycle: onStart
                if (plugin.onStart) {
                    await plugin.onStart();
                }

                console.log(`[PluginRegistry] ✅ Initialized: ${plugin.name}`);

            } catch (error) {
                console.error(`[PluginRegistry] ❌ Failed to initialize plugin ${plugin.name}:`, error);
            }
        }

        this.initialized = true;

        systemBus.emit(SystemProtocol.UI_REFRESH, {
            source: 'PLUGIN_REGISTRY',
            message: `Plugins initialized: ${this.plugins.size}`
        });
    }

    /**
     * Get a specific tool's handler from a plugin.
     * Used by ToolHandler to execute the tool actions.
     */
    public getToolHandler(pluginId: string, toolName: string): ((args: any) => Promise<any>) | undefined {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return undefined;

        const tool = plugin.tools.find(t => t.name === toolName);
        return tool?.handler;
    }

    /**
     * Shutdown all plugins.
     */
    public async shutdown(): Promise<void> {
        for (const [id, plugin] of this.plugins) {
            if (plugin.onStop) {
                try {
                    await plugin.onStop();
                } catch (error) {
                    console.error(`[PluginRegistry] Error stopping ${plugin.name}:`, error);
                }
            }
        }
        this.initialized = false;
    }
}

export const pluginRegistry = PluginRegistry.getInstance();
