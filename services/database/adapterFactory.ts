// =============================================================================
// Database Adapter Factory
// Auto-selects the appropriate adapter based on the DATABASE_URL env var.
// If DATABASE_URL is set → Postgres. Otherwise → embedded SQLite + LanceDB.
// =============================================================================

import { IDatabaseAdapter } from './databaseAdapter';

let _adapter: IDatabaseAdapter | null = null;

/**
 * Creates and returns the singleton database adapter.
 * Call this at application startup. Subsequent calls return the same instance.
 */
let initializing: Promise<IDatabaseAdapter> | null = null;
let closing = false;
let closingTask: Promise<void> | null = null;
const retainedCandidates = new Set<IDatabaseAdapter>();
const cleanupFailures: unknown[] = [];
export function getDatabaseAdapter(): Promise<IDatabaseAdapter> {
    if (closing) return Promise.reject(new Error('Database adapter factory closed'));
    if (_adapter) return Promise.resolve(_adapter);
    if (initializing) return initializing;
    initializing = (async () => {
        const candidate: IDatabaseAdapter = process.env.DATABASE_URL
            ? new (await import('./postgresAdapter')).PostgresAdapter(process.env.DATABASE_URL)
            : new (await import('./sqliteAdapter')).SqliteAdapter();
        retainedCandidates.add(candidate);
        try {
            await candidate.initialize();
            if (closing) throw new Error('Database adapter factory closed during initialization');
            _adapter = candidate;
            return candidate;
        } catch (error) {
            try { await candidate.close(); retainedCandidates.delete(candidate); }
            catch (cleanup) { cleanupFailures.push(cleanup); }
            // Preserve original work rejection; cleanup never asks callers to retry work.
            throw error;
        }
    })().finally(() => { initializing = null; });
    return initializing;
}
export function getAdapterCleanupFailures(): readonly unknown[] { return [...cleanupFailures]; }
export function closeDatabaseAdapter(): Promise<void> {
    if (closingTask) return closingTask;
    closing = true;
    closingTask = (async () => {
        if (initializing) await initializing.catch(() => undefined);
        for (const target of retainedCandidates) {
            try { await target.close(); retainedCandidates.delete(target); }
            catch (error) { cleanupFailures.push(error); }
        }
        if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Database adapter cleanup failed');
    })();
    return closingTask;
}

/**
 * Returns the current adapter instance (must be initialized first).
 * Throws if called before getDatabaseAdapter().
 */
export function getAdapter(): IDatabaseAdapter {
    if (closing || !_adapter) {
        throw new Error('[AdapterFactory] Database adapter not initialized. Call getDatabaseAdapter() first.');
    }
    return _adapter;
}
