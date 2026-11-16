/** This follow-up changes computed evaluation policy, NOT the accepted inventory
 * or cooperative lifecycle contracts. Earlier R12 import/activation commentary
 * below is historical; discovery now returns PENDING_EVALUATION without import. */
import { inventoryPluginSources, type PluginSourceInventory } from './pluginInventory';
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
import { IPlugin } from './pluginInterface';

export type PluginDiscoveryStatus='ACTIVATED'|'DEACTIVATED'|'PENDING_EVALUATION';

export interface PluginDiscoveryResult {
    file: string;
    pluginId?: string;
    status: PluginDiscoveryStatus;
    /** Why a plugin was deactivated (contract violation, import failure, ...) */
    reason?: string;
    plugin?:IPlugin;
    source?:PluginSourceInventory['entries'][number];
    evaluation?:'NOT_STARTED';
    activation?:'NOT_STARTED';
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
 * validate its contract. Top-level module code IS executed by ESM import; use
 * loadCustomPlugins() for activation through the PluginRegistry.
 */
const discoveries = new Map<string, Promise<PluginDiscoveryResult[]>>();
const inventories = new Map<string, PluginSourceInventory>();
export function getPluginSourceInventories(): PluginSourceInventory[] { return [...inventories.values()]; }
export function discoverCustomPlugins(dir: string = DEFAULT_CUSTOM_PLUGINS_DIR): Promise<PluginDiscoveryResult[]> {
    const key = path.resolve(dir);
    let pending = discoveries.get(key);
    if (!pending) {
        pending = discoverOnce(key);
        discoveries.set(key, pending);
    }
    return pending;
}
async function discoverOnce(dir: string): Promise<PluginDiscoveryResult[]> {
    const results: PluginDiscoveryResult[] = [];

    const inventory = await inventoryPluginSources(dir);
    inventories.set(dir, inventory);
    // Keep the accepted complete deterministic inventory and provenance.
    // Do not execute unknown module code just to validate its exported shape.
    // Hashes/source flags are NOT approval, passivity or containment evidence.
    for(const entry of inventory.entries) {
        results.push({file:entry.file,status:'PENDING_EVALUATION',source:entry,evaluation:'NOT_STARTED',activation:'NOT_STARTED',reason:'Source inventoried only; computed module evaluation/top-level ownership and authenticated activation scope are not established'});
    }

    return results;
}

/**
 * Discover + validate + register valid custom plugins with the PluginRegistry
 * (which runs their real lifecycle on initialize()). Returns the per-file
 * outcome so callers (integration hub, boot) can surface deactivated plugins
 * with their reason instead of hiding them.
 */
export async function loadCustomPlugins(dir:string=DEFAULT_CUSTOM_PLUGINS_DIR):Promise<PluginDiscoveryResult[]> {
    // Compatibility entry point preserves discovery requests. It does NOT
    // import Registry or candidate modules to manufacture an activation receipt.
    const results=await discoverCustomPlugins(dir);
    for(const result of results)console.info('[PluginDiscovery] '+result.file+': '+result.status+' ('+result.reason+')');
    return results;
}
