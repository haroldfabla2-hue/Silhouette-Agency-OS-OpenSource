-- =============================================================================
-- Silhouette Agency OS — PostgreSQL + pgvector Initial Schema
-- This mirrors the complete SQLite schema with Postgres-native types.
-- Run: psql $DATABASE_URL -f migrations/001_initial_schema.sql
-- =============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Relational Tables ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT,
    status TEXT,
    data JSONB NOT NULL,
    last_active BIGINT
);

CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    level TEXT,
    message TEXT,
    source TEXT,
    timestamp BIGINT,
    details JSONB
);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp DESC);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    description TEXT,
    assigned_to TEXT,
    status TEXT,
    created_at BIGINT,
    updated_at BIGINT,
    data JSONB
);

CREATE TABLE IF NOT EXISTS cost_metrics (
    id TEXT PRIMARY KEY,
    data JSONB,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at BIGINT,
    last_updated BIGINT,
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS chat_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT,
    content TEXT,
    timestamp BIGINT,
    metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_logs(timestamp DESC);

-- Ensure default session
INSERT INTO chat_sessions (id, title, created_at, last_updated)
VALUES ('default', 'General System Chat', EXTRACT(EPOCH FROM NOW()) * 1000, EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ui_state (
    component_id TEXT PRIMARY KEY,
    state JSONB,
    last_updated BIGINT
);

CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    file_path TEXT NOT NULL,
    thumbnail_path TEXT,
    size_bytes BIGINT,
    mime_type TEXT,
    prompt TEXT,
    provider TEXT,
    tags JSONB,
    metadata JSONB,
    folder TEXT DEFAULT '/',
    is_favorite BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    updated_at BIGINT,
    accessed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder);
CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC);

CREATE TABLE IF NOT EXISTS discovery_journal (
    id TEXT PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    source_node TEXT NOT NULL,
    target_node TEXT NOT NULL,
    decision TEXT NOT NULL,
    confidence REAL,
    feedback TEXT,
    refinement_hint TEXT,
    relation_type TEXT,
    retry_count INTEGER DEFAULT 0,
    final_outcome TEXT,
    discovery_source TEXT,
    metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_discovery_timestamp ON discovery_journal(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_decision ON discovery_journal(decision);
CREATE INDEX IF NOT EXISTS idx_discovery_pair ON discovery_journal(source_node, target_node);

CREATE TABLE IF NOT EXISTS synthesized_insights (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    discoveries JSONB,
    patterns JSONB,
    novel_hypothesis TEXT,
    supporting_evidence JSONB,
    confidence REAL,
    domain TEXT,
    created_at BIGINT NOT NULL,
    paper_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_insights_created ON synthesized_insights(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_domain ON synthesized_insights(domain);
CREATE INDEX IF NOT EXISTS idx_insights_confidence ON synthesized_insights(confidence DESC);

CREATE TABLE IF NOT EXISTS generated_papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authors JSONB,
    abstract TEXT,
    sections JSONB,
    paper_references JSONB,
    keywords JSONB,
    insight_id TEXT,
    format TEXT DEFAULT 'markdown',
    status TEXT DEFAULT 'draft',
    peer_review_score REAL,
    peer_review_feedback TEXT,
    file_path TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_papers_created ON generated_papers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_status ON generated_papers(status);
CREATE INDEX IF NOT EXISTS idx_papers_insight ON generated_papers(insight_id);

CREATE TABLE IF NOT EXISTS evolution_history (
    id SERIAL PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    previous_score REAL,
    new_score REAL,
    trigger_type TEXT NOT NULL,
    triggered_by TEXT,
    improvements JSONB,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
);
CREATE INDEX IF NOT EXISTS idx_evolution_agent ON evolution_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_evolution_date ON evolution_history(created_at DESC);

CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    language TEXT NOT NULL,
    gender TEXT,
    style TEXT,
    sample_path TEXT,
    thumbnail_url TEXT,
    source_url TEXT,
    is_downloaded BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    quality_score INTEGER,
    usage_count INTEGER DEFAULT 0,
    last_used_at BIGINT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_voices_category ON voices(category);
CREATE INDEX IF NOT EXISTS idx_voices_language ON voices(language);
CREATE INDEX IF NOT EXISTS idx_voices_default ON voices(is_default);

CREATE TABLE IF NOT EXISTS voice_clone_sessions (
    id TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
    input_path TEXT NOT NULL,
    input_duration REAL,
    input_quality INTEGER,
    noise_level TEXT,
    silence_ratio REAL,
    was_normalized BOOLEAN DEFAULT FALSE,
    was_denoised BOOLEAN DEFAULT FALSE,
    processed_path TEXT,
    processing_time REAL,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clone_sessions_voice ON voice_clone_sessions(voice_id);
CREATE INDEX IF NOT EXISTS idx_clone_sessions_status ON voice_clone_sessions(status);

-- ─── Vector Tables (pgvector + HNSW) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_vectors (
    id TEXT PRIMARY KEY,
    content TEXT,
    tier TEXT,
    importance REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    tags JSONB,
    metadata JSONB,
    source TEXT,
    category TEXT,
    created_at BIGINT,
    last_accessed BIGINT,
    embedding vector(768)
);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_embedding
    ON memory_vectors USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_tier ON memory_vectors(tier);

CREATE TABLE IF NOT EXISTS knowledge_vectors (
    id TEXT PRIMARY KEY,
    content TEXT,
    source TEXT,
    category TEXT,
    tags JSONB,
    metadata JSONB,
    created_at BIGINT,
    embedding vector(768)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding
    ON knowledge_vectors USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ─── Identity Tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'USER',
    google_linked BOOLEAN DEFAULT FALSE,
    google_email TEXT,
    telegram_id TEXT,
    discord_id TEXT,
    whatsapp_id TEXT,
    created_at BIGINT NOT NULL,
    last_login BIGINT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_email);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    fingerprint TEXT NOT NULL,
    name TEXT NOT NULL,
    trusted BOOLEAN DEFAULT TRUE,
    last_seen BIGINT,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices(fingerprint);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ─── Migration Tracking ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_migrations (
    id SERIAL PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    executed_at BIGINT NOT NULL
);

-- Mark this migration as applied
INSERT INTO system_migrations (version, filename, executed_at)
VALUES ('001', '001_initial_schema.sql', EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (version) DO NOTHING;
