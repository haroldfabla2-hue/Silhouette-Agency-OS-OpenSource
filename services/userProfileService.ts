/**
 * USER PROFILE SERVICE
 * =====================
 * Dedicated service for managing user-specific information.
 *
 * [R4] Root fix: the profile used to be a singleton ('user_primary') held in
 * RAM + one global Redis key with a Neo4j projection. The Redis fallback
 * loses data on restart, and every request - any user, anonymous or not -
 * read and wrote the same identity. Now:
 *
 * Storage Hierarchy (per user):
 * 1. RAM (instant) - per-user map
 * 2. SQLite (durable source of truth) - user_profiles table, survives restarts
 * 3. Redis (hot cache, per-user key) - best-effort, loss is harmless
 * 4. Neo4j (projection) - legacy cold store, import path for the old singleton
 *
 * The legacy singleton profile is only imported for the exact 'user_primary'
 * id - it is never re-attributed to another user without verifiable
 * provenance.
 */

import { graph } from './graphService';
import { redisClient } from './redisClient';
import { sqliteService } from './sqliteService';

const REDIS_PROFILE_PREFIX = 'silhouette:user_profile:';
const LEGACY_REDIS_KEY = 'silhouette:user_profile';
const REDIS_TTL = 86400 * 7; // 7 days

export interface UserProfile {
    id: string;
    name?: string;
    preferredLanguage: 'es' | 'en' | 'auto';
    preferences: Record<string, any>;
    facts: string[]; // User-stated facts
    extractedAt: number;
    lastInteraction: number;
}

export class UserProfileService {
    private profiles = new Map<string, UserProfile>();
    private readonly PROFILE_ID = 'user_primary';

    constructor() {
        // Warm the legacy primary profile on startup (best-effort)
        this.loadProfile().catch(e =>
            console.warn('[USER_PROFILE] Failed to load initial profile:', e)
        );
    }

    private resolveId(userId?: string): string {
        return userId && userId !== 'anonymous' ? userId : this.PROFILE_ID;
    }

    /**
     * Load profile from fastest available source.
     * Order: RAM -> SQLite (durable) -> Redis -> Neo4j (legacy singleton only)
     */
    async loadProfile(userId?: string): Promise<UserProfile | null> {
        const id = this.resolveId(userId);
        const cached = this.profiles.get(id);
        if (cached) return cached;

        // 1. SQLite: the durable source of truth
        try {
            const row = sqliteService.db.prepare(
                'SELECT * FROM user_profiles WHERE user_id = ?'
            ).get(id) as any;
            if (row) {
                const profile: UserProfile = {
                    id,
                    name: row.name ?? undefined,
                    preferredLanguage: row.preferred_language || 'auto',
                    preferences: JSON.parse(row.preferences || '{}'),
                    facts: JSON.parse(row.facts || '[]'),
                    extractedAt: row.extracted_at || Date.now(),
                    lastInteraction: row.last_interaction || Date.now()
                };
                this.profiles.set(id, profile);
                return profile;
            }
        } catch (e) {
            console.warn('[USER_PROFILE] SQLite load failed, trying cache/graph:', e);
        }

        // 2. Redis hot cache (per-user, then legacy global for user_primary)
        try {
            const cachedStr = await redisClient.get(REDIS_PROFILE_PREFIX + id)
                || (id === this.PROFILE_ID ? await redisClient.get(LEGACY_REDIS_KEY) : null);
            if (cachedStr) {
                const profile = JSON.parse(cachedStr);
                profile.id = id;
                this.profiles.set(id, profile);
                console.log(`[USER_PROFILE] ⚡ Loaded from Redis cache: ${profile?.name || 'Unknown'} (${id})`);
                // Re-durabilize into SQLite so a Redis loss can never lose it again
                await this.persistToSqlite(profile);
                return profile;
            }
        } catch (e) {
            console.warn('[USER_PROFILE] Redis cache miss, trying Neo4j...');
        }

        // 3. Neo4j: only the legacy singleton id is imported - never
        //    re-attribute another user's data without verifiable provenance.
        if (id === this.PROFILE_ID) {
            return this.loadFromGraph();
        }
        return null;
    }

