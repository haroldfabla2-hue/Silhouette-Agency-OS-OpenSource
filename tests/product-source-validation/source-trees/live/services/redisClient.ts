import { admitEvaluatedRedis, bindEvaluatedRedis, failEvaluatedRedis } from './lifecycle/runtimeStopBindings';
import { preserveOriginal } from './lifecycle/preserveOriginal';
import { redisOwner } from './lifecycle/preparationBindings';
import type { Operation } from './lifecycle/host';
import { REDIS_CONFIG } from '../constants';
import { incidentRegistry } from './incidentRegistry';

const MOCK_STORE_MAX_SIZE = 10000; // Eviction threshold for in-memory fallback

class RedisService {
    private readonly ownership = redisOwner();
    private client: any;
    private isConnected: boolean = false;
    private connectingOwner: Promise<void> | undefined;
    private isMock: boolean = false;
    private mockStore: Map<string, string> = new Map();

    constructor() {
        // Client is initialized lazily in connect()
    }

    /** Returns true if running in mock (in-memory) mode */
    public isMockMode(): boolean {
        return this.isMock;
    }

    public connect() {
        return this.ownership.invoke('original-connect', operation => this.connectOriginal(operation));
    }
    private connectOriginal(operation: Operation): Promise<void> {
        // Install before the original dynamic import can resume. Every admitted
        // caller retains the same original attempt instead of allocating another
        // client, or returning early merely because its candidate exists.
        if (this.connectingOwner) return this.connectingOwner;
        const original = this.connectAttemptOriginal(operation);
        this.connectingOwner = original;
        const release = () => {
            if (this.connectingOwner === original) this.connectingOwner = undefined;
        };
        // Observe both settlements without replacing the original Promise/error.
        void original.then(release, release);
        return original;
    }
    private async connectAttemptOriginal(operation: Operation): Promise<void> {
        // 1. Browser Safety Check: Never run in browser
        if (typeof window !== 'undefined') return;

        // 2. Singleton Check
        if (!this.client && !this.isMock) {
            const incidentFailures: unknown[]=[];
            // Only the exact awaited transport connect may select an operational
            // task outcome. Allocation/bookkeeping/cleanup are still ownership
            // failures. This does not acknowledge or erase any failure record.
            let originalConnectRejected = false;
            let connectAttemptOpen = false;
            let terminalRetryFailure: Error | undefined;
            const exactOperationalConnectError = (original: unknown): boolean => {
                if (original === terminalRetryFailure && terminalRetryFailure !== undefined) return true;
                if (!original || typeof original !== 'object') return false;
                const descriptor = Object.getOwnPropertyDescriptor(original, 'code');
                return !!descriptor && 'value' in descriptor
                    && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND'].includes(descriptor.value);
            };
            try {
                // 3. Dynamic Import: Prevents bundler from including 'redis' package in frontend build
                const redisModule = await import('redis');
                const createClient = redisModule.createClient;

                const redisUrl = `redis://${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`;
                console.log(`[REDIS] Connecting to ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}...`);

                const reservation = this.ownership.reserveResource(operation, 'service-client-candidate');
                try { this.client = createClient({
                    url: redisUrl,
                    password: REDIS_CONFIG.password || undefined,
                    socket: {
                        connectTimeout: 5000,
                        reconnectStrategy: (retries: number) => {
                            if (retries > 3) {
                                console.warn('[REDIS] Max retries reached. Switching to In-Memory Fallback.');
                                terminalRetryFailure = new Error('Max retries reached');
                                return terminalRetryFailure;
                            }
                            return Math.min(retries * 100, 3000);
                        }
                    }
                }); }
                catch (original) {
                    preserveOriginal(this.ownership, 'client-allocation-failed', () => this.ownership.releaseUnused(reservation));
                    throw original;
                }
                const acquired = this.client;
                this.ownership.acquire(reservation, acquired, async () => {
                    // RedisService owns this exact createClient result. A bus or
                    // borrowed bridge never closes it. Original public/fallback
                    // disconnect is still unresolved and separately flagged.
                    if (acquired.isOpen) await acquired.close();
                }, () => ({ source: 'redis:service-client-candidate',
                    disposition: acquired.isOpen ? 'INCOMPLETE' : 'CLOSED',
                    ...(acquired.isOpen ? { reason: 'REDIS_SERVICE_CLIENT_STILL_OPEN' } : {}) }));

                this.client.on('error', (err: any) => {
                    // Only log if not already in mock mode to avoid spam
                    if (connectAttemptOpen && this.client === acquired && exactOperationalConnectError(err))
                        this.ownership.taskFailed('service-client:EMITTED_ERROR', err);
                    else this.ownership.failure('service-client:EMITTED_ERROR', err);
                    if (!this.isMock) console.error('[REDIS] Client Error:', err.message);
                });

                this.client.on('connect', () => {
                    console.log('[REDIS] Connected (Warm Persistence Active)');
                    this.isConnected = true;
                    // [R6] recovery closes the SAME incident the fallback opened
                    try {incidentRegistry.resolveIncidents('redis');}
                    catch(original) {
                        this.ownership.failure('service-connected:ORIGINAL_INCIDENT_RESOLVE_FAILED',original);
                        incidentFailures.push(original);
                    }
                });

                connectAttemptOpen = true;
                try { await acquired.connect(); }
                catch (original) { originalConnectRejected = true; throw original; }
                finally { connectAttemptOpen = false; }
            } catch (e: any) {
                if (originalConnectRejected && exactOperationalConnectError(e))
                    this.ownership.taskFailed('service-connect:MEMORY_AVAILABILITY_NOT_DURABILITY_FALLBACK', e);
                else this.ownership.failure('service-connect:MEMORY_AVAILABILITY_NOT_DURABILITY_FALLBACK', e);
                console.warn(`[REDIS] Connection Failed: ${e.message || e}. Using In-Memory Fallback (data lost on restart).`);
                if (this.client) {
                    try {
                        this.ownership.unknown('service-fallback:ORIGINAL_DESTRUCTIVE_DISCONNECT_NOT_QUIESCENCE_PROOF');
                        await this.client.disconnect();
                    } catch (err) {
                        this.ownership.failure('service-fallback:ORIGINAL_DISCONNECT_FAILED', err);
                        console.error("[REDIS] Failed to disconnect during fallback:", err);
                    }
                    this.client = null;
                }
                this.isMock = true;
                this.isConnected = true;
                // [R6] durable incident: in-memory fallback loses data on restart
                try {
                    incidentRegistry.recordIncident('redis', 'outage',
                        `Redis unavailable: ${e.message || e}. Using in-memory fallback.`,
                        'Cached data is lost on restart while the fallback is active.');
                }catch(original) {
                    this.ownership.failure('service-fallback:ORIGINAL_INCIDENT_RECORD_FAILED',original);
                    // Preserve BOTH original outage and persistence failure.
                    // Availability fallback is not a durable incident receipt.
                    throw new AggregateError([e,original],'Redis outage incident persistence failed',{cause:e});
                }
            }
            // A synchronous connected-event observer must not escape EventEmitter
            // unowned, or misclassify an incident failure as Redis connect failure.
            if(incidentFailures.length)throw new AggregateError(incidentFailures,'Redis connected incident resolution failed');
        }
    }

