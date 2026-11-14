/** Authoritative per-user SQLite state. Cache and graph are projections only.
 * Existing identity resolution/local legacy compatibility and data retention are
 * preserved. This is NOT a runtime owner/closure or power-loss durability proof.
 */
import { graph } from './graphService';
import { isInt } from 'neo4j-driver';
import { redisClient } from './redisClient';
import { sqliteService } from './sqliteService';
import { commitProfileMutation, importProfileOnlyIfAbsent, readProfileCurrent, prepareProfileMutation,
    type UserProfile, type ProfileMutation, type ProfileCommit, type ProfileCommitReceipt } from './memory/profileAuthority';
export type { UserProfile } from './memory/profileAuthority';
const REDIS_PROFILE_PREFIX = 'silhouette:user_profile:';
const LEGACY_REDIS_KEY = 'silhouette:user_profile';
const REDIS_TTL = 86400 * 7;
function legacyGraphTimestamp(value: unknown): number {
    if (value === undefined || value === null) return Date.now();
    if (isInt(value)) {
        if (!value.inSafeRange()) throw new RangeError('Legacy profile timestamp exceeds the safe integer range');
        value = value.toNumber();
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new TypeError('Invalid legacy profile timestamp');
    return value;
}
export type ProfileMutationReceipt = Readonly<ProfileCommitReceipt & {
    projections: Readonly<{ redis: 'FULFILLED' | 'REJECTED' | 'NOT_REQUESTED' | 'NOT_OBSERVED'; graph: 'FULFILLED' | 'REJECTED' | 'NOT_REQUESTED' | 'NOT_OBSERVED' }>;
}>;
export type ProfileExtractionReceipt = Readonly<{
    state: 'NO_CHANGES_SELECTED' | 'COMPLETED' | 'FAILED_NO_CONFIRMED_COMMITS' | 'FAILED_AFTER_CONFIRMED_COMMITS';
    completed: readonly ProfileMutationReceipt[];
    failedStep?: number;
    failedStepCommit: 'NOT_CONFIRMED' | 'SQLITE_COMMIT_RETURNED' | 'UNCHANGED_CONFIRMED' | 'NO_FAILED_STEP';
}>;
export type ProfileExtractionResult = { ok: true; updated: boolean; receipt: ProfileExtractionReceipt }
    | { ok: false; original: unknown; receipt: ProfileExtractionReceipt };
export class UserProfileService {
    // Last confirmed snapshots only. Not the current-state read authority.
    private profiles = new Map<string, UserProfile>();
    private readonly PROFILE_ID = 'user_primary';
    constructor() {
        this.loadProfile().catch(original => console.warn('[USER_PROFILE] Failed to load initial profile:', original));
    }
    private resolveId(userId?: string): string {
        return userId && userId !== 'anonymous' ? userId : this.PROFILE_ID;
    }
    /** Same legacy resolution, not a new identity grant or automatic migration. */
    public profileIdentity(userId?: string): string { return this.resolveId(userId); }
    private remember(profile: UserProfile): UserProfile {
        this.profiles.set(profile.id, profile);
        return profile;
    }
    async loadProfile(userId?: string): Promise<UserProfile | null> {
        const id = this.resolveId(userId);
        const current = readProfileCurrent(sqliteService.db, id);
        if (current) return this.remember(current);
        let cached: string | null = null;
        try {
            cached = await redisClient.get(REDIS_PROFILE_PREFIX + id)
                || (id === this.PROFILE_ID ? await redisClient.get(LEGACY_REDIS_KEY) : null);
        } catch (original) { console.warn('[USER_PROFILE] Redis cache unavailable, trying legacy graph:', original); }
        if (cached !== null) {
            let candidate: UserProfile | undefined;
            try {
                const parsed = JSON.parse(cached);
                if (parsed?.id !== id) throw new Error('Cached profile identity does not match its source key; no automatic remapping');
                candidate = parsed;
            }
            catch (original) { console.warn('[USER_PROFILE] Invalid cached profile JSON:', original); }
            // SQL admission/readback failure must not fall through as cache/RAM
            // success. A concurrent committed row wins, never a stale import.
            if (candidate) return this.remember(importProfileOnlyIfAbsent(sqliteService.db, id, candidate).snapshot);
        }
        if (id === this.PROFILE_ID) return this.loadFromGraph();
        // An await above allowed another instance to commit. Read SQL again.
        const latest = readProfileCurrent(sqliteService.db, id);
        return latest ? this.remember(latest) : null;
    }
    async loadFromGraph(): Promise<UserProfile | null> {
        const current = readProfileCurrent(sqliteService.db, this.PROFILE_ID);
        if (current) return this.remember(current);
        let candidate: UserProfile | undefined;
        try {
            const result = await graph.runQuery(`MATCH (u:User {id: $id})
                RETURN u.id as profileId, u.name as name, u.preferredLanguage as preferredLanguage,
                u.preferences as preferences, u.facts as facts,
                u.extractedAt as extractedAt, u.lastInteraction as lastInteraction`, { id: this.PROFILE_ID });
            if (result && result.length > 0 && result[0].profileId === this.PROFILE_ID) {
                const row = result[0];
                candidate = { id: this.PROFILE_ID, name: row.name,
                    preferredLanguage: row.preferredLanguage || 'auto',
                    preferences: row.preferences ? JSON.parse(row.preferences) : {},
                    facts: row.facts ? JSON.parse(row.facts) : [],
                    extractedAt: legacyGraphTimestamp(row.extractedAt), lastInteraction: legacyGraphTimestamp(row.lastInteraction) };
            }
        } catch (original) { console.warn('[USER_PROFILE] Failed to read legacy graph profile:', original); }
        if (candidate) {
            const committed = importProfileOnlyIfAbsent(sqliteService.db, this.PROFILE_ID, candidate);
            this.remember(committed.snapshot);
            // Exact confirmed snapshot only; warming is not a new authority.
            try { await redisClient.set(REDIS_PROFILE_PREFIX + committed.snapshot.id, JSON.stringify(committed.snapshot), REDIS_TTL); }
            catch (original) { console.warn('[USER_PROFILE] Failed to warm confirmed profile cache:', original); }
        }
        // Do not publish an old hydration response after a later commit.
        const latest = readProfileCurrent(sqliteService.db, this.PROFILE_ID);
        return latest ? this.remember(latest) : null;
    }
    private async projectCommitted(commit: ProfileCommit): Promise<ProfileMutationReceipt> {
        const profile = commit.snapshot; // Deep-frozen exact readback, not shared mutable draft.
        let redis: 'FULFILLED' | 'REJECTED' = 'FULFILLED';
        let projection: 'FULFILLED' | 'REJECTED' = 'FULFILLED';
        try { await redisClient.set(REDIS_PROFILE_PREFIX + profile.id, JSON.stringify(profile), REDIS_TTL); }
        catch (original) { redis = 'REJECTED'; console.warn('[USER_PROFILE] Failed to cache confirmed profile:', original); }
        try {
            await graph.runQuery(`MERGE (u:User {id: $id}) SET u.name=$name,
                u.preferredLanguage=$preferredLanguage, u.preferences=$preferences,
                u.facts=$facts, u.extractedAt=$extractedAt, u.lastInteraction=$lastInteraction`, {
                id: profile.id, name: profile.name || null, preferredLanguage: profile.preferredLanguage,
                preferences: JSON.stringify(profile.preferences), facts: JSON.stringify(profile.facts),
                extractedAt: profile.extractedAt, lastInteraction: profile.lastInteraction });
        } catch (original) { projection = 'REJECTED'; console.error('[USER_PROFILE] Failed to project confirmed profile:', original); }
        // FULFILLED means this call settled. It does not claim latest projection
        // ordering, actual backend persistence or another consumer's authority.
        return Object.freeze({ ...commit.receipt, projections: Object.freeze({ redis, graph: projection }) });
    }
    private async mutate(userId: string | undefined, mutation: ProfileMutation, observeCommit?: (commit: ProfileCommit) => void): Promise<ProfileMutationReceipt> {
        const id = this.resolveId(userId);
        const input = prepareProfileMutation(mutation); // Capture/validate before any cold import effect.
        // Preserve legacy cold import, fenced only-if-absent. The mutation itself
        // rebases its delta onto the LAST SQL row inside the write transaction.
        await this.loadProfile(userId);
        const commit = commitProfileMutation(sqliteService.db, id, input);
        observeCommit?.(commit); // Retain the receipt before any post-commit observer/projection can fail.
        this.remember(commit.snapshot);
        if (commit.receipt.state === 'UNCHANGED_CONFIRMED') return Object.freeze({ ...commit.receipt,
            projections: Object.freeze({ redis: 'NOT_REQUESTED' as const, graph: 'NOT_REQUESTED' as const }) });
        return this.projectCommitted(commit);
    }
    async setName(name: string, userId?: string): Promise<void> { await this.mutate(userId, { kind: 'name', name }); }
    async setPreference(key: string, value: any, userId?: string): Promise<void> { await this.mutate(userId, { kind: 'preference', key, value }); }
    async addFact(fact: string, userId?: string): Promise<void> { await this.mutate(userId, { kind: 'fact', fact }); }
    async extractFromMessage(message: string, userId?: string): Promise<boolean> {
        const result = await this.extractFromMessageWithReceipt(message, userId);
        if (result.ok === false) throw result.original;
        return result.updated;
    }
    async extractFromMessageWithReceipt(message: string, userId?: string): Promise<ProfileExtractionResult> {
        const completed: ProfileMutationReceipt[] = [];
        let step = 0;
        let lastStepCommit: ProfileExtractionReceipt['failedStepCommit'] = 'NOT_CONFIRMED';
        const apply = async (mutation: ProfileMutation) => {
            step++; lastStepCommit = 'NOT_CONFIRMED';
            let receiptIndex = -1;
            const receipt = await this.mutate(userId, mutation, commit => {
                lastStepCommit = commit.receipt.state;
                receiptIndex = completed.length;
                completed.push(Object.freeze({ ...commit.receipt,
                    projections: Object.freeze({ redis: 'NOT_OBSERVED', graph: 'NOT_OBSERVED' }) }));
            });
            completed[receiptIndex] = receipt;
        };
        try {
            const updated = await (async () => {
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
                            await apply({ kind: 'name', name });
                            updated = true;
                            break;
                        }
                    }
                }

                // Language preference detection
                if (message.toLowerCase().includes('habla en español') ||
                    message.toLowerCase().includes('responde en español')) {
                    await apply({ kind: 'preference', key: 'preferredLanguage', value: 'es' });
                    updated = true;
                } else if (message.toLowerCase().includes('speak in english') ||
                    message.toLowerCase().includes('respond in english')) {
                    await apply({ kind: 'preference', key: 'preferredLanguage', value: 'en' });
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
                        await apply({ kind: 'fact', fact: match[1].trim() });
                        updated = true;
                    }
                }

                return updated;
            })();
            return { ok: true, updated, receipt: Object.freeze({ state: completed.length ? 'COMPLETED' : 'NO_CHANGES_SELECTED',
                completed: Object.freeze([...completed]), failedStepCommit: 'NO_FAILED_STEP' }) };
        } catch (original) {
            return { ok: false, original, receipt: Object.freeze({
                state: completed.some(step => step.state === 'SQLITE_COMMIT_RETURNED') ? 'FAILED_AFTER_CONFIRMED_COMMITS' : 'FAILED_NO_CONFIRMED_COMMITS',
                completed: Object.freeze([...completed]), failedStep: step, failedStepCommit: lastStepCommit }) };
        }
    }
    getProfileContext(userId?: string): string {
        const profile = readProfileCurrent(sqliteService.db, this.resolveId(userId));
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

    /** Last confirmed snapshot in THIS instance, not a cross-instance current read. */
    getName(userId?: string): string | undefined { return this.profiles.get(this.resolveId(userId))?.name; }
}
export const userProfile = new UserProfileService();