    /**
     * Load the legacy singleton profile from Neo4j (cold storage)
     */
    async loadFromGraph(): Promise<UserProfile | null> {
        try {
            const result = await graph.runQuery(`
                MATCH (u:User {id: $id})
                RETURN u.name as name, u.preferredLanguage as preferredLanguage,
                       u.preferences as preferences, u.facts as facts,
                       u.extractedAt as extractedAt, u.lastInteraction as lastInteraction
            `, { id: this.PROFILE_ID });

            if (result && result.length > 0) {
                const row = result[0];
                const profile: UserProfile = {
                    id: this.PROFILE_ID,
                    name: row.name,
                    preferredLanguage: row.preferredLanguage || 'auto',
                    preferences: row.preferences ? JSON.parse(row.preferences) : {},
                    facts: row.facts ? JSON.parse(row.facts) : [],
                    extractedAt: row.extractedAt || Date.now(),
                    lastInteraction: row.lastInteraction || Date.now()
                };
                this.profiles.set(this.PROFILE_ID, profile);
                console.log(`[USER_PROFILE] ✅ Loaded from Neo4j: ${profile.name || 'Unknown'}`);

                // Re-durabilize + warm cache
                await this.persistToSqlite(profile);
                await this.cacheToRedis(profile);

                return profile;
            }
        } catch (e) {
            console.warn('[USER_PROFILE] Failed to load from graph:', e);
        }
        return null;
    }

    /**
     * Cache profile to Redis for fast access (best-effort; SQLite is durable)
     */
    private async cacheToRedis(profile: UserProfile): Promise<void> {
        try {
            await redisClient.set(REDIS_PROFILE_PREFIX + profile.id, JSON.stringify(profile), REDIS_TTL);
        } catch (e) {
            console.warn('[USER_PROFILE] Failed to cache to Redis:', e);
        }
    }

    /**
     * Durable write: SQLite upsert. This is the write that must never be lost.
     */
    private async persistToSqlite(profile: UserProfile): Promise<void> {
        sqliteService.db.prepare(`
            INSERT INTO user_profiles (user_id, name, preferred_language, preferences, facts, extracted_at, last_interaction)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                name = excluded.name,
                preferred_language = excluded.preferred_language,
                preferences = excluded.preferences,
                facts = excluded.facts,
                extracted_at = excluded.extracted_at,
                last_interaction = excluded.last_interaction
        `).run(profile.id, profile.name ?? null, profile.preferredLanguage,
            JSON.stringify(profile.preferences), JSON.stringify(profile.facts),
            profile.extractedAt, profile.lastInteraction);
    }

    /**
     * Extract user information from a message
     * Called on every user message to detect name, preferences, etc.
     */
    async extractFromMessage(message: string, userId?: string): Promise<boolean> {
        let updated = false;

        // Name extraction patterns
        const namePatterns = [
            /(?:me llamo|mi nombre es|soy)\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)/i,
            /(?:my name is|i'm|i am)\s+([A-Za-z]+)/i,
            /(?:llámame|call me)\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)/i
        ];