    public async disconnect() {
        // Preserve original public behavior in this source checkpoint. This
        // direct path is not accepted final ownership/quiescence semantics.
        this.ownership.unknown('public-disconnect:ORIGINAL_PATH_NOT_QUIESCENCE_PROOF');
        if (this.client) {
            try {
                await this.client.disconnect();
                console.log('[REDIS] Disconnected.');
            } catch (err) {
                this.ownership.failure('public-disconnect:ORIGINAL_CLOSE_FAILED', err);
                console.error("[REDIS] Failed to disconnect:", err);
            }
            this.client = null;
        }
        this.isConnected = false;
    }

    /** Evict oldest entries when mock store exceeds max size */
    private evictMockStore() {
        if (this.mockStore.size <= MOCK_STORE_MAX_SIZE) return;
        const keysToDelete = Array.from(this.mockStore.keys()).slice(0, Math.floor(MOCK_STORE_MAX_SIZE * 0.2));
        for (const key of keysToDelete) {
            this.mockStore.delete(key);
        }
    }

    /** Lazy connect: first real operation establishes the connection (or the
     *  in-memory fallback). Keeps module import side-effect free - a pending
     *  socket at import time raced test-worker teardown and crashed CI
     *  intermittently. connect() is idempotent; incident persistence failures propagate with
     * original errors retained rather than escaping EventEmitter unowned. */
    private async ensureConnected(operation: Operation): Promise<void> {
        // Fixed original command continuation, not a new root after seal.
        // The transport 'connect' event can precede connect() readiness. Join
        // the original attempt even if that event already changed isConnected.
        if (this.connectingOwner || !this.isConnected) await this.connectOriginal(operation);
    }

    public set(key: string, value: string, ttl?: number) {
        return this.ownership.invoke('original-command-set', operation => this.setOriginal(operation, key, value, ttl));
    }
    private async setOriginal(operation: Operation, key: string, value: string, ttl?: number) {
        await this.ensureConnected(operation);
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.set(key, value);
            this.evictMockStore();
            return;
        }

