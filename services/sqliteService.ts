import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Agent } from '../types';

const DB_PATH = path.resolve(process.cwd(), 'db', 'silhouette.sqlite');
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

export class SqliteService {
    private db: Database.Database;

    constructor() {
        this.db = new Database(DB_PATH);
        this.initializeSchema();
    }

    private initializeSchema() {
        // Agents Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT,
                status TEXT,
                data JSON NOT NULL,
                last_active INTEGER
            )
        `);

        // System Logs Table (Structured Logging)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT,
                message TEXT,
                source TEXT,
                timestamp INTEGER,
                details JSON
            )
        `);

        // Tasks Table (for Workflow Engine)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                description TEXT,
                assigned_to TEXT,
                status TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                data JSON
            )
        `);

        // Cost Metrics Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS cost_metrics (
                id TEXT PRIMARY KEY,
                data JSON,
                updated_at INTEGER
            )
        `);

        // System Config Table (Replaces silhouette_memory_db.json)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value JSON,
                updated_at INTEGER
            )
        `);

        // Chat Logs Table (Replaces silhouette_chat_history.json)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_logs (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                role TEXT,
                content TEXT,
                timestamp INTEGER,
                metadata JSON
            )
        `);

        // [ROOT CAUSE FIX] Chat Sessions Table for proper management
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at INTEGER,
                last_updated INTEGER,
                metadata JSON
            )
        `);

        // Ensure default session exists
        const defaultSession = this.db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get('default');
        if (!defaultSession) {
            this.db.prepare('INSERT INTO chat_sessions (id, title, created_at, last_updated) VALUES (?, ?, ?, ?)').run('default', 'General System Chat', Date.now(), Date.now());
        }

        // UI State Table (Replaces ui_state.json)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ui_state (
                component_id TEXT PRIMARY KEY,
                state JSON,
                last_updated INTEGER
            )
        `);

        // Assets Table (Unified Asset Catalog)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                file_path TEXT NOT NULL,
                thumbnail_path TEXT,
                size_bytes INTEGER,
                mime_type TEXT,
                prompt TEXT,
                provider TEXT,
                tags JSON,
                metadata JSON,
                folder TEXT DEFAULT '/',
                is_favorite INTEGER DEFAULT 0,
                is_archived INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER,
                accessed_at INTEGER
            )
        `);

        // Indexes for assets table
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC)`);

        // Discovery Journal Table (Persistent Discovery Memory)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS discovery_journal (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
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
                metadata JSON
            )
        `);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_timestamp ON discovery_journal(timestamp DESC)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_decision ON discovery_journal(decision)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_pair ON discovery_journal(source_node, target_node)`);

        // Synthesized Insights Table (Persistent Insight Memory)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS synthesized_insights (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                summary TEXT,
                discoveries JSON,
                patterns JSON,
                novel_hypothesis TEXT,
                supporting_evidence JSON,
                confidence REAL,
                domain TEXT,
                created_at INTEGER NOT NULL,
                paper_id TEXT
            )
        `);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_created ON synthesized_insights(created_at DESC)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_domain ON synthesized_insights(domain)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_confidence ON synthesized_insights(confidence DESC)`);

        // Generated Papers Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS generated_papers (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                authors JSON,
                abstract TEXT,
                sections JSON,
                paper_references JSON,
                keywords JSON,
                insight_id TEXT,
                format TEXT DEFAULT 'markdown',
                status TEXT DEFAULT 'draft',
                peer_review_score REAL,
                peer_review_feedback TEXT,
                file_path TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER
            )
        `);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_papers_created ON generated_papers(created_at DESC)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_papers_status ON generated_papers(status)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_papers_insight ON generated_papers(insight_id)`);

        // PA-039: Evolution History Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS evolution_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                previous_score REAL,
                new_score REAL,
                trigger_type TEXT NOT NULL,
                triggered_by TEXT,
                improvements TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_evolution_agent ON evolution_history(agent_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_evolution_date ON evolution_history(created_at DESC)`);

        // PA-008: Voice Library Table
        this.db.exec(`
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
                is_downloaded INTEGER DEFAULT 0,
                is_default INTEGER DEFAULT 0,
                quality_score INTEGER,
                usage_count INTEGER DEFAULT 0,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER
            )
        `);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_voices_category ON voices(category)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_voices_language ON voices(language)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_voices_default ON voices(is_default)`);

        // PA-008: Voice Clone Sessions Table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS voice_clone_sessions (
                id TEXT PRIMARY KEY,
                voice_id TEXT NOT NULL,
                input_path TEXT NOT NULL,
                input_duration REAL,
                input_quality INTEGER,
                noise_level TEXT,
                silence_ratio REAL,
                was_normalized INTEGER DEFAULT 0,
                was_denoised INTEGER DEFAULT 0,
                processed_path TEXT,
                processing_time REAL,
                status TEXT DEFAULT 'pending',
                error_message TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (voice_id) REFERENCES voices(id)
            )
        `);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_clone_sessions_voice ON voice_clone_sessions(voice_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_clone_sessions_status ON voice_clone_sessions(status)`);
    }

    // --- AGENT OPERATIONS ---

    public upsertAgent(agent: Agent): void {
        const stmt = this.db.prepare(`
            INSERT INTO agents (id, name, role, status, data, last_active)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                role = excluded.role,
                status = excluded.status,
                data = excluded.data,
                last_active = excluded.last_active
        `);

        stmt.run(
            agent.id,
            agent.name,
            agent.role,
            agent.status,
            JSON.stringify(agent),
            agent.lastActive
        );
    }

    public getAgent(id: string): Agent | null {
        const stmt = this.db.prepare('SELECT data FROM agents WHERE id = ?');
        const row = stmt.get(id) as { data: string } | undefined;
        if (!row) return null;
        return JSON.parse(row.data) as Agent;
    }

    public getAllAgents(): Agent[] {
        const stmt = this.db.prepare('SELECT data FROM agents');
        const rows = stmt.all() as { data: string }[];
        return rows.map(row => JSON.parse(row.data) as Agent);
    }

    public deleteAgent(id: string): void {
        const stmt = this.db.prepare('DELETE FROM agents WHERE id = ?');
        stmt.run(id);
    }

    // --- LOG OPERATIONS ---

    public log(level: string, message: string, source: string, details?: any) {
        const stmt = this.db.prepare(`
            INSERT INTO system_logs (level, message, source, timestamp, details)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(level, message, source, Date.now(), details ? JSON.stringify(details) : null);
    }

    public getLogs(limit: number = 100): any[] {
        const stmt = this.db.prepare('SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT ?');
        return stmt.all(limit).map((row: any) => ({
            ...row,
            details: row.details ? JSON.parse(row.details) : null
        }));
    }

    public getRecentLogs(level: string, minutes: number): any[] {
        const threshold = Date.now() - (minutes * 60 * 1000);
        const stmt = this.db.prepare('SELECT * FROM system_logs WHERE level = ? AND timestamp > ?');
        return stmt.all(level, threshold).map((row: any) => ({
            ...row,
            details: row.details ? JSON.parse(row.details) : null
        }));
    }

    // --- COST METRICS OPERATIONS ---

    public saveCostMetrics(metrics: any): void {
        const stmt = this.db.prepare(`
            INSERT INTO cost_metrics (id, data, updated_at)
            VALUES ('global', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
        `);
        stmt.run(JSON.stringify(metrics), Date.now());
    }

    public getCostMetrics(): any | null {
        const stmt = this.db.prepare('SELECT data FROM cost_metrics WHERE id = ?');
        const row = stmt.get('global') as { data: string } | undefined;
        if (!row) return null;
        return JSON.parse(row.data);
    }

    // --- SYSTEM CONFIG OPERATIONS ---

    public setConfig(key: string, value: any): void {
        const stmt = this.db.prepare(`
            INSERT INTO system_config (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `);
        stmt.run(key, JSON.stringify(value), Date.now());
    }

    public getConfig(key: string): any | null {
        const stmt = this.db.prepare('SELECT value FROM system_config WHERE key = ?');
        const row = stmt.get(key) as { value: string } | undefined;
        if (!row) return null;
        return JSON.parse(row.value);
    }

    public getAllConfig(): Record<string, any> {
        const stmt = this.db.prepare('SELECT key, value FROM system_config');
        const rows = stmt.all() as { key: string, value: string }[];
        const config: Record<string, any> = {};
        rows.forEach(row => {
            config[row.key] = JSON.parse(row.value);
        });
        return config;
    }

    // --- CHAT LOG OPERATIONS ---

    public appendChatMessage(msg: any, sessionId: string = 'default'): void {
        const id = msg.id || crypto.randomUUID();
        const stmt = this.db.prepare(`
            INSERT INTO chat_logs (id, session_id, role, content, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            msg.id,
            sessionId,
            msg.role,
            msg.content,
            msg.timestamp || Date.now(),
            JSON.stringify(msg.metadata || {})
        );

        // [ROOT CAUSE FIX] Update session timestamp
        this.db.prepare(`
            INSERT INTO chat_sessions (id, title, created_at, last_updated) 
            VALUES (?, 'New Session', ?, ?)
            ON CONFLICT(id) DO UPDATE SET last_updated = excluded.last_updated
        `).run(sessionId, Date.now(), Date.now());
    }

    public getChatSessions(): any[] {
        // [ROOT CAUSE FIX] Use dedicated sessions table + left join for preview
        const stmt = this.db.prepare(`
            SELECT s.id, s.title, s.created_at, s.last_updated,
                   (SELECT content FROM chat_logs WHERE session_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_message
            FROM chat_sessions s
            ORDER BY s.last_updated DESC
        `);
        const rows = stmt.all() as any[];

        return rows.map(row => ({
            id: row.id,
            title: row.title || 'Untitled Session',
            createdAt: row.created_at,
            lastUpdated: row.last_updated,
            preview: row.last_message ? row.last_message.substring(0, 50) : 'No messages yet',
            messages: []
        }));
    }

    public createChatSession(title: string): any {
        const id = crypto.randomUUID();
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO chat_sessions (id, title, created_at, last_updated)
            VALUES (?, ?, ?, ?)
        `).run(id, title, now, now);

        return {
            id,
            title,
            createdAt: now,
            lastUpdated: now,
            messages: []
        };
    }

    public deleteChatSession(id: string): void {
        const deleteLogs = this.db.prepare('DELETE FROM chat_logs WHERE session_id = ?');
        const deleteSession = this.db.prepare('DELETE FROM chat_sessions WHERE id = ?');

        this.db.transaction(() => {
            deleteLogs.run(id);
            deleteSession.run(id);
        })();
    }

    public getChatHistory(sessionId: string = 'default', limit: number = 100): any[] {
        const stmt = this.db.prepare(`
            SELECT * FROM chat_logs 
            WHERE session_id = ? 
            ORDER BY timestamp ASC
        `);
        // Note: For history we usually want chronological order, but if LIMITing we might want recent.
        // If we want "last 100 messages", we should ORDER BY timestamp DESC LIMIT 100, then reverse.
        // adapting to standard chat loading pattern:
        const rows = stmt.all(sessionId) as any[];

        // [ROOT CAUSE FIX] Normalize DB format (content) to ChatMessage interface format (text)
        return rows.map(row => ({
            id: row.id,
            role: row.role === 'assistant' ? 'agent' : row.role, // Normalize 'assistant' to 'agent'
            text: row.content, // Map 'content' (DB) to 'text' (ChatMessage interface)
            content: row.content, // Also include 'content' for compatibility
            timestamp: row.timestamp,
            thoughts: row.metadata ? JSON.parse(row.metadata).thoughts : undefined
        }));
    }

    /**
     * CROSS-SESSION SEMANTIC SEARCH
     * Searches chat history across ALL sessions using keyword matching.
     * Returns relevance-ranked results for context assembly.
     * 
     * @param query The search query
     * @param limit Maximum results to return
     * @returns Array of matching messages with relevance scores
     */
    public searchChatHistory(query: string, limit: number = 30): Array<{
        id: string;
        sessionId: string;
        role: string;
        content: string;
        timestamp: number;
        relevanceScore: number;
    }> {
        if (!query || query.length < 3) return [];

        // Extract meaningful keywords from query (ignore stopwords)
        const stopwords = new Set([
            'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'que', 'es', 'y', 'a', 'por',
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'of', 'to', 'and', 'for',
            'qué', 'que', 'como', 'cuando', 'donde', 'quien', 'cual',
            'what', 'how', 'when', 'where', 'who', 'which', 'why',
            'me', 'te', 'se', 'nos', 'les', 'lo', 'le', 'su', 'sus',
            'mi', 'tu', 'sobre', 'con', 'sin', 'para', 'este', 'esta', 'eso', 'esa'
        ]);

        const keywords = query
            .toLowerCase()
            .replace(/[^\w\sáéíóúñü]/g, ' ')  // Remove punctuation
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopwords.has(word));

        if (keywords.length === 0) {
            // Fallback: just use the whole query for simple LIKE search
            const stmt = this.db.prepare(`
                SELECT id, session_id, role, content, timestamp
                FROM chat_logs
                WHERE content LIKE ?
                ORDER BY timestamp DESC
                LIMIT ?
            `);
            const rows = stmt.all(`%${query}%`, limit) as any[];
            return rows.map(row => ({
                id: row.id,
                sessionId: row.session_id,
                role: row.role,
                content: row.content,
                timestamp: row.timestamp,
                relevanceScore: 0.5
            }));
        }

        // Build SQL with OR conditions for each keyword
        // Each keyword match adds to relevance score
        const likeClauses = keywords.map(() => `content LIKE ?`).join(' OR ');
        const likeParams = keywords.map(kw => `%${kw}%`);

        const stmt = this.db.prepare(`
            SELECT id, session_id, role, content, timestamp
            FROM chat_logs
            WHERE ${likeClauses}
            ORDER BY timestamp DESC
            LIMIT ?
        `);

        const rows = stmt.all(...likeParams, limit * 2) as any[]; // Get more to score

        // Calculate relevance score based on keyword matches
        const scoredResults = rows.map(row => {
            const contentLower = row.content.toLowerCase();
            let matchCount = 0;
            for (const kw of keywords) {
                if (contentLower.includes(kw)) matchCount++;
            }
            const relevanceScore = matchCount / keywords.length;
            return {
                id: row.id,
                sessionId: row.session_id,
                role: row.role,
                content: row.content,
                timestamp: row.timestamp,
                relevanceScore
            };
        });

        // Sort by relevance, then by recency
        scoredResults.sort((a, b) => {
            if (b.relevanceScore !== a.relevanceScore) {
                return b.relevanceScore - a.relevanceScore;
            }
            return b.timestamp - a.timestamp;
        });

        return scoredResults.slice(0, limit);
    }


    // --- UI STATE OPERATIONS ---

    public saveUiState(componentId: string, state: any): void {
        const stmt = this.db.prepare(`
            INSERT INTO ui_state (component_id, state, last_updated)
            VALUES (?, ?, ?)
            ON CONFLICT(component_id) DO UPDATE SET
                state = excluded.state,
                last_updated = excluded.last_updated
        `);
        stmt.run(componentId, JSON.stringify(state), Date.now());
    }

    public getUiState(componentId: string): any | null {
        const stmt = this.db.prepare('SELECT state FROM ui_state WHERE component_id = ?');
        const row = stmt.get(componentId) as { state: string } | undefined;
        if (!row) return null;
        return JSON.parse(row.state);
    }

    // --- AGENT WATCHDOG ---

    public getInactiveAgents(thresholdTimestamp: number): Agent[] {
        const stmt = this.db.prepare('SELECT data FROM agents WHERE last_active < ? AND status != ?');
        const rows = stmt.all(thresholdTimestamp, 'SLEEPING') as { data: string }[];
        return rows.map(row => JSON.parse(row.data) as Agent);
    }

    // --- PA-039: EVOLUTION HISTORY OPERATIONS ---

    public logEvolution(data: {
        agentId: string;
        agentName: string;
        previousScore?: number;
        newScore?: number;
        triggerType: 'MANUAL' | 'QUALITY' | 'REMEDIATION' | 'PEER_REVIEW';
        triggeredBy?: string;
        improvements?: string[];
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO evolution_history 
            (agent_id, agent_name, previous_score, new_score, trigger_type, triggered_by, improvements, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            data.agentId,
            data.agentName,
            data.previousScore ?? null,
            data.newScore ?? null,
            data.triggerType,
            data.triggeredBy || 'SYSTEM',
            JSON.stringify(data.improvements || []),
            Date.now()
        );
    }

    public getEvolutionHistory(agentId?: string, limit: number = 50): any[] {
        if (agentId) {
            const stmt = this.db.prepare(`
                SELECT * FROM evolution_history 
                WHERE agent_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `);
            return stmt.all(agentId, limit).map((row: any) => ({
                ...row,
                improvements: row.improvements ? JSON.parse(row.improvements) : []
            }));
        } else {
            const stmt = this.db.prepare(`
                SELECT * FROM evolution_history 
                ORDER BY created_at DESC 
                LIMIT ?
            `);
            return stmt.all(limit).map((row: any) => ({
                ...row,
                improvements: row.improvements ? JSON.parse(row.improvements) : []
            }));
        }
    }

    // --- PA-008: VOICE OPERATIONS ---

    public upsertVoice(voice: {
        id: string;
        name: string;
        category: string;
        language: string;
        gender?: string;
        style?: string;
        samplePath?: string;
        thumbnailUrl?: string;
        sourceUrl?: string;
        isDownloaded?: boolean;
        isDefault?: boolean;
        qualityScore?: number;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO voices 
            (id, name, category, language, gender, style, sample_path, thumbnail_url, source_url, is_downloaded, is_default, quality_score, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                category = excluded.category,
                language = excluded.language,
                gender = excluded.gender,
                style = excluded.style,
                sample_path = excluded.sample_path,
                thumbnail_url = excluded.thumbnail_url,
                source_url = excluded.source_url,
                is_downloaded = excluded.is_downloaded,
                is_default = excluded.is_default,
                quality_score = excluded.quality_score,
                updated_at = excluded.updated_at
        `);
        stmt.run(
            voice.id,
            voice.name,
            voice.category,
            voice.language,
            voice.gender || null,
            voice.style || null,
            voice.samplePath || null,
            voice.thumbnailUrl || null,
            voice.sourceUrl || null,
            voice.isDownloaded ? 1 : 0,
            voice.isDefault ? 1 : 0,
            voice.qualityScore || null,
            Date.now(),
            Date.now()
        );
    }

    public getVoice(id: string): any | null {
        const stmt = this.db.prepare('SELECT * FROM voices WHERE id = ?');
        const row = stmt.get(id) as any;
        return row ? this.mapVoiceRow(row) : null;
    }

    public getAllVoices(): any[] {
        const stmt = this.db.prepare('SELECT * FROM voices ORDER BY created_at DESC');
        return stmt.all().map((row: any) => this.mapVoiceRow(row));
    }

    public getVoicesByCategory(category: string): any[] {
        const stmt = this.db.prepare('SELECT * FROM voices WHERE category = ? ORDER BY name');
        return stmt.all(category).map((row: any) => this.mapVoiceRow(row));
    }

    public getDefaultVoice(): any | null {
        const stmt = this.db.prepare('SELECT * FROM voices WHERE is_default = 1 LIMIT 1');
        const row = stmt.get() as any;
        return row ? this.mapVoiceRow(row) : null;
    }

    public setDefaultVoice(id: string): void {
        // Clear previous default
        this.db.prepare('UPDATE voices SET is_default = 0 WHERE is_default = 1').run();
        // Set new default
        this.db.prepare('UPDATE voices SET is_default = 1 WHERE id = ?').run(id);
    }

    public deleteVoice(id: string): void {
        this.db.prepare('DELETE FROM voice_clone_sessions WHERE voice_id = ?').run(id);
        this.db.prepare('DELETE FROM voices WHERE id = ?').run(id);
    }

    public incrementVoiceUsage(id: string): void {
        this.db.prepare('UPDATE voices SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?').run(Date.now(), id);
    }

    private mapVoiceRow(row: any): any {
        return {
            id: row.id,
            name: row.name,
            category: row.category,
            language: row.language,
            gender: row.gender,
            style: row.style,
            samplePath: row.sample_path,
            thumbnailUrl: row.thumbnail_url,
            sourceUrl: row.source_url,
            isDownloaded: row.is_downloaded === 1,
            isDefault: row.is_default === 1,
            qualityScore: row.quality_score,
            usageCount: row.usage_count,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    // --- Voice Clone Sessions ---

    public createCloneSession(session: {
        id: string;
        voiceId: string;
        inputPath: string;
        inputDuration?: number;
        inputQuality?: number;
        noiseLevel?: string;
        silenceRatio?: number;
    }): void {
        const stmt = this.db.prepare(`
            INSERT INTO voice_clone_sessions
            (id, voice_id, input_path, input_duration, input_quality, noise_level, silence_ratio, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            session.id,
            session.voiceId,
            session.inputPath,
            session.inputDuration || null,
            session.inputQuality || null,
            session.noiseLevel || null,
            session.silenceRatio || null,
            Date.now()
        );
    }

    public updateCloneSession(id: string, updates: {
        status?: string;
        processedPath?: string;
        processingTime?: number;
        wasNormalized?: boolean;
        wasDenoised?: boolean;
        errorMessage?: string;
    }): void {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.processedPath !== undefined) { fields.push('processed_path = ?'); values.push(updates.processedPath); }
        if (updates.processingTime !== undefined) { fields.push('processing_time = ?'); values.push(updates.processingTime); }
        if (updates.wasNormalized !== undefined) { fields.push('was_normalized = ?'); values.push(updates.wasNormalized ? 1 : 0); }
        if (updates.wasDenoised !== undefined) { fields.push('was_denoised = ?'); values.push(updates.wasDenoised ? 1 : 0); }
        if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage); }

        if (fields.length > 0) {
            values.push(id);
            const stmt = this.db.prepare(`UPDATE voice_clone_sessions SET ${fields.join(', ')} WHERE id = ?`);
            stmt.run(...values);
        }
    }

    public getCloneSession(id: string): any | null {
        const stmt = this.db.prepare('SELECT * FROM voice_clone_sessions WHERE id = ?');
        return stmt.get(id) as any;
    }

    public getCloneSessionsForVoice(voiceId: string): any[] {
        const stmt = this.db.prepare('SELECT * FROM voice_clone_sessions WHERE voice_id = ? ORDER BY created_at DESC');
        return stmt.all(voiceId);
    }
}

export const sqliteService = new SqliteService();

