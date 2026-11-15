import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

export interface UserProfile {
    id: string;
    name?: string;
    preferredLanguage: 'es' | 'en' | 'auto';
    preferences: Record<string, any>;
    facts: string[];
    extractedAt: number;
    lastInteraction: number;
}
export type ProfileMutation = { kind: 'name'; name: string }
    | { kind: 'preference'; key: string; value: unknown }
    | { kind: 'fact'; fact: string };
export type ProfileCommitReceipt = Readonly<{
    state: 'SQLITE_COMMIT_RETURNED' | 'UNCHANGED_CONFIRMED';
    userId: string; snapshotDigest: string; observedAt: number;
    scope: 'THIS_CALL_ROW_READBACK_NOT_OPERATION_HISTORY_OR_POWERLOSS_PROOF';
}>;
export type ProfileCommit = Readonly<{ snapshot: UserProfile; receipt: ProfileCommitReceipt }>;

/** Data-only JSON, without getters, implicit toJSON, loss of undefined/nonfinite
 * values or caller references. Sorting keys changes no JSON data semantics.
 * Invalid caller input is rejected before BEGIN or any projection effect.
 */
function jsonData(value: unknown, ancestors = new Set<object>()): any {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object') throw new TypeError('Profile value must be JSON data');
    if (ancestors.has(value)) throw new TypeError('Cyclic profile JSON');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
        throw new TypeError('Profile JSON must contain only plain data');
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Symbol profile JSON key');
    ancestors.add(value);
    try {
        const output: any = Array.isArray(value) ? [] : Object.create(null);
        const keys = Array.isArray(value) ? Array.from({ length: value.length }, (_, i) => String(i)) : Object.keys(value).sort();
        if (Array.isArray(value) && Object.keys(value).some(key => !keys.includes(key)))
            throw new TypeError('Non-index profile array property');
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
                throw new TypeError('Profile JSON cannot contain getters or array holes');
            output[key] = jsonData(descriptor.value, ancestors);
        }
        return output;
    } finally { ancestors.delete(value); }
}
function canonical(value: unknown): string { return JSON.stringify(jsonData(value)); }
function userIdentity(id: string): void {
    if (typeof id !== 'string' || !id || id.includes('\0')) throw new TypeError('Explicit profile identity required');
}
function freezeData<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeData(child);
        Object.freeze(value);
    }
    return value;
}
function normalized(profile: UserProfile, id: string): UserProfile {
    userIdentity(id);
    if (profile.id !== id || (profile.name !== undefined && typeof profile.name !== 'string')
        || !['es', 'en', 'auto'].includes(profile.preferredLanguage)
        || !profile.preferences || typeof profile.preferences !== 'object' || Array.isArray(profile.preferences)
        || !Array.isArray(profile.facts) || profile.facts.some(fact => typeof fact !== 'string')
        || !Number.isSafeInteger(profile.extractedAt) || profile.extractedAt < 0
        || !Number.isSafeInteger(profile.lastInteraction) || profile.lastInteraction < 0)
        throw new TypeError('Invalid authoritative profile data');
    return { id, ...(profile.name === undefined ? {} : { name: profile.name }),
        preferredLanguage: profile.preferredLanguage, preferences: jsonData(profile.preferences),
        facts: jsonData(profile.facts), extractedAt: profile.extractedAt, lastInteraction: profile.lastInteraction };
}
function decode(row: any, id: string): UserProfile {
    return normalized({ id, name: row.name ?? undefined, preferredLanguage: row.preferred_language,
        preferences: JSON.parse(row.preferences), facts: JSON.parse(row.facts),
        extractedAt: row.extracted_at, lastInteraction: row.last_interaction }, id);
}
function readProfileRow(db: Database.Database, id: string): UserProfile | null {
    userIdentity(id);
    const row = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(id);
    return row ? freezeData(decode(row, id)) : null;
}
export function readProfileCurrent(db: Database.Database, id: string): UserProfile | null {
    if (db.inTransaction) throw new Error('Current profile read cannot certify an outer uncommitted transaction');
    return readProfileRow(db, id);
}

