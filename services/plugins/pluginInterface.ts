import { FunctionDeclarationSchema, ToolCategory } from '../tools/toolRegistry';
import { SkillDefinition } from '../skills/skillRegistry';

/**
 * Definition of a Tool provided by a Plugin.
 * This decouples the tool implementation from the ToolRegistry's internal format.
 */
export interface PluginToolDefinition {
    name: string;
    description: string;
    category: ToolCategory;
    parameters: FunctionDeclarationSchema;
    handler: (args: any) => Promise<any>;
}

/**
 * Interface for a Silhouette Plugin.
 * A Plugin is a self-contained module that adds capabilities (Tools and Skills) to the agent.
 */
export interface IPlugin {
    /** Unique identifier for the plugin (e.g., 'core-filesystem') */
    id: string;

    /** Human-readable name */
    name: string;

    /** Semantic version string */
    version: string;

    /** Description of what the plugin does */
    description: string;

    /** Author/Maintainer of the plugin */
    author: string;

    /** 
     * Tools provided by this plugin.
     * These will be automatically registered with the ToolRegistry.
     */
    tools: PluginToolDefinition[];

    /**
     * Skills provided by this plugin.
     * These will be automatically registered with the SkillRegistry.
     */
    skills?: SkillDefinition[];

    /**
     * Initialization hook.
     * Called when the plugin is loaded, before tools are registered.
     * Use this to validation config, connect to databases, etc.
     */
    onInit?(): Promise<void>;

    /**
     * Start hook.
     * Called after all plugins are loaded and tools registered.
     */
    onStart?(): Promise<void>;

    /**
     * Stop hook.
     * Called during system shutdown.
     */
    onStop?(): Promise<void>;
}