        if (this.client) {
            if (ttl) {
                await this.client.set(key, value, { EX: ttl });
            } else {
                await this.client.set(key, value);
            }
        }
    }

    public get(key: string): Promise<string | null> {
        return this.ownership.invoke('original-command-get', operation => this.getOriginal(operation, key));
    }
    private async getOriginal(operation: Operation, key: string): Promise<string | null> {
        await this.ensureConnected(operation);
        if (!this.isConnected) return null;

        if (this.isMock) {
            return this.mockStore.get(key) || null;
        }

        return this.client ? await this.client.get(key) : null;
    }

    public del(key: string) {
        return this.ownership.invoke('original-command-del', operation => this.delOriginal(operation, key));
    }
    private async delOriginal(operation: Operation, key: string) {
        await this.ensureConnected(operation);
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.delete(key);
            return;
        }

        if (this.client) await this.client.del(key);
    }

    public keys(pattern: string): Promise<string[]> {
        return this.ownership.invoke('original-command-keys', operation => this.keysOriginal(operation, pattern));
    }
    private async keysOriginal(operation: Operation, pattern: string): Promise<string[]> {
        await this.ensureConnected(operation);
        if (!this.isConnected) return [];

        if (this.isMock) {
            // Proper glob-to-regex: escape special chars, convert * to .*
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            const regex = new RegExp('^' + escaped + '$');
            return Array.from(this.mockStore.keys()).filter(k => regex.test(k));
        }

        return this.client ? await this.client.keys(pattern) : [];
    }

    // ── Distributed Locks ──
    /**
     * Tries to acquire a distributed lock using Redis SET NX.
     * @param lockKey The unique key for the lock
     * @param ttlMs Time to live in milliseconds (avoids deadlocks)
     * @returns boolean True if lock acquired, false if already locked
     */
    public acquireLock(lockKey: string, ttlMs: number): Promise<boolean> {
        return this.ownership.invoke('original-command-acquireLock', operation => this.acquireLockOriginal(operation, lockKey, ttlMs));
    }
    private async acquireLockOriginal(operation: Operation, lockKey: string, ttlMs: number): Promise<boolean> {
        const expiry = this.ownership.reserveChild(operation, 'original-memory-lock-expiry');
        let scheduled = false, failed = false, originalError: unknown;
        try {
            await this.ensureConnected(operation);
            if (!this.isConnected) return true; // Fallback to allowing execution if no redis

            if (this.isMock) {
                // Mock implementation of SET NX EX
                if (this.mockStore.has(lockKey)) return false;
                this.mockStore.set(lockKey, 'locked');
                setTimeout(() => this.ownership.invokeChild(expiry, () => this.mockStore.delete(lockKey)), ttlMs);
                scheduled = true;
                return true;
            }

            try {
                // SET key value NX PX ttl
                const result = await this.client.set(lockKey, 'locked', {
                    NX: true,
                    PX: ttlMs
                });
                return result === 'OK';
            } catch (e) {
                this.ownership.failure('command-acquireLock:ORIGINAL_CAUGHT_FAILURE', e);
                console.error('[REDIS] Error acquiring lock:', e);
                return false;
            }
        } catch (original) { failed = true; originalError = original; throw original; }
        finally {
            if (!scheduled) preserveOriginal(this.ownership, 'lock-expiry-original-guard', () => {
                if (failed) this.ownership.abandonChild(expiry, originalError);
                else this.ownership.skipChild(expiry, 'ORIGINAL_GUARD_NOT_SELECTED');
            });
        }
    }

    /**
     * Releases a distributed lock.
     */
    public releaseLock(lockKey: string): Promise<void> {
        return this.ownership.invoke('original-command-releaseLock', operation => this.releaseLockOriginal(operation, lockKey));
    }
    private async releaseLockOriginal(operation: Operation, lockKey: string): Promise<void> {
        await this.ensureConnected(operation);
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.delete(lockKey);
            return;
        }

        try {
            await this.client.del(lockKey);
        } catch (e) {
            this.ownership.failure('command-releaseLock:ORIGINAL_CAUGHT_FAILURE', e);
            console.error('[REDIS] Error releasing lock:', e);
        }
    }
}

const runtimeConstructionPermit = admitEvaluatedRedis();
export const redisClient = (() => {
    try {
        const original = new RedisService();
        bindEvaluatedRedis(runtimeConstructionPermit,() => original.disconnect());
        return original;
    } catch (error) {
        failEvaluatedRedis(runtimeConstructionPermit,error);
        throw error;
    }
})();
