/**
 * USER PROFILE SERVICE
 * =====================
 * Dedicated service for managing user-specific information.
 * Based on best practices from Claude, Gemini CLI, and conversational AI research.
 * 
 * Key principles:
 * - Separate user profile from general memory
 * - Persist across sessions (Redis hot-cache + Neo4j cold storage)
 * - Cheap to query (always included in context)
 * 
 * Storage Hierarchy:
 * 1. RAM (instant) - this.profile
 * 2. Redis (fast, survives app restart) - hot cache
 * 3. Neo4j (persistent, survives container restart) - cold storage
 */

import { graph } from './graphService';
import { redisClient } from './redisClient';

const REDIS_PROFILE_KEY = 'silhouette:user_profile';
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

class UserProfileService {
    private profile: UserProfile | null = null;
    private readonly PROFILE_ID = 'user_primary';

    constructor() {
        // Load profile on startup (try Redis first, then Neo4j)
        this.loadProfile().catch(e =>
            console.warn('[USER_PROFILE] Failed to load initial profile:', e)
        );
    }

    /**
     * Load profile from fastest available source
     * Order: RAM -> Redis -> Neo4j
     */
    async loadProfile(): Promise<UserProfile | null> {
        // Already in RAM?
        if (this.profile) return this.profile;

        // Try Redis first (faster than Neo4j)
        try {
            const cached = await redisClient.get(REDIS_PROFILE_KEY);
            if (cached) {
                this.profile = JSON.parse(cached);
                console.log(`[USER_PROFILE] ⚡ Loaded from Redis cache: ${this.profile?.name || 'Unknown'}`);
                return this.profile;
            }
        } catch (e) {
            console.warn('[USER_PROFILE] Redis cache miss, trying Neo4j...');
        }

        // Fallback to Neo4j
        return this.loadFromGraph();
    }

    /**
     * Load user profile from Neo4j (cold storage)
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
                this.profile = {
                    id: this.PROFILE_ID,
                    name: row.name,
                    preferredLanguage: row.preferredLanguage || 'auto',
                    preferences: row.preferences ? JSON.parse(row.preferences) : {},
                    facts: row.facts ? JSON.parse(row.facts) : [],
                    extractedAt: row.extractedAt || Date.now(),
                    lastInteraction: row.lastInteraction || Date.now()
                };
                console.log(`[USER_PROFILE] ✅ Loaded from Neo4j: ${this.profile.name || 'Unknown'}`);

                // Warm up Redis cache
                await this.cacheToRedis();

                return this.profile;
            }
        } catch (e) {
            console.warn('[USER_PROFILE] Failed to load from graph:', e);
        }
        return null;
    }

    /**
     * Cache profile to Redis for fast access
     */
    private async cacheToRedis(): Promise<void> {
        if (!this.profile) return;
        try {
            await redisClient.set(REDIS_PROFILE_KEY, JSON.stringify(this.profile), REDIS_TTL);
            console.log('[USER_PROFILE] ⚡ Cached to Redis');
        } catch (e) {
            console.warn('[USER_PROFILE] Failed to cache to Redis:', e);
        }
    }

    /**
     * Extract user information from a message
     * Called on every user message to detect name, preferences, etc.
     */
    async extractFromMessage(message: string): Promise<boolean> {
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
                    await this.setName(name);
                    updated = true;
                    break;
                }
            }
        }

        // Language preference detection
        if (message.toLowerCase().includes('habla en español') ||
            message.toLowerCase().includes('responde en español')) {
            await this.setPreference('preferredLanguage', 'es');
            updated = true;
        } else if (message.toLowerCase().includes('speak in english') ||
            message.toLowerCase().includes('respond in english')) {
            await this.setPreference('preferredLanguage', 'en');
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
                await this.addFact(match[1].trim());
                updated = true;
            }
        }

        return updated;
    }

    /**
     * Set user name
     */
    async setName(name: string): Promise<void> {
        console.log(`[USER_PROFILE] 👤 Setting user name: ${name}`);

        if (!this.profile) {
            this.profile = this.createEmptyProfile();
        }

        this.profile.name = name;
        this.profile.extractedAt = Date.now();
        await this.persist();
    }

    /**
     * Set a user preference
     */
    async setPreference(key: string, value: any): Promise<void> {
        console.log(`[USER_PROFILE] ⚙️ Setting preference: ${key} = ${value}`);

        if (!this.profile) {
            this.profile = this.createEmptyProfile();
        }

        this.profile.preferences[key] = value;
        await this.persist();
    }

    /**
     * Add a user-stated fact
     */
    async addFact(fact: string): Promise<void> {
        console.log(`[USER_PROFILE] 📝 Adding fact: ${fact}`);

        if (!this.profile) {
            this.profile = this.createEmptyProfile();
        }

        // Avoid duplicates
        if (!this.profile.facts.includes(fact)) {
            this.profile.facts.push(fact);
            // Keep only last 20 facts
            if (this.profile.facts.length > 20) {
                this.profile.facts = this.profile.facts.slice(-20);
            }
            await this.persist();
        }
    }

    /**
     * Get profile context for prompt injection
     * This is called on EVERY chat request (cheap operation)
     */
    getProfileContext(): string {
        if (!this.profile) return '';

        const parts: string[] = ['[USER PROFILE]'];

        if (this.profile.name) {
            parts.push(`- Name: ${this.profile.name}`);
        }

        if (this.profile.preferredLanguage && this.profile.preferredLanguage !== 'auto') {
            parts.push(`- Preferred Language: ${this.profile.preferredLanguage === 'es' ? 'Spanish' : 'English'}`);
        }

        // Include key preferences
        const prefs = Object.entries(this.profile.preferences);
        if (prefs.length > 0) {
            parts.push(`- Preferences: ${prefs.map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }

        // Include recent facts
        if (this.profile.facts.length > 0) {
            parts.push(`- User Facts: ${this.profile.facts.slice(-5).join('; ')}`);
        }

        return parts.length > 1 ? parts.join('\n') : '';
    }

    /**
     * Get just the user name (for quick checks)
     */
    getName(): string | undefined {
        return this.profile?.name;
    }

    /**
     * Persist profile to Redis (hot) and Neo4j (cold)
     */
    private async persist(): Promise<void> {
        if (!this.profile) return;

        this.profile.lastInteraction = Date.now();

        // 1. Update Redis cache first (fast)
        await this.cacheToRedis();

        // 2. Persist to Neo4j (cold storage)
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
                id: this.PROFILE_ID,
                name: this.profile.name || null,
                preferredLanguage: this.profile.preferredLanguage,
                preferences: JSON.stringify(this.profile.preferences),
                facts: JSON.stringify(this.profile.facts),
                extractedAt: this.profile.extractedAt,
                lastInteraction: this.profile.lastInteraction
            });

            console.log('[USER_PROFILE] ✅ Persisted to Neo4j');
        } catch (e) {
            console.error('[USER_PROFILE] ❌ Failed to persist to Neo4j:', e);
        }
    }

    /**
     * Create empty profile
     */
    private createEmptyProfile(): UserProfile {
        return {
            id: this.PROFILE_ID,
            preferredLanguage: 'auto',
            preferences: {},
            facts: [],
            extractedAt: Date.now(),
            lastInteraction: Date.now()
        };
    }
}

export const userProfile = new UserProfileService();
