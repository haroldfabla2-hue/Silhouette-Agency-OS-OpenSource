/**
 * Per-worker isolated SQLite databases for the test run.
 *
 * Root cause of the SQLITE_BUSY CI flake (run 38348547751, Node 22 leg):
 * every vitest worker shares process.cwd(), and the services opened
 * 'db/silhouette.sqlite' (and identity.sqlite / tools.db) by absolute default
 * path. Parallel workers serialized their writes onto the same file; under
 * load, one worker's `pragma('journal_mode = WAL')` at service construction
 * ran without any busy timeout in effect and failed instantly with
 * SQLITE_BUSY (observed via IntrospectionEngine.loadGoalsFromMemory).
 *
 * Cross-worker sharing was never a designed contract: vitest assigns test
 * files to workers arbitrarily, so no test can rely on rows written by a
 * file that may run in another worker. Giving each worker its own temp
 * database removes the contention class entirely instead of tuning timeouts.
 *
 * Production is untouched: without these env vars every service keeps its
 * default on-disk path.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

if (!process.env.SILHOUETTE_DB_PATH) {
    const worker = process.env.VITEST_WORKER_ID || `pid-${process.pid}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silhouette-test-db-'));
    process.env.SILHOUETTE_DB_PATH = path.join(dir, `worker-${worker}.sqlite`);
    process.env.SILHOUETTE_IDENTITY_DB_PATH = path.join(dir, `worker-${worker}-identity.sqlite`);
    process.env.SILHOUETTE_TOOLS_DB_PATH = path.join(dir, `worker-${worker}-tools.db`);
    process.on('exit', () => {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch { /* best-effort cleanup */ }
    });
}