        for (const pattern of namePatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                const name = match[1].trim();
                const skipWords = ['el', 'la', 'un', 'una', 'the', 'a', 'an', 'que', 'de'];
                if (!skipWords.includes(name.toLowerCase()) && name.length > 1) {
                    await this.setName(name, userId);
                    updated = true;
                    break;
                }
            }
        }

        // Language preference detection
        if (message.toLowerCase().includes('habla en español') ||
            message.toLowerCase().includes('responde en español')) {
            await this.setPreference('preferredLanguage', 'es', userId);
            updated = true;
        } else if (message.toLowerCase().includes('speak in english') ||
            message.toLowerCase().includes('respond in english')) {
            await this.setPreference('preferredLanguage', 'en', userId);
            updated = true;
        }

        // "Remember" pattern detection
        const rememberPatterns = [
            /(?:recuerda que|remember that)\s+(.+)/i,
            /(?:no olvides que|don't forget that)\s+(.+)/i
        ];

        for (const pattern of rememberPatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
                await this.addFact(match[1].trim(), userId);
                updated = true;
            }
        }

        return updated;
    }

    /**
     * Get an existing profile or create an empty one (RAM + durable on persist)
     */
    private async getOrCreate(userId?: string): Promise<UserProfile> {
        const id = this.resolveId(userId);
        const existing = await this.loadProfile(userId);
        if (existing) return existing;
        const profile = this.createEmptyProfile(id);
        this.profiles.set(id, profile);
        return profile;
    }

    /**
     * Set user name
     */
    async setName(name: string, userId?: string): Promise<void> {
        console.log(`[USER_PROFILE] 👤 Setting user name: ${name} (${this.resolveId(userId)})`);

        const profile = await this.getOrCreate(userId);
        profile.name = name;
        profile.extractedAt = Date.now();
        await this.persist(profile);
    }

    /**
     * Set a user preference
     */
    async setPreference(key: string, value: any, userId?: string): Promise<void> {
        console.log(`[USER_PROFILE] ⚙️ Setting preference: ${key} = ${value} (${this.resolveId(userId)})`);

        const profile = await this.getOrCreate(userId);
        profile.preferences[key] = value;
        await this.persist(profile);
    }

    /**
     * Add a user-stated fact
     */
    async addFact(fact: string, userId?: string): Promise<void> {
        console.log(`[USER_PROFILE] 📝 Adding fact: ${fact} (${this.resolveId(userId)})`);

        const profile = await this.getOrCreate(userId);

        // Avoid duplicates
        if (!profile.facts.includes(fact)) {
            profile.facts.push(fact);
            // Keep only last 20 facts
            if (profile.facts.length > 20) {
                profile.facts = profile.facts.slice(-20);
            }
            await this.persist(profile);
        }
    }

    /**
     * Get profile context for prompt injection
     * This is called on EVERY chat request (cheap operation)
     */
    getProfileContext(userId?: string): string {
        const profile = this.profiles.get(this.resolveId(userId));
        if (!profile) return '';

        const parts: string[] = ['[USER PROFILE]'];

        if (profile.name) {
            parts.push(`- Name: ${profile.name}`);
        }

        if (profile.preferredLanguage && profile.preferredLanguage !== 'auto') {
            parts.push(`- Preferred Language: ${profile.preferredLanguage === 'es' ? 'Spanish' : 'English'}`);
        }

        // Include key preferences
        const prefs = Object.entries(profile.preferences);
        if (prefs.length > 0) {
            parts.push(`- Preferences: ${prefs.map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }

        // Include recent facts
        if (profile.facts.length > 0) {
            parts.push(`- User Facts: ${profile.facts.slice(-5).join('; ')}`);
        }

        return parts.length > 1 ? parts.join('\n') : '';
    }

    /**
     * Get just the user name (for quick checks)
     */
    getName(userId?: string): string | undefined {
        return this.profiles.get(this.resolveId(userId))?.name;
    }

    /**
     * Persist profile: SQLite (durable) -> Redis (hot cache) -> Neo4j (projection)
     */
    private async persist(profile: UserProfile): Promise<void> {
        profile.lastInteraction = Date.now();

        // 1. SQLite first: the durable write. If this fails, say so loudly.
        try {
            await this.persistToSqlite(profile);
        } catch (e) {
            console.error('[USER_PROFILE] ❌ DURABLE WRITE FAILED (SQLite):', e);
        }

        // 2. Update Redis hot cache
        await this.cacheToRedis(profile);

        // 3. Persist to Neo4j (cold-storage projection)
        try {
            await graph.runQuery(`
                MERGE (u:User {id: $id})
                SET u.name = $name,
                    u.preferredLanguage = $preferredLanguage,
                    u.preferences = $preferences,
                    u.facts = $facts,
                    u.extractedAt = $extractedAt,
                    u.lastInteraction = $lastInteraction
            `, {
                id: profile.id,
                name: profile.name || null,
                preferredLanguage: profile.preferredLanguage,
                preferences: JSON.stringify(profile.preferences),
                facts: JSON.stringify(profile.facts),
                extractedAt: profile.extractedAt,
                lastInteraction: profile.lastInteraction
            });
        } catch (e) {
            console.error('[USER_PROFILE] ❌ Failed to persist to Neo4j:', e);
        }
    }

    /**
     * Create empty profile
     */
    private createEmptyProfile(id: string = this.PROFILE_ID): UserProfile {
        return {
            id,
            preferredLanguage: 'auto',
            preferences: {},
            facts: [],
            extractedAt: Date.now(),
            lastInteraction: Date.now()
        };
    }
}

export const userProfile = new UserProfileService();
