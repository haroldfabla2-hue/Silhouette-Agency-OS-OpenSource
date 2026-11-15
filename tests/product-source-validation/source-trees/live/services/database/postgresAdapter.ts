// =============================================================================
// PostgreSQL + pgvector Adapter
// Enterprise-grade implementation of IDatabaseAdapter using connection pooling
// and pgvector for HNSW-indexed vector similarity search.
// Activated when DATABASE_URL is set in the environment.
// =============================================================================

import { Pool, PoolClient } from 'pg';
import { IDatabaseAdapter, DbUser, DbDevice, DbSession, UserRole } from './databaseAdapter';
import { Agent, MemoryNode, MemoryTier } from '../../types';

const DEFAULT_VECTOR_DIM = 768;

export class PostgresAdapter implements IDatabaseAdapter {
    private pool: Pool;

    constructor(connectionString: string) {
        this.pool = new Pool({
            connectionString,
            max: 20,                    // Max connections in pool
            idleTimeoutMillis: 30000,   // Close idle connections after 30s
            connectionTimeoutMillis: 5000
        });

        // Log pool errors instead of crashing
        this.pool.on('error', (err) => {
            console.error('[PostgresAdapter] Unexpected pool error:', err.message);
        });
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────

    async initialize(): Promise<void> {
        const client = await this.pool.connect();
        try {
            // Enable pgvector extension
            await client.query('CREATE EXTENSION IF NOT EXISTS vector');

            // ── Relational Tables ──────────────────────────────────────

            await client.query(`
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    role TEXT,
                    status TEXT,
                    data JSONB NOT NULL,
                    last_active BIGINT
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS system_logs (
                    id SERIAL PRIMARY KEY,
                    level TEXT,
                    message TEXT,
                    source TEXT,
                    timestamp BIGINT,
                    details JSONB
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp DESC)`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS cost_metrics (
                    id TEXT PRIMARY KEY,
                    data JSONB,
                    updated_at BIGINT
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS system_config (
                    key TEXT PRIMARY KEY,
                    value JSONB,
                    updated_at BIGINT
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    created_at BIGINT,
                    last_updated BIGINT,
                    metadata JSONB
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS chat_logs (
                    id TEXT PRIMARY KEY,
                    session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
                    role TEXT,
                    content TEXT,
                    timestamp BIGINT,
                    metadata JSONB
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_logs(session_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_logs(timestamp DESC)`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS ui_state (
                    component_id TEXT PRIMARY KEY,
                    state JSONB,
                    last_updated BIGINT
                )
            `);

            await client.query(`
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
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_evolution_agent ON evolution_history(agent_id)`);

            // Tasks table (Workflow Engine)
            await client.query(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    description TEXT,
                    assigned_to TEXT,
                    status TEXT,
                    created_at BIGINT,
                    updated_at BIGINT,
                    data JSONB
                )
            `);

            // Assets table (Unified Asset Catalog)
            await client.query(`
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
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC)`);

            // Discovery Journal table (Persistent Discovery Memory)
            await client.query(`
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
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_discovery_timestamp ON discovery_journal(timestamp DESC)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_discovery_decision ON discovery_journal(decision)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_discovery_pair ON discovery_journal(source_node, target_node)`);

            // Synthesized Insights table
            await client.query(`
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
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_insights_created ON synthesized_insights(created_at DESC)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_insights_domain ON synthesized_insights(domain)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_insights_confidence ON synthesized_insights(confidence DESC)`);

            // Generated Papers table
            await client.query(`
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
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_papers_created ON generated_papers(created_at DESC)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_papers_status ON generated_papers(status)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_papers_insight ON generated_papers(insight_id)`);

            await client.query(`
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
                )
            `);

            await client.query(`
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
                )
            `);

            // ── Vector Tables (pgvector) ───────────────────────────────

            await client.query(`
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
                    embedding vector(${DEFAULT_VECTOR_DIM})
                )
            `);
            // HNSW index for fast cosine similarity search
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_memory_vectors_embedding 
                ON memory_vectors USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64)
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_vectors_tier ON memory_vectors(tier)`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS knowledge_vectors (
                    id TEXT PRIMARY KEY,
                    content TEXT,
                    source TEXT,
                    category TEXT,
                    tags JSONB,
                    metadata JSONB,
                    created_at BIGINT,
                    embedding vector(${DEFAULT_VECTOR_DIM})
                )
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding 
                ON knowledge_vectors USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64)
            `);

            // ── Identity Tables ────────────────────────────────────────

            await client.query(`
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
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_email)`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS devices (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    fingerprint TEXT NOT NULL,
                    name TEXT NOT NULL,
                    trusted BOOLEAN DEFAULT TRUE,
                    last_seen BIGINT,
                    created_at BIGINT NOT NULL
                )
            `);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices(fingerprint)`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    device_id TEXT NOT NULL REFERENCES devices(id),
                    expires_at BIGINT NOT NULL,
                    created_at BIGINT NOT NULL
                )
            `);

            // Ensure default session exists
            await client.query(`
                INSERT INTO chat_sessions (id, title, created_at, last_updated)
                VALUES ('default', 'General System Chat', $1, $1)
                ON CONFLICT (id) DO NOTHING
            `, [Date.now()]);

            // System migrations tracking
            await client.query(`
                CREATE TABLE IF NOT EXISTS system_migrations (
                    id SERIAL PRIMARY KEY,
                    version TEXT NOT NULL UNIQUE,
                    filename TEXT NOT NULL,
                    executed_at BIGINT NOT NULL
                )
            `);

            console.log('[PostgresAdapter] Schema initialized successfully');
        } finally {
            client.release();
        }
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    // ─── Helper ────────────────────────────────────────────────────────

    private formatVector(v: number[]): string {
        // pgvector expects '[1,2,3]' format
        return `[${v.join(',')}]`;
    }

    private padVector(v: number[], dim: number = DEFAULT_VECTOR_DIM): number[] {
        if (v.length === dim) return v;
        if (v.length > dim) return v.slice(0, dim);
        return [...v, ...new Array(dim - v.length).fill(0)];
    }

    // ─── Agent Operations ──────────────────────────────────────────────

    async upsertAgent(agent: Agent): Promise<void> {
        await this.pool.query(`
            INSERT INTO agents (id, name, role, status, data, last_active)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name, role = EXCLUDED.role, status = EXCLUDED.status,
                data = EXCLUDED.data, last_active = EXCLUDED.last_active
        `, [agent.id, agent.name, agent.role, agent.status, JSON.stringify(agent), agent.lastActive]);
    }

    async getAgent(id: string): Promise<Agent | null> {
        const { rows } = await this.pool.query('SELECT data FROM agents WHERE id = $1', [id]);
        if (rows.length === 0) return null;
        return typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    }

    async getAllAgents(): Promise<Agent[]> {
        const { rows } = await this.pool.query('SELECT data FROM agents');
        return rows.map(r => typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
    }

    async deleteAgent(id: string): Promise<void> {
        await this.pool.query('DELETE FROM agents WHERE id = $1', [id]);
    }

    async getInactiveAgents(thresholdTimestamp: number): Promise<Agent[]> {
        const { rows } = await this.pool.query(
            'SELECT data FROM agents WHERE last_active < $1 AND status != $2',
            [thresholdTimestamp, 'SLEEPING']
        );
        return rows.map(r => typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
    }

    // ─── Log Operations ────────────────────────────────────────────────

    async log(level: string, message: string, source: string, details?: any): Promise<void> {
        await this.pool.query(
            'INSERT INTO system_logs (level, message, source, timestamp, details) VALUES ($1, $2, $3, $4, $5)',
            [level, message, source, Date.now(), details ? JSON.stringify(details) : null]
        );
    }

    async getLogs(limit: number = 100): Promise<any[]> {
        const { rows } = await this.pool.query(
            'SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT $1', [limit]
        );
        return rows.map(r => ({ ...r, details: r.details || null }));
    }

    async getRecentLogs(level: string, minutes: number): Promise<any[]> {
        const threshold = Date.now() - (minutes * 60 * 1000);
        const { rows } = await this.pool.query(
            'SELECT * FROM system_logs WHERE level = $1 AND timestamp > $2', [level, threshold]
        );
        return rows.map(r => ({ ...r, details: r.details || null }));
    }

    // ─── Cost Metrics ──────────────────────────────────────────────────

    async saveCostMetrics(metrics: any): Promise<void> {
        await this.pool.query(`
            INSERT INTO cost_metrics (id, data, updated_at) VALUES ('global', $1, $2)
            ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
        `, [JSON.stringify(metrics), Date.now()]);
    }

    async getCostMetrics(): Promise<any | null> {
        const { rows } = await this.pool.query("SELECT data FROM cost_metrics WHERE id = 'global'");
        if (rows.length === 0) return null;
        return typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    }

    // ─── System Config ─────────────────────────────────────────────────

    async setConfig(key: string, value: any): Promise<void> {
        await this.pool.query(`
            INSERT INTO system_config (key, value, updated_at) VALUES ($1, $2, $3)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `, [key, JSON.stringify(value), Date.now()]);
    }

    async getConfig(key: string): Promise<any | null> {
        const { rows } = await this.pool.query('SELECT value FROM system_config WHERE key = $1', [key]);
        if (rows.length === 0) return null;
        return typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    }

    async getAllConfig(): Promise<Record<string, any>> {
        const { rows } = await this.pool.query('SELECT key, value FROM system_config');
        const config: Record<string, any> = {};
        rows.forEach(r => {
            config[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        });
        return config;
    }

    // ─── Chat Operations ───────────────────────────────────────────────

    async appendChatMessage(msg: any, sessionId: string = 'default'): Promise<void> {
        const id = msg.id || require('crypto').randomUUID();

        // Ensure session exists first to satisfy foreign key constraints
        await this.pool.query(`
            INSERT INTO chat_sessions (id, title, created_at, last_updated) VALUES ($1, 'New Session', $2, $2)
            ON CONFLICT (id) DO UPDATE SET last_updated = EXCLUDED.last_updated
        `, [sessionId, Date.now()]);

        await this.pool.query(
            'INSERT INTO chat_logs (id, session_id, role, content, timestamp, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, sessionId, msg.role, msg.content, msg.timestamp || Date.now(), JSON.stringify(msg.metadata || {})]
        );
    }

    async getChatSessions(): Promise<any[]> {
        const { rows } = await this.pool.query(`
            SELECT s.id, s.title, s.created_at, s.last_updated,
                   (SELECT content FROM chat_logs WHERE session_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_message
            FROM chat_sessions s ORDER BY s.last_updated DESC
        `);
        return rows.map(r => ({
            id: r.id, title: r.title || 'Untitled Session',
            createdAt: r.created_at, lastUpdated: r.last_updated,
            preview: r.last_message ? r.last_message.substring(0, 50) : 'No messages yet',
            messages: []
        }));
    }

    async createChatSession(title: string): Promise<any> {
        const id = require('crypto').randomUUID();
        const now = Date.now();
        await this.pool.query(
            'INSERT INTO chat_sessions (id, title, created_at, last_updated) VALUES ($1, $2, $3, $3)',
            [id, title, now]
        );
        return { id, title, createdAt: now, lastUpdated: now, messages: [] };
    }

    async deleteChatSession(id: string): Promise<void> {
        // CASCADE handles chat_logs deletion
        await this.pool.query('DELETE FROM chat_sessions WHERE id = $1', [id]);
    }

    async getChatHistory(sessionId: string = 'default', limit: number = 100): Promise<any[]> {
        const { rows } = await this.pool.query(
            'SELECT * FROM chat_logs WHERE session_id = $1 ORDER BY timestamp ASC',
            [sessionId]
        );
        return rows.map(r => ({
            id: r.id, role: r.role === 'assistant' ? 'agent' : r.role,
            text: r.content, content: r.content, timestamp: r.timestamp,
            thoughts: r.metadata?.thoughts
        }));
    }

    async searchChatHistory(query: string, limit: number = 30): Promise<any[]> {
        if (!query || query.length < 3) return [];
        // Postgres full-text search with ts_rank
        const { rows } = await this.pool.query(`
            SELECT id, session_id, role, content, timestamp,
                   ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) as relevance_score
            FROM chat_logs
            WHERE content ILIKE $2
            ORDER BY relevance_score DESC, timestamp DESC
            LIMIT $3
        `, [query, `%${query}%`, limit]);
        return rows.map(r => ({
            id: r.id, sessionId: r.session_id, role: r.role,
            content: r.content, timestamp: r.timestamp,
            relevanceScore: parseFloat(r.relevance_score) || 0.5
        }));
    }

    // ─── UI State ──────────────────────────────────────────────────────

    async saveUiState(componentId: string, state: any): Promise<void> {
        await this.pool.query(`
            INSERT INTO ui_state (component_id, state, last_updated) VALUES ($1, $2, $3)
            ON CONFLICT (component_id) DO UPDATE SET state = EXCLUDED.state, last_updated = EXCLUDED.last_updated
        `, [componentId, JSON.stringify(state), Date.now()]);
    }

    async getUiState(componentId: string): Promise<any | null> {
        const { rows } = await this.pool.query('SELECT state FROM ui_state WHERE component_id = $1', [componentId]);
        if (rows.length === 0) return null;
        return typeof rows[0].state === 'string' ? JSON.parse(rows[0].state) : rows[0].state;
    }

    // ─── Evolution History ─────────────────────────────────────────────

    async logEvolution(data: any): Promise<void> {
        await this.pool.query(`
            INSERT INTO evolution_history (agent_id, agent_name, previous_score, new_score, trigger_type, triggered_by, improvements, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [data.agentId, data.agentName, data.previousScore ?? null, data.newScore ?? null,
        data.triggerType, data.triggeredBy || 'SYSTEM', JSON.stringify(data.improvements || []), Date.now()]);
    }

    async getEvolutionHistory(agentId?: string, limit: number = 50): Promise<any[]> {
        let query: string;
        let params: any[];
        if (agentId) {
            query = 'SELECT * FROM evolution_history WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2';
            params = [agentId, limit];
        } else {
            query = 'SELECT * FROM evolution_history ORDER BY created_at DESC LIMIT $1';
            params = [limit];
        }
        const { rows } = await this.pool.query(query, params);
        return rows.map(r => ({ ...r, improvements: r.improvements || [] }));
    }

    // ─── Voice Operations ──────────────────────────────────────────────

    async upsertVoice(voice: any): Promise<void> {
        await this.pool.query(`
            INSERT INTO voices (id, name, category, language, gender, style, sample_path, thumbnail_url, source_url, is_downloaded, is_default, quality_score, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
            ON CONFLICT (id) DO UPDATE SET
                name=EXCLUDED.name, category=EXCLUDED.category, language=EXCLUDED.language,
                gender=EXCLUDED.gender, style=EXCLUDED.style, sample_path=EXCLUDED.sample_path,
                thumbnail_url=EXCLUDED.thumbnail_url, source_url=EXCLUDED.source_url,
                is_downloaded=EXCLUDED.is_downloaded, is_default=EXCLUDED.is_default,
                quality_score=EXCLUDED.quality_score, updated_at=EXCLUDED.updated_at
        `, [voice.id, voice.name, voice.category, voice.language, voice.gender || null,
        voice.style || null, voice.samplePath || null, voice.thumbnailUrl || null,
        voice.sourceUrl || null, !!voice.isDownloaded, !!voice.isDefault,
        voice.qualityScore || null, Date.now()]);
    }

    private mapVoiceRow(row: any): any {
        return {
            id: row.id, name: row.name, category: row.category, language: row.language,
            gender: row.gender, style: row.style, samplePath: row.sample_path,
            thumbnailUrl: row.thumbnail_url, sourceUrl: row.source_url,
            isDownloaded: row.is_downloaded, isDefault: row.is_default,
            qualityScore: row.quality_score, usageCount: row.usage_count,
            lastUsedAt: row.last_used_at, createdAt: row.created_at, updatedAt: row.updated_at
        };
    }

    async getVoice(id: string): Promise<any | null> {
        const { rows } = await this.pool.query('SELECT * FROM voices WHERE id = $1', [id]);
        return rows.length > 0 ? this.mapVoiceRow(rows[0]) : null;
    }

    async getAllVoices(): Promise<any[]> {
        const { rows } = await this.pool.query('SELECT * FROM voices ORDER BY created_at DESC');
        return rows.map(r => this.mapVoiceRow(r));
    }

    async getVoicesByCategory(category: string): Promise<any[]> {
        const { rows } = await this.pool.query('SELECT * FROM voices WHERE category = $1 ORDER BY name', [category]);
        return rows.map(r => this.mapVoiceRow(r));
    }

    async getDefaultVoice(): Promise<any | null> {
        const { rows } = await this.pool.query('SELECT * FROM voices WHERE is_default = TRUE LIMIT 1');
        return rows.length > 0 ? this.mapVoiceRow(rows[0]) : null;
    }

    async setDefaultVoice(id: string): Promise<void> {
        await this.pool.query('UPDATE voices SET is_default = FALSE WHERE is_default = TRUE');
        await this.pool.query('UPDATE voices SET is_default = TRUE WHERE id = $1', [id]);
    }

    async deleteVoice(id: string): Promise<void> {
        await this.pool.query('DELETE FROM voice_clone_sessions WHERE voice_id = $1', [id]);
        await this.pool.query('DELETE FROM voices WHERE id = $1', [id]);
    }

    async incrementVoiceUsage(id: string): Promise<void> {
        await this.pool.query('UPDATE voices SET usage_count = usage_count + 1, last_used_at = $1 WHERE id = $2', [Date.now(), id]);
    }

    async createCloneSession(session: any): Promise<void> {
        await this.pool.query(`
            INSERT INTO voice_clone_sessions (id, voice_id, input_path, input_duration, input_quality, noise_level, silence_ratio, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [session.id, session.voiceId, session.inputPath, session.inputDuration || null,
        session.inputQuality || null, session.noiseLevel || null, session.silenceRatio || null, Date.now()]);
    }

    async updateCloneSession(id: string, updates: any): Promise<void> {
        const fields: string[] = [];
        const values: any[] = [];
        let paramIdx = 1;

        if (updates.status !== undefined) { fields.push(`status = $${paramIdx++}`); values.push(updates.status); }
        if (updates.processedPath !== undefined) { fields.push(`processed_path = $${paramIdx++}`); values.push(updates.processedPath); }
        if (updates.processingTime !== undefined) { fields.push(`processing_time = $${paramIdx++}`); values.push(updates.processingTime); }
        if (updates.wasNormalized !== undefined) { fields.push(`was_normalized = $${paramIdx++}`); values.push(!!updates.wasNormalized); }
        if (updates.wasDenoised !== undefined) { fields.push(`was_denoised = $${paramIdx++}`); values.push(!!updates.wasDenoised); }
        if (updates.errorMessage !== undefined) { fields.push(`error_message = $${paramIdx++}`); values.push(updates.errorMessage); }

        if (fields.length > 0) {
            values.push(id);
            await this.pool.query(`UPDATE voice_clone_sessions SET ${fields.join(', ')} WHERE id = $${paramIdx}`, values);
        }
    }

    async getCloneSession(id: string): Promise<any | null> {
        const { rows } = await this.pool.query('SELECT * FROM voice_clone_sessions WHERE id = $1', [id]);
        return rows.length > 0 ? rows[0] : null;
    }

    async getCloneSessionsForVoice(voiceId: string): Promise<any[]> {
        const { rows } = await this.pool.query('SELECT * FROM voice_clone_sessions WHERE voice_id = $1 ORDER BY created_at DESC', [voiceId]);
        return rows;
    }

    // ─── Vector Memory Operations (pgvector) ───────────────────────────

    async storeVector(node: MemoryNode, vector?: number[]): Promise<void> {
        const embedding = vector ? this.padVector(vector) : new Array(DEFAULT_VECTOR_DIM).fill(0);
        const nodeAny = node as any;
        await this.pool.query(`
            INSERT INTO memory_vectors (id, content, tier, importance, access_count, tags, metadata, source, category, created_at, last_accessed, embedding)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)
            ON CONFLICT (id) DO UPDATE SET
                content = EXCLUDED.content, tier = EXCLUDED.tier, importance = EXCLUDED.importance,
                tags = EXCLUDED.tags, metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding
        `, [
            node.id, node.content, node.tier, node.importance || 0.5, node.accessCount || 0,
            JSON.stringify(node.tags || []), JSON.stringify(nodeAny.metadata || {}),
            nodeAny.source || '', nodeAny.category || '',
            node.timestamp || Date.now(), node.lastAccess || Date.now(),
            this.formatVector(embedding)
        ]);
    }

    async searchVectors(queryVector: number[], limit: number = 10, filter?: string): Promise<MemoryNode[]> {
        const padded = this.padVector(queryVector);
        let query = `
            SELECT *, 1 - (embedding <=> $1::vector) as similarity
            FROM memory_vectors
        `;
        const params: any[] = [this.formatVector(padded)];

        if (filter) {
            query += ` WHERE ${filter}`;
        }
        query += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
        params.push(limit);

        const { rows } = await this.pool.query(query, params);
        return rows.map(r => this.rowToMemoryNode(r));
    }

    async findSimilarNodes(nodeId: string, limit: number = 5): Promise<(MemoryNode & { similarity?: number })[]> {
        const { rows: nodeRows } = await this.pool.query('SELECT embedding FROM memory_vectors WHERE id = $1', [nodeId]);
        if (nodeRows.length === 0) return [];

        const { rows } = await this.pool.query(`
            SELECT *, 1 - (embedding <=> $1::vector) as similarity
            FROM memory_vectors
            WHERE id != $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3
        `, [nodeRows[0].embedding, nodeId, limit]);

        return rows.map(r => ({ ...this.rowToMemoryNode(r), similarity: parseFloat(r.similarity) }));
    }

    async searchByContent(textQuery: string, limit: number = 20): Promise<MemoryNode[]> {
        const { rows } = await this.pool.query(
            'SELECT * FROM memory_vectors WHERE content ILIKE $1 ORDER BY created_at DESC LIMIT $2',
            [`%${textQuery}%`, limit]
        );
        return rows.map(r => this.rowToMemoryNode(r));
    }

    async getAllNodes(): Promise<MemoryNode[]> {
        const { rows } = await this.pool.query('SELECT * FROM memory_vectors');
        return rows.map(r => this.rowToMemoryNode(r));
    }

    async getNodesByTier(tier: MemoryTier, limit: number = 1000): Promise<MemoryNode[]> {
        const { rows } = await this.pool.query(
            'SELECT * FROM memory_vectors WHERE tier = $1 LIMIT $2',
            [tier, limit]
        );
        return rows.map(r => this.rowToMemoryNode(r));
    }

    async deleteNode(id: string): Promise<boolean> {
        const result = await this.pool.query('DELETE FROM memory_vectors WHERE id = $1', [id]);
        return (result.rowCount || 0) > 0;
    }

    private rowToMemoryNode(row: any): MemoryNode {
        return {
            id: row.id,
            content: row.content,
            timestamp: row.created_at,
            tier: row.tier as MemoryTier,
            importance: row.importance,
            accessCount: row.access_count,
            tags: row.tags || [],
            lastAccess: row.last_accessed
        };
    }

    // ─── Knowledge Indexing ────────────────────────────────────────────

    async storeKnowledge(item: any): Promise<void> {
        const embedding = item.vector ? this.padVector(item.vector) : new Array(DEFAULT_VECTOR_DIM).fill(0);
        const id = item.id || require('crypto').randomUUID();
        await this.pool.query(`
            INSERT INTO knowledge_vectors (id, content, source, category, tags, metadata, created_at, embedding)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
            ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding
        `, [id, item.content || item.text || '', item.source || '', item.category || '',
            JSON.stringify(item.tags || []), JSON.stringify(item.metadata || {}),
            Date.now(), this.formatVector(embedding)]);
    }

    async searchKnowledge(queryVector: number[], limit: number = 5): Promise<any[]> {
        const padded = this.padVector(queryVector);
        const { rows } = await this.pool.query(`
            SELECT *, 1 - (embedding <=> $1::vector) as similarity
            FROM knowledge_vectors
            ORDER BY embedding <=> $1::vector
            LIMIT $2
        `, [this.formatVector(padded), limit]);
        return rows.map(r => ({
            id: r.id, content: r.content, source: r.source,
            category: r.category, tags: r.tags, metadata: r.metadata,
            similarity: parseFloat(r.similarity)
        }));
    }

    // ─── Identity Operations ───────────────────────────────────────────

    private rowToUser(row: any): DbUser {
        return {
            id: row.id, email: row.email, passwordHash: row.password_hash,
            name: row.name, avatarUrl: row.avatar_url, role: row.role as UserRole,
            googleLinked: row.google_linked || !!row.google_email,
            telegramId: row.telegram_id, discordId: row.discord_id, whatsappId: row.whatsapp_id,
            createdAt: row.created_at, lastLogin: row.last_login
        };
    }

    async createUser(user: any): Promise<DbUser> {
        const now = Date.now();
        await this.pool.query(`
            INSERT INTO users (id, email, password_hash, name, avatar_url, role, google_linked, google_email, telegram_id, discord_id, whatsapp_id, created_at, last_login)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `, [user.id, user.email, user.passwordHash || null, user.name, user.avatarUrl || null,
        user.role, !!user.googleLinked, user.email,
        user.telegramId || null, user.discordId || null, user.whatsappId || null,
        user.createdAt || now, user.lastLogin || now]);
        return { ...user, createdAt: user.createdAt || now, lastLogin: user.lastLogin || now };
    }

    async getUserById(id: string): Promise<DbUser | null> {
        const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return rows.length > 0 ? this.rowToUser(rows[0]) : null;
    }

    async getUserByEmail(email: string): Promise<DbUser | null> {
        const { rows } = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
        return rows.length > 0 ? this.rowToUser(rows[0]) : null;
    }

    async getUserByGoogleEmail(googleEmail: string): Promise<DbUser | null> {
        const { rows } = await this.pool.query('SELECT * FROM users WHERE google_email = $1', [googleEmail]);
        return rows.length > 0 ? this.rowToUser(rows[0]) : null;
    }

    async getUserByChannelId(channel: string, channelId: string): Promise<DbUser | null> {
        const col = channel === 'telegram' ? 'telegram_id' : channel === 'discord' ? 'discord_id' : 'whatsapp_id';
        const { rows } = await this.pool.query(`SELECT * FROM users WHERE ${col} = $1`, [channelId]);
        return rows.length > 0 ? this.rowToUser(rows[0]) : null;
    }

    async updateUser(id: string, fields: Partial<DbUser>): Promise<void> {
        const setClauses: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (fields.name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(fields.name); }
        if (fields.avatarUrl !== undefined) { setClauses.push(`avatar_url = $${idx++}`); values.push(fields.avatarUrl); }
        if (fields.role !== undefined) { setClauses.push(`role = $${idx++}`); values.push(fields.role); }
        if (fields.googleLinked !== undefined) { setClauses.push(`google_linked = $${idx++}`); values.push(fields.googleLinked); }
        if (fields.email !== undefined) { setClauses.push(`google_email = $${idx++}`); values.push(fields.email); }
        if (fields.lastLogin !== undefined) { setClauses.push(`last_login = $${idx++}`); values.push(fields.lastLogin); }
        if (fields.telegramId !== undefined) { setClauses.push(`telegram_id = $${idx++}`); values.push(fields.telegramId); }
        if (fields.discordId !== undefined) { setClauses.push(`discord_id = $${idx++}`); values.push(fields.discordId); }
        if (fields.whatsappId !== undefined) { setClauses.push(`whatsapp_id = $${idx++}`); values.push(fields.whatsappId); }
        if (fields.passwordHash !== undefined) { setClauses.push(`password_hash = $${idx++}`); values.push(fields.passwordHash); }

        if (setClauses.length > 0) {
            values.push(id);
            await this.pool.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);
        }
    }

    async hasAnyUsers(): Promise<boolean> {
        const { rows } = await this.pool.query('SELECT COUNT(*) as count FROM users');
        return parseInt(rows[0].count) > 0;
    }

    async createDevice(device: any): Promise<DbDevice> {
        const now = Date.now();
        await this.pool.query(`
            INSERT INTO devices (id, user_id, fingerprint, name, trusted, last_seen, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen
        `, [device.id, device.userId, device.fingerprint, device.name, device.trusted !== false, now, device.createdAt || now]);
        return { ...device, createdAt: device.createdAt || now, lastSeen: now };
    }

    async getDeviceByFingerprint(fingerprint: string, userId?: string): Promise<DbDevice | null> {
        let query: string;
        let params: any[];
        if (userId) {
            query = 'SELECT * FROM devices WHERE fingerprint = $1 AND user_id = $2';
            params = [fingerprint, userId];
        } else {
            query = 'SELECT * FROM devices WHERE fingerprint = $1 ORDER BY last_seen DESC LIMIT 1';
            params = [fingerprint];
        }
        const { rows } = await this.pool.query(query, params);
        if (rows.length === 0) return null;
        const r = rows[0];
        return { id: r.id, userId: r.user_id, fingerprint: r.fingerprint, name: r.name, trusted: r.trusted, lastSeen: r.last_seen, createdAt: r.created_at };
    }

    async getDeviceById(id: string): Promise<DbDevice | null> {
        const { rows } = await this.pool.query('SELECT * FROM devices WHERE id = $1', [id]);
        if (rows.length === 0) return null;
        const r = rows[0];
        return { id: r.id, userId: r.user_id, fingerprint: r.fingerprint, name: r.name, trusted: r.trusted, lastSeen: r.last_seen, createdAt: r.created_at };
    }

    async updateDeviceLastSeen(id: string): Promise<void> {
        await this.pool.query('UPDATE devices SET last_seen = $1 WHERE id = $2', [Date.now(), id]);
    }

    async createSession(session: DbSession): Promise<DbSession> {
        await this.pool.query(
            'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)',
            [session.id, session.userId, session.deviceId, session.expiresAt, session.createdAt]
        );
        return session;
    }

    async getSessionById(id: string): Promise<(DbSession & { user?: DbUser }) | null> {
        const { rows } = await this.pool.query(`
            SELECT s.*, u.id as u_id, u.email as u_email, u.name as u_name, u.role as u_role,
                   u.avatar_url as u_avatar, u.google_linked as u_google,
                   u.telegram_id as u_telegram, u.discord_id as u_discord, u.whatsapp_id as u_whatsapp,
                   u.created_at as u_created, u.last_login as u_last_login
            FROM sessions s LEFT JOIN users u ON s.user_id = u.id
            WHERE s.id = $1 AND s.expires_at > $2
        `, [id, Date.now()]);
        if (rows.length === 0) return null;
        const r = rows[0];
        const session: DbSession & { user?: DbUser } = {
            id: r.id, userId: r.user_id, deviceId: r.device_id,
            expiresAt: r.expires_at, createdAt: r.created_at
        };
        if (r.u_id) {
            session.user = {
                id: r.u_id, email: r.u_email, name: r.u_name, role: r.u_role as UserRole,
                avatarUrl: r.u_avatar, googleLinked: r.u_google,
                telegramId: r.u_telegram, discordId: r.u_discord, whatsappId: r.u_whatsapp,
                createdAt: r.u_created, lastLogin: r.u_last_login
            };
        }
        return session;
    }

    async deleteSession(id: string): Promise<void> {
        await this.pool.query('DELETE FROM sessions WHERE id = $1', [id]);
    }

    async deleteExpiredSessions(): Promise<void> {
        await this.pool.query('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);
    }
}
