// =============================================================================
// SQLite Adapter
// Wraps existing sqliteService + lancedbService + identity DB as an
// IDatabaseAdapter. This is a thin proxy — zero logic changes.
// When DATABASE_URL is absent, the system uses this adapter by default.
// =============================================================================

import { IDatabaseAdapter, DbUser, DbDevice, DbSession, UserRole } from './databaseAdapter';
import { Agent, MemoryNode, MemoryTier } from '../../types';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// ─── Paths ───────────────────────────────────────────────────────────────────

const DB_DIR = path.resolve(process.cwd(), 'db');
const IDENTITY_DB_PATH = path.join(DB_DIR, 'identity.sqlite');

export class SqliteAdapter implements IDatabaseAdapter {
    private identityDb: Database.Database | null = null;

    async initialize(): Promise<void> {
        // sqliteService and lancedbService are both singletons that self-initialize.
        // We only need to set up the identity DB here.
        if (!fs.existsSync(DB_DIR)) {
            fs.mkdirSync(DB_DIR, { recursive: true });
        }

        this.identityDb = new Database(IDENTITY_DB_PATH);
        this.identityDb.pragma('journal_mode = WAL');
        this.identityDb.pragma('busy_timeout = 5000');
        this.createIdentityTables();
    }

    async close(): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.close();
        if (this.identityDb) {
            try { this.identityDb.close(); } catch { /* ignore */ }
        }
    }

    // ─── Agent Operations (delegates to sqliteService) ─────────────────

    async upsertAgent(agent: Agent): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.upsertAgent(agent);
    }

    async getAgent(id: string): Promise<Agent | null> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getAgent(id);
    }

    async getAllAgents(): Promise<Agent[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getAllAgents();
    }

    async deleteAgent(id: string): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.deleteAgent(id);
    }

    async getInactiveAgents(thresholdTimestamp: number): Promise<Agent[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getInactiveAgents(thresholdTimestamp);
    }

    // ─── Log Operations ────────────────────────────────────────────────

    async log(level: string, message: string, source: string, details?: any): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.log(level, message, source, details);
    }

    async getLogs(limit: number = 100): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getLogs(limit);
    }

    async getRecentLogs(level: string, minutes: number): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getRecentLogs(level, minutes);
    }

    // ─── Cost Metrics ──────────────────────────────────────────────────

    async saveCostMetrics(metrics: any): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.saveCostMetrics(metrics);
    }

    async getCostMetrics(): Promise<any | null> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getCostMetrics();
    }

    // ─── System Config ─────────────────────────────────────────────────

    async setConfig(key: string, value: any): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.setConfig(key, value);
    }

    async getConfig(key: string): Promise<any | null> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getConfig(key);
    }

    async getAllConfig(): Promise<Record<string, any>> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getAllConfig();
    }

    // ─── Chat Operations ───────────────────────────────────────────────

    async appendChatMessage(msg: any, sessionId: string = 'default'): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.appendChatMessage(msg, sessionId);
    }

    async getChatSessions(): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getChatSessions();
    }

    async createChatSession(title: string): Promise<any> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.createChatSession(title);
    }

    async deleteChatSession(id: string): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.deleteChatSession(id);
    }

    async getChatHistory(sessionId: string = 'default', limit: number = 100): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getChatHistory(sessionId, limit);
    }

    async searchChatHistory(query: string, limit: number = 30): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.searchChatHistory(query, limit);
    }

    // ─── UI State ──────────────────────────────────────────────────────

    async saveUiState(componentId: string, state: any): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.saveUiState(componentId, state);
    }

    async getUiState(componentId: string): Promise<any | null> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getUiState(componentId);
    }

    // ─── Evolution History ─────────────────────────────────────────────

    async logEvolution(data: any): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.logEvolution(data);
    }

    async getEvolutionHistory(agentId?: string, limit: number = 50): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getEvolutionHistory(agentId, limit);
    }

    // ─── Voice Operations ──────────────────────────────────────────────

    async upsertVoice(voice: any): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.upsertVoice(voice);
    }

    async getVoice(id: string): Promise<any | null> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getVoice(id);
    }

    async getAllVoices(): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getAllVoices();
    }

    async getVoicesByCategory(category: string): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getVoicesByCategory(category);
    }

    async getDefaultVoice(): Promise<any | null> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getDefaultVoice();
    }

    async setDefaultVoice(id: string): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.setDefaultVoice(id);
    }

    async deleteVoice(id: string): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.deleteVoice(id);
    }

    async incrementVoiceUsage(id: string): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.incrementVoiceUsage(id);
    }

    async createCloneSession(session: any): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.createCloneSession(session);
    }

    async updateCloneSession(id: string, updates: any): Promise<void> {
        const { sqliteService } = await import('../sqliteService');
        sqliteService.updateCloneSession(id, updates);
    }

    async getCloneSession(id: string): Promise<any | null> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getCloneSession(id);
    }

    async getCloneSessionsForVoice(voiceId: string): Promise<any[]> {
        const { sqliteService } = await import('../sqliteService');
        return sqliteService.getCloneSessionsForVoice(voiceId);
    }

    // ─── Vector Memory Operations (delegates to lancedbService) ────────

    async storeVector(node: MemoryNode, vector?: number[]): Promise<void> {
        const { lancedbService } = await import('../lancedbService');
        await lancedbService.store(node, vector);
    }

    async searchVectors(queryVector: number[], limit: number = 10, filter?: string): Promise<MemoryNode[]> {
        const { lancedbService } = await import('../lancedbService');
        return lancedbService.search(queryVector, limit, filter);
    }

    async findSimilarNodes(nodeId: string, limit: number = 5): Promise<(MemoryNode & { similarity?: number })[]> {
        const { lancedbService } = await import('../lancedbService');
        return lancedbService.findSimilarNodes(nodeId, limit);
    }

    async searchByContent(textQuery: string, limit: number = 20): Promise<MemoryNode[]> {
        const { lancedbService } = await import('../lancedbService');
        return lancedbService.searchByContent(textQuery, limit);
    }

    async getAllNodes(): Promise<MemoryNode[]> {
        const { lancedbService } = await import('../lancedbService');
        return lancedbService.getAllNodes();
    }

    async getNodesByTier(tier: MemoryTier, limit: number = 1000): Promise<MemoryNode[]> {
        const { lancedbService } = await import('../lancedbService');
        return lancedbService.getNodesByTier(tier, limit);
    }

    async deleteNode(id: string): Promise<boolean> {
        const { lancedbService } = await import('../lancedbService');
        return lancedbService.deleteNode(id);
    }

    // ─── Knowledge Indexing ────────────────────────────────────────────

    async storeKnowledge(item: any): Promise<void> {
        const { lancedbService } = await import('../lancedbService');
        await lancedbService.storeKnowledge(item);
    }

    async searchKnowledge(queryVector: number[], limit: number = 5): Promise<any[]> {
        const { lancedbService } = await import('../lancedbService');
        return lancedbService.searchKnowledge(queryVector, limit);
    }

    // ─── Identity Operations (local SQLite) ────────────────────────────

    private createIdentityTables(): void {
        if (!this.identityDb) return;

        this.identityDb.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE,
                password_hash TEXT,
                name TEXT NOT NULL,
                avatar_url TEXT,
                role TEXT NOT NULL DEFAULT 'USER',
                google_linked INTEGER DEFAULT 0,
                google_email TEXT,
                telegram_id TEXT,
                discord_id TEXT,
                whatsapp_id TEXT,
                created_at INTEGER NOT NULL,
                last_login INTEGER
            )
        `);

        this.identityDb.exec(`
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                name TEXT NOT NULL,
                trusted INTEGER DEFAULT 1,
                last_seen INTEGER,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        this.identityDb.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (device_id) REFERENCES devices(id)
            )
        `);

        this.identityDb.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        this.identityDb.exec(`CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_email)`);
        this.identityDb.exec(`CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices(fingerprint)`);
        this.identityDb.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
    }

    private rowToUser(row: any): DbUser {
        return {
            id: row.id,
            email: row.email,
            passwordHash: row.password_hash,
            name: row.name,
            avatarUrl: row.avatar_url,
            role: row.role as UserRole,
            googleLinked: row.google_linked === 1 || !!row.google_email,
            telegramId: row.telegram_id,
            discordId: row.discord_id,
            whatsappId: row.whatsapp_id,
            createdAt: row.created_at,
            lastLogin: row.last_login
        };
    }

    async createUser(user: any): Promise<DbUser> {
        if (!this.identityDb) throw new Error('Identity DB not initialized');
        const now = Date.now();
        this.identityDb.prepare(`
            INSERT INTO users (id, email, password_hash, name, avatar_url, role, google_linked, google_email, telegram_id, discord_id, whatsapp_id, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            user.id, user.email, user.passwordHash || null, user.name, user.avatarUrl || null,
            user.role, user.googleLinked ? 1 : 0, user.email,
            user.telegramId || null, user.discordId || null, user.whatsappId || null,
            user.createdAt || now, user.lastLogin || now
        );
        return { ...user, createdAt: user.createdAt || now, lastLogin: user.lastLogin || now };
    }

    async getUserById(id: string): Promise<DbUser | null> {
        if (!this.identityDb) return null;
        const row = this.identityDb.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
        return row ? this.rowToUser(row) : null;
    }

    async getUserByEmail(email: string): Promise<DbUser | null> {
        if (!this.identityDb) return null;
        const row = this.identityDb.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
        return row ? this.rowToUser(row) : null;
    }

    async getUserByGoogleEmail(googleEmail: string): Promise<DbUser | null> {
        if (!this.identityDb) return null;
        const row = this.identityDb.prepare('SELECT * FROM users WHERE google_email = ?').get(googleEmail) as any;
        return row ? this.rowToUser(row) : null;
    }

    async getUserByChannelId(channel: string, channelId: string): Promise<DbUser | null> {
        if (!this.identityDb) return null;
        const col = channel === 'telegram' ? 'telegram_id' : channel === 'discord' ? 'discord_id' : 'whatsapp_id';
        const row = this.identityDb.prepare(`SELECT * FROM users WHERE ${col} = ?`).get(channelId) as any;
        return row ? this.rowToUser(row) : null;
    }

    async updateUser(id: string, fields: Partial<DbUser>): Promise<void> {
        if (!this.identityDb) return;
        const setClauses: string[] = [];
        const values: any[] = [];

        if (fields.name !== undefined) { setClauses.push('name = ?'); values.push(fields.name); }
        if (fields.avatarUrl !== undefined) { setClauses.push('avatar_url = ?'); values.push(fields.avatarUrl); }
        if (fields.role !== undefined) { setClauses.push('role = ?'); values.push(fields.role); }
        if (fields.googleLinked !== undefined) { setClauses.push('google_linked = ?'); values.push(fields.googleLinked ? 1 : 0); }
        if (fields.email !== undefined) { setClauses.push('google_email = ?'); values.push(fields.email); }
        if (fields.lastLogin !== undefined) { setClauses.push('last_login = ?'); values.push(fields.lastLogin); }
        if (fields.telegramId !== undefined) { setClauses.push('telegram_id = ?'); values.push(fields.telegramId); }
        if (fields.discordId !== undefined) { setClauses.push('discord_id = ?'); values.push(fields.discordId); }
        if (fields.whatsappId !== undefined) { setClauses.push('whatsapp_id = ?'); values.push(fields.whatsappId); }
        if (fields.passwordHash !== undefined) { setClauses.push('password_hash = ?'); values.push(fields.passwordHash); }

        if (setClauses.length > 0) {
            values.push(id);
            this.identityDb.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
        }
    }

    async hasAnyUsers(): Promise<boolean> {
        if (!this.identityDb) return false;
        const row = this.identityDb.prepare('SELECT COUNT(*) as count FROM users').get() as any;
        return row.count > 0;
    }

    async createDevice(device: any): Promise<DbDevice> {
        if (!this.identityDb) throw new Error('Identity DB not initialized');
        const now = Date.now();
        this.identityDb.prepare(`
            INSERT INTO devices (id, user_id, fingerprint, name, trusted, last_seen, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen
        `).run(device.id, device.userId, device.fingerprint, device.name, device.trusted ? 1 : 0, now, device.createdAt || now);
        return { ...device, createdAt: device.createdAt || now, lastSeen: now };
    }

    async getDeviceByFingerprint(fingerprint: string, userId?: string): Promise<DbDevice | null> {
        if (!this.identityDb) return null;
        let row: any;
        if (userId) {
            row = this.identityDb.prepare('SELECT * FROM devices WHERE fingerprint = ? AND user_id = ?').get(fingerprint, userId);
        } else {
            row = this.identityDb.prepare('SELECT * FROM devices WHERE fingerprint = ? ORDER BY last_seen DESC LIMIT 1').get(fingerprint);
        }
        if (!row) return null;
        return { id: row.id, userId: row.user_id, fingerprint: row.fingerprint, name: row.name, trusted: row.trusted === 1, lastSeen: row.last_seen, createdAt: row.created_at };
    }

    async getDeviceById(id: string): Promise<DbDevice | null> {
        if (!this.identityDb) return null;
        const row = this.identityDb.prepare('SELECT * FROM devices WHERE id = ?').get(id) as any;
        if (!row) return null;
        return { id: row.id, userId: row.user_id, fingerprint: row.fingerprint, name: row.name, trusted: row.trusted === 1, lastSeen: row.last_seen, createdAt: row.created_at };
    }

    async updateDeviceLastSeen(id: string): Promise<void> {
        if (!this.identityDb) return;
        this.identityDb.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), id);
    }

    async createSession(session: DbSession): Promise<DbSession> {
        if (!this.identityDb) throw new Error('Identity DB not initialized');
        this.identityDb.prepare(`
            INSERT INTO sessions (id, user_id, device_id, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(session.id, session.userId, session.deviceId, session.expiresAt, session.createdAt);
        return session;
    }

    async getSessionById(id: string): Promise<(DbSession & { user?: DbUser }) | null> {
        if (!this.identityDb) return null;
        const row = this.identityDb.prepare(`
            SELECT s.*, u.id as u_id, u.email as u_email, u.name as u_name, u.role as u_role,
                   u.avatar_url as u_avatar, u.google_linked as u_google,
                   u.telegram_id as u_telegram, u.discord_id as u_discord, u.whatsapp_id as u_whatsapp,
                   u.created_at as u_created, u.last_login as u_last_login
            FROM sessions s
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.id = ? AND s.expires_at > ?
        `).get(id, Date.now()) as any;
        if (!row) return null;
        const session: DbSession & { user?: DbUser } = {
            id: row.id, userId: row.user_id, deviceId: row.device_id,
            expiresAt: row.expires_at, createdAt: row.created_at
        };
        if (row.u_id) {
            session.user = {
                id: row.u_id, email: row.u_email, name: row.u_name, role: row.u_role as UserRole,
                avatarUrl: row.u_avatar, googleLinked: row.u_google === 1,
                telegramId: row.u_telegram, discordId: row.u_discord, whatsappId: row.u_whatsapp,
                createdAt: row.u_created, lastLogin: row.u_last_login
            };
        }
        return session;
    }

    async deleteSession(id: string): Promise<void> {
        if (!this.identityDb) return;
        this.identityDb.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    }

    async deleteExpiredSessions(): Promise<void> {
        if (!this.identityDb) return;
        this.identityDb.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    }
}
