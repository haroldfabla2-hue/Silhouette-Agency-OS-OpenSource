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
