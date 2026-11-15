import { pluginRegistry } from './pluginRegistry';
import { CoreFilesystemPlugin } from './core/filesystem';

/**
 * Registers all available plugins into the registry.
 * In a future version, this could scan the directory dynamically.
 */
export const registerCorePlugins = () => {
    console.log('[PluginLoader] 🔌 Registering core plugins...');

    pluginRegistry.register(CoreFilesystemPlugin);

    // Add other plugins here (e.g. CoreGitHubPlugin, etc.)
};

/**
 * [R12] Discover, validate and register agent-built custom plugins
 * (services/plugins/custom/). Invalid files stay deactivated with a logged
 * reason; valid ones are registered so pluginRegistry.initialize() runs
 * their real lifecycle (onInit, tool registration).
 */
export const registerCustomPlugins = async (dir?: string) => {
    const { loadCustomPlugins } = await import('./discovery');
    return loadCustomPlugins(dir);
};
