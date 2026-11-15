// =============================================================================
// Database Adapter Interface
// Unified contract for all database operations (relational + vector + identity).
// Both SqliteAdapter and PostgresAdapter implement this interface.
// =============================================================================

import { Agent } from '../../types';
import { MemoryNode, MemoryTier } from '../../types';

// ─── Identity Types (mirrored from identityService) ──────────────────────────

export enum UserRole {
    CREATOR = 'CREATOR',
    ADMIN = 'ADMIN',
    USER = 'USER',
    GUEST = 'GUEST'
}

export interface DbUser {
    id: string;
    email: string | null;
    passwordHash?: string;
    name: string;
    avatarUrl?: string;
    role: UserRole;
    googleLinked: boolean;
    telegramId?: string | null;
    discordId?: string | null;
    whatsappId?: string | null;
    createdAt: number;
    lastLogin: number;
}

export interface DbDevice {
    id: string;
    userId: string;
    fingerprint: string;
    name: string;
    trusted: boolean;
    lastSeen: number;
    createdAt: number;
}

export interface DbSession {
    id: string;
    userId: string;
    deviceId: string;
    expiresAt: number;
    createdAt: number;
}

// ─── Main Interface ──────────────────────────────────────────────────────────

export interface IDatabaseAdapter {

    // ─── Lifecycle ─────────────────────────────────────────────────────
    /** Initialize connection, run migrations, create tables */
    initialize(): Promise<void>;
    /** Close all connections gracefully */
    close(): Promise<void>;

    // ─── Agent Operations ──────────────────────────────────────────────
    upsertAgent(agent: Agent): Promise<void>;
    getAgent(id: string): Promise<Agent | null>;
    getAllAgents(): Promise<Agent[]>;
    deleteAgent(id: string): Promise<void>;
    getInactiveAgents(thresholdTimestamp: number): Promise<Agent[]>;

    // ─── Log Operations ────────────────────────────────────────────────
    log(level: string, message: string, source: string, details?: any): Promise<void>;
    getLogs(limit?: number): Promise<any[]>;
    getRecentLogs(level: string, minutes: number): Promise<any[]>;

    // ─── Cost Metrics ──────────────────────────────────────────────────
    saveCostMetrics(metrics: any): Promise<void>;
    getCostMetrics(): Promise<any | null>;

    // ─── System Config ─────────────────────────────────────────────────
    setConfig(key: string, value: any): Promise<void>;
    getConfig(key: string): Promise<any | null>;
    getAllConfig(): Promise<Record<string, any>>;

    // ─── Chat Operations ───────────────────────────────────────────────
    appendChatMessage(msg: any, sessionId?: string): Promise<void>;
    getChatSessions(): Promise<any[]>;
    createChatSession(title: string): Promise<any>;
    deleteChatSession(id: string): Promise<void>;
    getChatHistory(sessionId?: string, limit?: number): Promise<any[]>;
    searchChatHistory(query: string, limit?: number): Promise<any[]>;

    // ─── UI State ──────────────────────────────────────────────────────
    saveUiState(componentId: string, state: any): Promise<void>;
    getUiState(componentId: string): Promise<any | null>;

    // ─── Evolution History ─────────────────────────────────────────────
    logEvolution(data: {
        agentId: string;
        agentName: string;
        previousScore?: number;
        newScore?: number;
        triggerType: 'MANUAL' | 'QUALITY' | 'REMEDIATION' | 'PEER_REVIEW';
        triggeredBy?: string;
        improvements?: string[];
    }): Promise<void>;
    getEvolutionHistory(agentId?: string, limit?: number): Promise<any[]>;

    // ─── Voice Operations ──────────────────────────────────────────────
    upsertVoice(voice: any): Promise<void>;
    getVoice(id: string): Promise<any | null>;
    getAllVoices(): Promise<any[]>;
    getVoicesByCategory(category: string): Promise<any[]>;
    getDefaultVoice(): Promise<any | null>;
    setDefaultVoice(id: string): Promise<void>;
    deleteVoice(id: string): Promise<void>;
    incrementVoiceUsage(id: string): Promise<void>;
    createCloneSession(session: any): Promise<void>;
    updateCloneSession(id: string, updates: any): Promise<void>;
    getCloneSession(id: string): Promise<any | null>;
    getCloneSessionsForVoice(voiceId: string): Promise<any[]>;

    // ─── Vector Memory Operations ──────────────────────────────────────
    storeVector(node: MemoryNode, vector?: number[]): Promise<void>;
    searchVectors(queryVector: number[], limit?: number, filter?: string): Promise<MemoryNode[]>;
    findSimilarNodes(nodeId: string, limit?: number): Promise<(MemoryNode & { similarity?: number })[]>;
    searchByContent(textQuery: string, limit?: number): Promise<MemoryNode[]>;
    getAllNodes(): Promise<MemoryNode[]>;
    getNodesByTier(tier: MemoryTier, limit?: number): Promise<MemoryNode[]>;
    deleteNode(id: string): Promise<boolean>;

    // ─── Knowledge Indexing ────────────────────────────────────────────
    storeKnowledge(item: any): Promise<void>;
    searchKnowledge(queryVector: number[], limit?: number): Promise<any[]>;

    // ─── Identity Operations ───────────────────────────────────────────
    // Users
    createUser(user: Omit<DbUser, 'createdAt' | 'lastLogin'> & { createdAt?: number; lastLogin?: number }): Promise<DbUser>;
    getUserById(id: string): Promise<DbUser | null>;
    getUserByEmail(email: string): Promise<DbUser | null>;
    getUserByGoogleEmail(googleEmail: string): Promise<DbUser | null>;
    getUserByChannelId(channel: string, channelId: string): Promise<DbUser | null>;
    updateUser(id: string, fields: Partial<DbUser>): Promise<void>;
    hasAnyUsers(): Promise<boolean>;

    // Devices
    createDevice(device: Omit<DbDevice, 'createdAt'> & { createdAt?: number }): Promise<DbDevice>;
    getDeviceByFingerprint(fingerprint: string, userId?: string): Promise<DbDevice | null>;
    getDeviceById(id: string): Promise<DbDevice | null>;
    updateDeviceLastSeen(id: string): Promise<void>;

    // Sessions
    createSession(session: DbSession): Promise<DbSession>;
    getSessionById(id: string): Promise<(DbSession & { user?: DbUser }) | null>;
    deleteSession(id: string): Promise<void>;
    deleteExpiredSessions(): Promise<void>;
}
