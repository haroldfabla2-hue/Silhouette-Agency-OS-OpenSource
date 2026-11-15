-- 003: durable per-user profiles (R4 root fix).
-- Root: the profile was a singleton ('user_primary') kept in RAM + a global
-- Redis key with a Neo4j projection; the Redis fallback loses data on
-- restart and every request shared one identity. SQLite becomes the durable
-- source, keyed by user id; Redis is a per-user hot cache; Neo4j a projection.
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    name TEXT,
    preferred_language TEXT NOT NULL DEFAULT 'auto',
    preferences TEXT NOT NULL DEFAULT '{}',   -- JSON
    facts TEXT NOT NULL DEFAULT '[]',          -- JSON array of user-stated facts
    extracted_at INTEGER NOT NULL DEFAULT 0,
    last_interaction INTEGER NOT NULL DEFAULT 0
);
