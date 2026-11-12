/** Process-local external-provider credential isolation. Never rotates credentials.
 * This is credential-source isolation, NOT an OS/network sandbox. Run only in
 * a separate release with backups and an external egress restriction. Acceptance
 * additionally requires disposable data and disables local memory modules.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

import { acceptanceBoot, externalProvidersDisabled } from '../../services/security/bootMode';
export { acceptanceBoot, externalProvidersDisabled } from '../../services/security/bootMode';

// Deliberately an allowlist: a custom provider can use ANY env var as its key.
// Keep local API authentication, isolated storage paths and runtime essentials.
const ACCEPTANCE_ENV = new Set([
    'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'HOME', 'TMPDIR', 'TEMP', 'TMP',
    'NODE_ENV', 'SILHOUETTE_INFERENCE_MODE', 'SILHOUETTE_CORS_ORIGIN', 'SILHOUETTE_BOOT_MODE', 'SILHOUETTE_PROVIDERS', 'SILHOUETTE_API_TOKEN', 'SILHOUETTE_API_KEY',
    'SILHOUETTE_DB_PATH', 'SILHOUETTE_LANCEDB_PATH', 'PORT', 'SILHOUETTE_HOST',
]);

// Only storage/runtime settings may enter an OFF process. Provider/channel keys,
// arbitrary custom env credentials and Brain relay credentials never enter it.
const LOCAL_STORE_ENV = new Set([...ACCEPTANCE_ENV,
    'SILHOUETTE_IDENTITY_DB_PATH', 'SILHOUETTE_TOOLS_DB_PATH',
    'NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD',
    'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD',
    'QDRANT_URL', 'QDRANT_API_KEY', 'SELF_WORKTREE_PATH', 'SELFDEV_DIR',
]);

export function loadRuntimeEnvironment(): void {
    if (externalProvidersDisabled()) {
        const allowed = acceptanceBoot() ? ACCEPTANCE_ENV : LOCAL_STORE_ENV;
        for (const key of Object.keys(process.env)) {
            if (!allowed.has(key)) delete process.env[key];
        }
        if (!acceptanceBoot()) {
            // Parse into a private object, not process.env: external keys are
            // never installed, even briefly, and the source files are not edited.
            for (const name of ['.env.local', '.env']) {
                try {
                    const values = dotenv.parse(fs.readFileSync(path.resolve(process.cwd(), name)));
                    for (const [key, value] of Object.entries(values)) {
                        if (allowed.has(key) && process.env[key] === undefined) process.env[key] = value;
                    }
                } catch (error: any) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
        }
        process.env.SILHOUETTE_HOST = '127.0.0.1';
        if (process.env.SILHOUETTE_INFERENCE_MODE === 'cloud-only') {
            console.info('[RUNTIME_POLICY] cloud-only preserved after provider-OFF environment scrub');
        }
        return;
    }
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

export function configForRuntime<T>(config: T): T {
    if (!externalProvidersDisabled()) return config;
    const safe: any = JSON.parse(JSON.stringify(config));
    safe.llm = { ...safe.llm, providers: {}, fallbackChain: [] };
    safe.media = { ...safe.media, elevenlabs: undefined,
        imageGeneration: { ...safe.media?.imageGeneration, apiKey: undefined } };
    safe.channels = {};
    if (acceptanceBoot()) {
        safe.memory = { ...safe.memory, neo4j: { uri: 'bolt://127.0.0.1:1', user: '', password: '' },
        redis: { host: '127.0.0.1', port: 1, password: undefined } };
    }
    safe.brain = { ...safe.brain, enabled: false, apiKey: undefined, mirrorMemory: false };
    safe.modules = acceptanceBoot() ? { graph: false, vectorDB: false, redis: false, browser: false } : { ...safe.modules, browser: false };
    if (acceptanceBoot()) {
        safe.scheduler = { ...safe.scheduler, enabled: false };
        safe.autonomy = { ...safe.autonomy, enabled: false, allowEvolution: false,
        enableNarrative: false, enableIntrospection: false };
    }
    return safe;
}

export function credentialConfigKey(key: string): boolean {
    return key === 'systemApiKey' || /^(secretsVault_|oauthConfig_)/.test(key)
        || /api.?key|access.?token|refresh.?token|client.?secret|credential/i.test(key);
}

// Scrub provider-OFF/acceptance env before the next dependency is evaluated. Normal mode
// keeps the original explicit dotenv load points and has no new import effect.
if (externalProvidersDisabled()) loadRuntimeEnvironment();
