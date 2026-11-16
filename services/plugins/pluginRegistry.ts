import { PluginResourceOwner } from './pluginLifecycle';
import { IPlugin } from './pluginInterface';
import { toolRegistry, DynamicTool } from '../tools/toolRegistry';
import { skillRegistry } from '../skills/skillRegistry';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';
import { nervousSystem } from '../connectionNervousSystem';

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
    private closing = false;
    private startTask?: Promise<void>;
    private stopTask?: Promise<void>;
    private readonly owners = new Map<string, PluginResourceOwner>();
    private readonly started = new Set<string>();
    private readonly lifecycleErrors: Array<{ pluginId: string; phase: string; error: unknown }> = [];
    public getLifecycleStatus() {
        return { closing: this.closing, initialized: this.initialized,
            plugins: [...this.plugins.keys()].map(id => ({ id, started: this.started.has(id), lifecycle: this.owners.get(id)?.verdict ?? 'LEGACY_UNMANAGED_UNVERIFIED' })),
            errors: [...this.lifecycleErrors] };
    }

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
        if (this.closing) throw new Error('Plugin registration refused while closing');
        const existing = this.plugins.get(plugin.id);
        if (existing === plugin) return; // integrationHub/index share discovery objects.
        if (existing) throw new Error(`Plugin identity conflict: ${plugin.id}; existing owner preserved`);
        this.plugins.set(plugin.id, plugin);
        console.log(`[PluginRegistry] 📦 Registered plugin: ${plugin.name} v${plugin.version}`);
    }

    /**
     * Initialize all registered plugins.
     * This calls onInit(), registers tools to ToolRegistry, and creates Skills.
     */
    public initialize(): Promise<void> {
        if (this.closing) return Promise.reject(new Error('Plugin registry is closing'));
        if (!this.startTask) this.startTask = this.initializeOnce();
        return this.startTask;
    }
    private async initializeOnce(): Promise<void> {
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
            if (this.closing) break;
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

            const owner = new PluginResourceOwner(id, plugin.lifecycle);
            this.owners.set(id, owner);
            let hookAcquired = false;
            // onStop applies only once hook acquisition begins, not skipped plugins.
            owner.context.own({ name: `plugin-stop:${id}`, closeRank: 1000, close: async () => {
                if (hookAcquired && plugin.onStop) await plugin.onStop();
            } });
            try {
                // 1. Lifecycle: onInit
                if (plugin.onInit) {
                    hookAcquired = true;
                    await owner.hook('onInit', context => plugin.onInit!(context));
                }

                if (this.closing) throw new Error('Plugin startup interrupted by close');
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
                        tags: ['plugin', plugin.id],
                        effects: toolDef.effects // fail-closed when absent (see security/toolEffects)
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

                    const undoTool = toolRegistry.registerOwnedTool({
                        ...dynamicTool,
                        handler: { type: 'BUILTIN', handlerName: `PLUGIN:${plugin.id}:${toolDef.name}` }
                    });
                    owner.context.own({ name: `tool-registration:${toolDef.name}`, close: undoTool });
                }

                // 3. Register Skills
                if (plugin.skills) {
                    for (const skill of plugin.skills) {
                        const undoSkill = skillRegistry.registerOwned(skill);
                        owner.context.own({ name: `skill-registration:${skill.name}`, close: undoSkill });
                    }
                }

                // 4. Lifecycle: onStart
                if (plugin.onStart) {
                    hookAcquired = true;
                    await owner.hook('onStart', context => plugin.onStart!(context));
                }

                if (this.closing) throw new Error('Plugin startup interrupted by close');
                // 5. Auto-register monitoring with Nervous System
                if (plugin.monitoring) {
                    nervousSystem.register({
                        id: plugin.monitoring.monitorId,
                        name: plugin.monitoring.monitorName,
                        type: plugin.monitoring.monitorType,
                        isRequired: plugin.monitoring.isRequired,
                        checkHealth: () => owner.run('monitor-health', () => plugin.monitoring!.checkHealth()),
                        reconnect: () => owner.run('monitor-reconnect', () => plugin.monitoring!.reconnect())
                    });
                }

                if (plugin.monitoring) owner.context.own({ name: `monitor:${id}`, stopIntake: () => { nervousSystem.unregister(plugin.monitoring!.monitorId); }, close: () => { nervousSystem.unregister(plugin.monitoring!.monitorId); } });
                this.started.add(id);
                console.log(`[PluginRegistry] Initialized with lifecycle ${owner.verdict}: ${plugin.name}`);

            } catch (error) {
                this.lifecycleErrors.push({ pluginId: id, phase: 'initialize', error });
                await owner.close();
                console.error(`[PluginRegistry] Failed to initialize plugin ${plugin.name}:`, error);
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
        const owner = this.owners.get(pluginId);
        if (!tool || !owner || !this.started.has(pluginId) || this.closing) return undefined;
        return args => owner.run(`tool:${toolName}`, () => tool.handler(args));
    }

    /**
     * Shutdown all plugins.
     */
    public shutdown(): Promise<void> {
        if (this.stopTask) return this.stopTask;
        this.closing = true;
        this.stopTask = Promise.resolve().then(async () => {
            await this.startTask?.catch(error => { this.lifecycleErrors.push({ pluginId: 'registry', phase: 'startup', error }); });
            for (const [id, owner] of [...this.owners].reverse()) {
                const plugin = this.plugins.get(id)!;
                if (plugin.monitoring) nervousSystem.unregister(plugin.monitoring.monitorId);
                const report = await owner.close();
                for (const failure of report.failures) this.lifecycleErrors.push({ pluginId: id, phase: failure.phase, error: failure.error });
            }
            this.initialized = false;
            this.started.clear();
            if (this.lifecycleErrors.length) throw new AggregateError(this.lifecycleErrors.map(f => f.error), 'Plugin lifecycle contains failed receipts');
        });
        return this.stopTask;
    }
}

export const pluginRegistry = PluginRegistry.getInstance();