function writeProfile(db: Database.Database, profile: UserProfile): void {
    db.prepare(`INSERT INTO user_profiles (user_id, name, preferred_language, preferences, facts, extracted_at, last_interaction)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,
        preferred_language=excluded.preferred_language, preferences=excluded.preferences,
        facts=excluded.facts, extracted_at=excluded.extracted_at, last_interaction=excluded.last_interaction`)
        .run(profile.id, profile.name ?? null, profile.preferredLanguage, canonical(profile.preferences),
            canonical(profile.facts), profile.extractedAt, profile.lastInteraction);
}
/** No async callback, implicit nested savepoint receipt or global policy change.
 * RMW reads the latest row UNDER the SQLite write lock, across service instances
 * and connections. Rollback failure retains both actual errors, not a fake PASS.
 */
function transaction(db: Database.Database, id: string, select: (current: UserProfile | null) => { draft: UserProfile; write: boolean }): ProfileCommit {
    userIdentity(id);
    if (db.inTransaction) throw new Error('Profile receipt requires an independent SQLite commit, not a nested transaction');
    db.exec('BEGIN IMMEDIATE');
    try {
        const chosen = select(readProfileRow(db, id));
        const expected = normalized(chosen.draft, id);
        if (chosen.write) writeProfile(db, expected);
        const readback = readProfileRow(db, id);
        if (!readback || canonical(readback) !== canonical(expected)) throw new Error('Authoritative profile readback mismatch');
        const result: ProfileCommit = Object.freeze({ snapshot: readback, receipt: Object.freeze({
            state: chosen.write ? 'SQLITE_COMMIT_RETURNED' as const : 'UNCHANGED_CONFIRMED' as const,
            userId: id, snapshotDigest: createHash('sha256').update(canonical(readback)).digest('hex'),
            observedAt: Date.now(), scope: 'THIS_CALL_ROW_READBACK_NOT_OPERATION_HISTORY_OR_POWERLOSS_PROOF' as const }) });
        db.exec('COMMIT');
        return result;
    } catch (original) {
        if (db.inTransaction) {
            try { db.exec('ROLLBACK'); }
            catch (rollback) { throw new AggregateError([original, rollback], 'Profile write and rollback both failed', { cause: original }); }
        }
        throw original;
    }
}
export function importProfileOnlyIfAbsent(db: Database.Database, id: string, candidate: UserProfile): ProfileCommit {
    // Validate before the transaction. Existing concurrent SQL state wins.
    const input = normalized(candidate, id);
    return transaction(db, id, current => ({ draft: current ?? input, write: current === null }));
}
export function prepareProfileMutation(mutation: ProfileMutation): ProfileMutation {
    // Capture external values before effects; no draft read outside the lock.
    const input = jsonData(mutation) as ProfileMutation;
    if (input.kind === 'name' ? typeof input.name !== 'string'
        : input.kind === 'fact' ? typeof input.fact !== 'string'
        : input.kind === 'preference' ? typeof input.key !== 'string' || !Object.prototype.hasOwnProperty.call(input, 'value')
        : true) throw new TypeError('Invalid explicit profile mutation');
    return freezeData(input);
}
export function commitProfileMutation(db: Database.Database, id: string, mutation: ProfileMutation): ProfileCommit {
    userIdentity(id);
    const input = prepareProfileMutation(mutation);
    return transaction(db, id, current => {
        const now = Date.now();
        const draft: UserProfile = current ? normalized(current, id) : { id, preferredLanguage: 'auto' as const,
            preferences: Object.create(null), facts: [], extractedAt: now, lastInteraction: now };
        if (input.kind === 'fact' && draft.facts.includes(input.fact)) return { draft, write: false };
        if (input.kind === 'name') { draft.name = input.name; draft.extractedAt = now; }
        else if (input.kind === 'preference') draft.preferences[input.key] = input.value;
        else { draft.facts.push(input.fact); if (draft.facts.length > 20) draft.facts = draft.facts.slice(-20); }
        draft.lastInteraction = now;
        return { draft, write: true };
    });
}
