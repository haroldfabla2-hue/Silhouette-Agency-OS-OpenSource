// Explicit opt-in only. Node helpers do not import/start application services.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const focal = new Set([
    'tests/automated/fase1-chat-gateway.test.ts',
    'tests/automated/system-routes-audit.test.ts',
    'tests/automated/consciousness-metrics.test.ts',
]);
const bindings = [
    'SILHOUETTE_DB_PATH', 'SILHOUETTE_LANCEDB_PATH',
    'SILHOUETTE_IDENTITY_DB_PATH', 'SILHOUETTE_TOOLS_DB_PATH',
    'SILHOUETTE_MEMORY_SNAPSHOT_PATH', 'SILHOUETTE_MEMORY_TRANSITIONS_DIR',
    'SILHOUETTE_CONTINUUM_REDIS_KEY', 'SILHOUETTE_TEST_MEMORY_ROOT',
];

export function prepareIndependentMemoryStore(testPath: string | undefined): void {
    const reject = (): never => { throw new Error('INDEPENDENT_MEMORY_SCOPE_INVALID'); };
    if (process.env.SILHOUETTE_TEST_MEMORY_MODE !== 'independent-three-focals') reject();
    if (!testPath || !focal.has(path.relative(process.cwd(), testPath).split(path.sep).join('/'))) reject();
    if (process.env.NODE_ENV !== 'test' || process.env.SILHOUETTE_INFERENCE_MODE !== 'cloud-only') reject();
    // Validate every caller binding before allocation or mutation. Even an empty
    // supplied value is caller configuration, never permission to overwrite it.
    if (bindings.some(key => Object.prototype.hasOwnProperty.call(process.env, key))) reject();
    const token = randomUUID();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silhouette-independent-memory-'));
    const values: Record<string, string> = {
        SILHOUETTE_DB_PATH: path.join(root, 'main.sqlite'),
        SILHOUETTE_LANCEDB_PATH: path.join(root, 'memory.lancedb'),
        SILHOUETTE_IDENTITY_DB_PATH: path.join(root, 'identity.sqlite'),
        SILHOUETTE_TOOLS_DB_PATH: path.join(root, 'tools.db'),
        SILHOUETTE_MEMORY_SNAPSHOT_PATH: path.join(root, 'memory_snapshot.json'),
        SILHOUETTE_MEMORY_TRANSITIONS_DIR: path.join(root, 'memory-transitions'),
        SILHOUETTE_CONTINUUM_REDIS_KEY: 'continuum:test-owner:' + token + ':volatile',
        SILHOUETTE_TEST_MEMORY_ROOT: root,
    };
    const published: string[] = [];
    const cleanup = (): void => {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort only at exit */ }
    };
    try {
        // Synchronous publication, no await/application import between bindings.
        // Roll back only this setup's writes/root if publication ever throws.
        process.once('exit', cleanup);
        for (const key of bindings) { process.env[key] = values[key]; published.push(key); }
    } catch (error) {
        for (const key of published) delete process.env[key];
        process.removeListener('exit', cleanup);
        cleanup();
        throw error;
    }
}
