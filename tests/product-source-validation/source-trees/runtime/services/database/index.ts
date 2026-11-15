// =============================================================================
// Database Module — Barrel Export
// Import { getDatabaseAdapter, getAdapter } from './services/database'
// =============================================================================

export type { IDatabaseAdapter, DbUser, DbDevice, DbSession, UserRole } from './databaseAdapter';
export { getDatabaseAdapter, getAdapter } from './adapterFactory';
