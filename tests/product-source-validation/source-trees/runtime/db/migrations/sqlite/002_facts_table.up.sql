-- 002: typed fact repository table (R5 root fix).
-- SQLite is the durable source of truth for user facts; Neo4j and
-- ContinuumMemory become projections addressed by the same fact id.
CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    subject TEXT,
    attribute TEXT,
    value TEXT,
    source TEXT NOT NULL,          -- USER_STATED | USER_INFERRED | LEGACY
    quote TEXT,                    -- exact span of the owner's message backing the fact
    status TEXT NOT NULL,          -- verified | hypothesis
    confidence REAL NOT NULL DEFAULT 0.7,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    retracted_at INTEGER           -- set on retraction; row is never hard-deleted
);
CREATE INDEX IF NOT EXISTS idx_facts_owner ON facts(owner_id);
CREATE INDEX IF NOT EXISTS idx_facts_attribute ON facts(owner_id, attribute);
