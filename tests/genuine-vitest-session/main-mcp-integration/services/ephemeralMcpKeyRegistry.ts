/** Explicit isolated custody. Never imported or selected by application boot.
 * No filename, DB object, existing directory, import value, env toggle or fallback.
 * Each call owns one newly created private in-memory SQLite database. */
import Database from 'better-sqlite3';
import { ApiKeyService, type ApiKey, type McpKeyRegistry } from './mcpKeyService';
export function createEphemeralMcpKeyService(): { service: ApiKeyService; dispose: () => void } {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE mcp_registry (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    db.prepare('INSERT INTO mcp_registry (id,value) VALUES (1,?)').run('[]');
    let closed = false;
    const live = () => { if (closed) throw new Error('Ephemeral MCP registry disposed'); };
    const registry: McpKeyRegistry = {
        read: () => { live(); return JSON.parse((db.prepare('SELECT value FROM mcp_registry WHERE id=1').get() as { value: string }).value); },
        write: (keys: ApiKey[]) => { live(); db.prepare('UPDATE mcp_registry SET value=? WHERE id=1').run(JSON.stringify(keys)); },
        transaction: <T>(body: () => T): T => { live(); return db.transaction(body)(); },
    };
    return { service: new ApiKeyService(registry), dispose: () => { if (!closed) { closed = true; db.close(); } } };
}
