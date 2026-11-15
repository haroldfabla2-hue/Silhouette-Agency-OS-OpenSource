-- 004: durable incident registry (R6 root fix).
-- Root: backend errors (Neo4j/Redis) went to console only, self-healing read
-- a log file that might not exist and declared "healthy", and the narrator
-- could not distinguish "source unavailable" from "zero incidents". One
-- durable registry now serves narrator, self-healing and UI, with open ->
-- resolved lifecycle so an outage and its recovery close the SAME incident.
CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,             -- neo4j | redis | continuum | narrator | self_healing | ...
    kind TEXT NOT NULL,               -- outage | error | perception_gap
    summary TEXT NOT NULL,
    detail TEXT,
    status TEXT NOT NULL DEFAULT 'open',   -- open | resolved
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, source);
CREATE INDEX IF NOT EXISTS idx_incidents_last_seen ON incidents(last_seen);
