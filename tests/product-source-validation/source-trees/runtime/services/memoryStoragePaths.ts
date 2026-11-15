// Optional bindings captured once at startup. No application imports/autostart.
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createHash } from 'node:crypto';

export const MEMORY_SNAPSHOT_PATH = process.env.SILHOUETTE_MEMORY_SNAPSHOT_PATH
    ? path.resolve(process.env.SILHOUETTE_MEMORY_SNAPSHOT_PATH)
    : path.join(process.cwd(), 'data', 'memory_snapshot.json');
// Only an explicit optional override is captured at import. The historical
// unset default remains evaluated at each MemoryTransitions construction.
export const MEMORY_TRANSITIONS_DIR_OVERRIDE = process.env.SILHOUETTE_MEMORY_TRANSITIONS_DIR
    ? path.resolve(process.env.SILHOUETTE_MEMORY_TRANSITIONS_DIR) : undefined;
export const CONTINUUM_REDIS_KEY = process.env.SILHOUETTE_CONTINUUM_REDIS_KEY || 'continuum:volatile';

// Labels disclose no actual root/token/key. Verify every memory binding and a
// real disposable directory. UNKNOWN is honest when verification is incomplete.
function snapshotDiagnosticBinding(): { storeLabel: string; ownerModel: string; scopeDigest: string } {
    const root = process.env.SILHOUETTE_TEST_MEMORY_ROOT;
    if (process.env.SILHOUETTE_TEST_MEMORY_MODE === 'independent-three-focals' && root) {
        try {
            const temporary = fs.realpathSync(os.tmpdir());
            const stat = fs.lstatSync(root);
            const actual = fs.realpathSync(root);
            const coherent = stat.isDirectory() && !stat.isSymbolicLink()
                && actual === root && path.dirname(actual) === temporary
                && /^silhouette-independent-memory-[A-Za-z0-9]+$/.test(path.basename(root))
                && process.env.NODE_ENV === 'test'
                && process.env.SILHOUETTE_DB_PATH === path.join(root, 'main.sqlite')
                && process.env.SILHOUETTE_LANCEDB_PATH === path.join(root, 'memory.lancedb')
                && process.env.SILHOUETTE_IDENTITY_DB_PATH === path.join(root, 'identity.sqlite')
                && process.env.SILHOUETTE_TOOLS_DB_PATH === path.join(root, 'tools.db')
                && MEMORY_SNAPSHOT_PATH === path.join(root, 'memory_snapshot.json')
                && MEMORY_TRANSITIONS_DIR_OVERRIDE === path.join(root, 'memory-transitions')
                && /^continuum:test-owner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:volatile$/.test(CONTINUUM_REDIS_KEY);
            if (coherent) {
                // High-entropy disposable token is included via the scoped key.
                // Publish only a fixed-size digest, never any original binding.
                const scopeDigest = createHash('sha256').update(JSON.stringify([
                    'independent-memory-scope-v1', root, process.env.SILHOUETTE_DB_PATH,
                    process.env.SILHOUETTE_LANCEDB_PATH, process.env.SILHOUETTE_IDENTITY_DB_PATH,
                    process.env.SILHOUETTE_TOOLS_DB_PATH, MEMORY_SNAPSHOT_PATH,
                    MEMORY_TRANSITIONS_DIR_OVERRIDE, CONTINUUM_REDIS_KEY,
                ])).digest('hex');
                return { storeLabel: 'disposable-test-owner/memory_snapshot.json',
                    ownerModel: 'INDEPENDENT_TEST_SCOPE_BOUND', scopeDigest };
            }
        } catch { /* Unverified is not a reason to disclose private paths. */ }
        return { storeLabel: 'UNKNOWN', ownerModel: 'UNKNOWN', scopeDigest: 'UNKNOWN' };
    }
    return MEMORY_SNAPSHOT_PATH === '/tmp/work/data/memory_snapshot.json'
        ? { storeLabel: 'shared-work/data/memory_snapshot.json', ownerModel: 'UNRESOLVED_SHARED_PATH_TEST', scopeDigest: 'UNKNOWN' }
        : { storeLabel: 'UNKNOWN', ownerModel: 'UNKNOWN', scopeDigest: 'UNKNOWN' };
}
export const SNAPSHOT_DIAGNOSTIC_BINDING = snapshotDiagnosticBinding();
