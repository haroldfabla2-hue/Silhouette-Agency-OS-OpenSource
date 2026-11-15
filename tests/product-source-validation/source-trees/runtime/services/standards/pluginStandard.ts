/**
 * PLUGIN STANDARD
 * 
 * Defines the standard interface for all plugins in Silhouette Agency OS.
 * Plugins bundle tools and optionally agents into installable packages.
 * They follow a lifecycle: initialize → active → shutdown.
 */

import { StandardTool } from './toolStandard';

// ═══════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════

/** Plugin lifecycle status */
export type PluginStatus = 'UNLOADED' | 'INITIALIZING' | 'ACTIVE' | 'ERROR' | 'SHUTDOWN';

/** Plugin manifest — describes what the plugin provides */
export interface PluginManifest {
    /** Unique plugin identifier */
    id: string;
    /** Semantic version */
    version: string;
    /** Human-readable name */
    name: string;
    /** Description of what the plugin does */
    description: string;
    /** Plugin author */
    author: string;
    /** Minimum Silhouette version required */
    minSystemVersion?: string;
    /** Other plugins this depends on */
    dependencies?: string[];
}

/** Standard plugin interface */
export interface StandardPlugin {
    /** Plugin manifest */
    manifest: PluginManifest;
    /** Current status */
    status: PluginStatus;
    /** Tools provided by this plugin */
    tools: StandardTool[];

    /** Initialize the plugin (called once on load) */
    initialize(): Promise<void>;

    /** Shutdown the plugin gracefully */
    shutdown(): Promise<void>;

    /** Check if the plugin is healthy */
    healthCheck(): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface PluginValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validates a plugin manifest.
 */
export function validatePluginManifest(manifest: PluginManifest): PluginValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!manifest.id) errors.push('Plugin must have an id');
    if (!manifest.version) errors.push('Plugin must have a version');
    if (!manifest.name) errors.push('Plugin must have a name');
    if (!manifest.description) warnings.push('Plugin should have a description');

    // ID format
    if (manifest.id && !/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
        errors.push(`Plugin ID "${manifest.id}" contains invalid characters`);
    }

    // Version format (basic semver)
    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
        warnings.push(`Version "${manifest.version}" does not follow semver format`);
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Safely initializes a plugin with error handling.
 */
export async function safeInitializePlugin(plugin: StandardPlugin): Promise<boolean> {
    try {
        const validation = validatePluginManifest(plugin.manifest);
        if (!validation.valid) {
            console.error(`[PLUGIN_STANDARD] ❌ Invalid plugin manifest for "${plugin.manifest.id}":`, validation.errors);
            return false;
        }

        if (validation.warnings.length > 0) {
            console.warn(`[PLUGIN_STANDARD] ⚠️ Plugin "${plugin.manifest.id}" warnings:`, validation.warnings);
        }

        await plugin.initialize();
        console.log(`[PLUGIN_STANDARD] ✅ Plugin "${plugin.manifest.name}" v${plugin.manifest.version} initialized`);
        return true;
    } catch (error: any) {
        console.error(`[PLUGIN_STANDARD] 💥 Plugin "${plugin.manifest.id}" failed to initialize:`, error.message);
        return false;
    }
}
