/**
 * CUSTOM PLUGIN DISCOVERY (R12)
 *
 * Real discovery/validation/load/activation contract for agent-built custom
 * plugins in services/plugins/custom/. Replaces the old require()-based scan
 * in integrationHub that broke under ESM ("type": "module") and only
 * registered inert WEBHOOK descriptors without ever loading the plugin.
 *
 * Contract:
 *  - DISCOVER: list .ts/.js candidate files (no .d.ts, no tests)
 *  - VALIDATE: dynamic-import the module and check the exported plugin
 *    against the IPlugin contract (identity fields, tool shapes, and a
 *    permissions allowlist - unknown permissions reject the plugin)
 *  - LOAD/ACTIVATE: valid plugins are registered with the PluginRegistry,
 *    which executes their lifecycle (onInit, tool registration) for real
 *  - invalid or broken files stay DEACTIVATED with a recorded reason;
 *    arbitrary files are never auto-activated
 */

import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { IPlugin } from './pluginInterface';

export type PluginDiscoveryStatus = 'ACTIVATED' | 'DEACTIVATED';

export interface PluginDiscoveryResult {
    file: string;
    pluginId?: string;
    status: PluginDiscoveryStatus;
    /** Why a plugin was deactivated (contract violation, import failure, ...) */
    reason?: string;
    plugin?: IPlugin;
}

/**
 * Capabilities a custom plugin may declare. Anything outside this list
 * means the plugin asks for power we have not vetted: refuse to activate.
 */
export const KNOWN_PLUGIN_PERMISSIONS = ['tools', 'skills', 'monitoring'] as const;

export const DEFAULT_CUSTOM_PLUGINS_DIR = path.join(process.cwd(), 'services', 'plugins', 'custom');

function isCandidateFile(file: string): boolean {
    if (file.endsWith('.d.ts')) return false;
    if (file.endsWith('.test.ts') || file.endsWith('.test.js') || file.endsWith('.spec.ts') || file.endsWith('.spec.js')) return false;
    return file.endsWith('.ts') || file.endsWith('.js');
}

function validateTool(tool: any, pluginId: string): string | null {
    if (!tool || typeof tool !== 'object') return `plugin '${pluginId}' has a non-object tool entry`;
    for (const field of ['name', 'description', 'category'] as const) {
        if (typeof tool[field] !== 'string' || tool[field].length === 0) {
            return `plugin '${pluginId}' tool is missing '${field}'`;
        }
    }
    if (!tool.parameters || typeof tool.parameters !== 'object') {
        return `plugin '${pluginId}' tool '${tool.name}' is missing 'parameters'`;
    }
    if (typeof tool.handler !== 'function') {
        return `plugin '${pluginId}' tool '${tool.name}' has no executable handler`;
    }
    return null;
}

/**
 * Validate a candidate object against the IPlugin contract.
 * Returns null when valid, otherwise the rejection reason.
 */
export function validatePlugin(candidate: any): string | null {
    if (!candidate || typeof candidate !== 'object') return 'module does not export a plugin object';
    for (const field of ['id', 'name', 'version', 'description', 'author'] as const) {
        if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
            return `plugin is missing '${field}' (origin/author must be declared)`;
        }
    }
    if (!Array.isArray(candidate.tools)) return `plugin '${candidate.id}' must declare a tools array (use [] for none)`;
    for (const tool of candidate.tools) {
        const err = validateTool(tool, candidate.id);
        if (err) return err;
    }
    const permissions: unknown = (candidate as any).permissions ?? [];
    if (!Array.isArray(permissions)) return `plugin '${candidate.id}' permissions must be an array`;
    for (const perm of permissions) {
        if (!KNOWN_PLUGIN_PERMISSIONS.includes(perm as any)) {
            return `plugin '${candidate.id}' requests unvetted permission '${String(perm)}'`;
        }
    }
    return null;
}

/**
 * Discover custom plugins on disk: import each candidate for real and
 * validate its contract. Nothing is registered or executed here - use
 * loadCustomPlugins() for activation through the PluginRegistry.
 */
export async function discoverCustomPlugins(dir: string = DEFAULT_CUSTOM_PLUGINS_DIR): Promise<PluginDiscoveryResult[]> {
    const results: PluginDiscoveryResult[] = [];

    let files: string[] = [];
    try {
        files = await fs.readdir(dir);
    } catch (e: any) {
        if (e?.code === 'ENOENT') return results; // no custom dir: nothing to discover
        throw e;
    }

    for (const file of files.filter(isCandidateFile).sort()) {
        const fullPath = path.join(dir, file);
        try {
            const mod = await import(pathToFileURL(fullPath).href);
            const candidate = mod.default ?? mod.plugin;
            const rejection = validatePlugin(candidate);
            if (rejection) {
                results.push({ file, status: 'DEACTIVATED', reason: rejection });
            } else {
                const plugin = candidate as IPlugin;
                results.push({ file, pluginId: plugin.id, status: 'ACTIVATED', plugin });
            }
        } catch (e: any) {
            results.push({ file, status: 'DEACTIVATED', reason: `import failed: ${e?.message || String(e)}` });
        }
    }

    return results;
}

/**
 * Discover + validate + register valid custom plugins with the PluginRegistry
 * (which runs their real lifecycle on initialize()). Returns the per-file
 * outcome so callers (integration hub, boot) can surface deactivated plugins
 * with their reason instead of hiding them.
 */
export async function loadCustomPlugins(dir: string = DEFAULT_CUSTOM_PLUGINS_DIR): Promise<PluginDiscoveryResult[]> {
    const { pluginRegistry } = await import('./pluginRegistry');
    const results = await discoverCustomPlugins(dir);

    for (const result of results) {
        if (result.status === 'ACTIVATED' && result.plugin) {
            pluginRegistry.register(result.plugin);
            console.log(`[PluginDiscovery] 🔌 Custom plugin loaded: ${result.plugin.id} v${result.plugin.version} (from ${result.file})`);
        } else {
            console.warn(`[PluginDiscovery] ⛔ Custom plugin DEACTIVATED: ${result.file} - ${result.reason}`);
        }
    }

    return results;
}
