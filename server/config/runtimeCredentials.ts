/** Explicit, process-local acceptance boot. Never writes or rotates credentials.
 * This is credential-source isolation, NOT an OS/network sandbox. Run only in
 * a separate release with disposable data and an external egress restriction.
 */
import dotenv from 'dotenv';
import path from 'node:path';

import { acceptanceBoot } from '../../services/security/bootMode';
export { acceptanceBoot } from '../../services/security/bootMode';

// Deliberately an allowlist: a custom provider can use ANY env var as its key.
// Keep local API authentication, isolated storage paths and runtime essentials.
const ACCEPTANCE_ENV = new Set([
    'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'HOME', 'TMPDIR', 'TEMP', 'TMP',
    'NODE_ENV', 'SILHOUETTE_BOOT_MODE', 'SILHOUETTE_API_TOKEN',
    'SILHOUETTE_DB_PATH', 'SILHOUETTE_LANCEDB_PATH', 'PORT', 'SILHOUETTE_HOST',
]);

export function loadRuntimeEnvironment(): void {
    if (acceptanceBoot()) {
        for (const key of Object.keys(process.env)) {
            if (!ACCEPTANCE_ENV.has(key)) delete process.env[key];
        }
        // Accepting external clients is outside acceptance boot's purpose.
        process.env.SILHOUETTE_HOST = '127.0.0.1';
        return;
    }
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

export function configForRuntime<T>(config: T): T {
    if (!acceptanceBoot()) return config;
    const safe: any = JSON.parse(JSON.stringify(config));
    safe.llm = { ...safe.llm, providers: {}, fallbackChain: [] };
    safe.media = { ...safe.media, elevenlabs: undefined,
        imageGeneration: { ...safe.media?.imageGeneration, apiKey: undefined } };
    safe.channels = {};
    safe.memory = { ...safe.memory, neo4j: { uri: 'bolt://127.0.0.1:1', user: '', password: '' },
        redis: { host: '127.0.0.1', port: 1, password: undefined } };
    safe.brain = { ...safe.brain, enabled: false, apiKey: undefined, mirrorMemory: false };
    safe.modules = { graph: false, vectorDB: false, redis: false, browser: false };
    safe.scheduler = { ...safe.scheduler, enabled: false };
    safe.autonomy = { ...safe.autonomy, enabled: false, allowEvolution: false,
        enableNarrative: false, enableIntrospection: false };
    return safe;
}

export function credentialConfigKey(key: string): boolean {
    return key === 'systemApiKey' || /^(secretsVault_|oauthConfig_)/.test(key)
        || /api.?key|access.?token|refresh.?token|client.?secret|credential/i.test(key);
}

// Scrub acceptance env before the next dependency is evaluated. Normal mode
// keeps the original explicit dotenv load points and has no new import effect.
if (acceptanceBoot()) loadRuntimeEnvironment();
