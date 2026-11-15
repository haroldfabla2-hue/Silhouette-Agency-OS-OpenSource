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
export async function getDatabaseAdapter(): Promise<IDatabaseAdapter> {
    if (_adapter) return _adapter;

    if (process.env.DATABASE_URL) {
        // Postgres mode — dynamic import to avoid loading pg when not needed
        const { PostgresAdapter } = await import('./postgresAdapter');
        _adapter = new PostgresAdapter(process.env.DATABASE_URL);
    } else {
        // Embedded mode — SQLite + LanceDB (default, zero-config)
        const { SqliteAdapter } = await import('./sqliteAdapter');
        _adapter = new SqliteAdapter();
    }

    await _adapter.initialize();
    return _adapter;
}

/**
 * Returns the current adapter instance (must be initialized first).
 * Throws if called before getDatabaseAdapter().
 */
export function getAdapter(): IDatabaseAdapter {
    if (!_adapter) {
        throw new Error('[AdapterFactory] Database adapter not initialized. Call getDatabaseAdapter() first.');
    }
    return _adapter;
}
