import { AsyncLocalStorage } from 'node:async_hooks';
import { AdmissionClosed, OwnershipConflict } from './lifecycle/host';
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
    private admissionOpen = true;
    private readonly originalContext = new AsyncLocalStorage<{ live: boolean; operation: Operation }>();
    private readonly originalAsync = new Set<Promise<unknown>>();
    private readonly originalExpiries = new Set<Promise<void>>();
    private readonly originalClients: { client: any; close: () => Promise<void>; fallback: () => Promise<void> }[] = [];
    private closeOwner: Promise<void> | undefined;

    private original<T>(name: string, body: (operation: Operation) => T): T {
        const continuation = this.originalContext.getStore();
        if (continuation) {
            if (!continuation.live) throw new AdmissionClosed('redis:late-original-continuation');
            return body(continuation.operation);
        }
        if (!this.admissionOpen) throw new AdmissionClosed('redis:' + name);
        return this.ownership.invoke(name, operation => {
            const context = { live: true, operation };
            let value: T;
            try { value = this.originalContext.run(context, () => body(operation)); }
            catch (original) { context.live = false; throw original; }
            if (value instanceof Promise) {
                this.originalAsync.add(value);
                const settled = () => { context.live = false; this.originalAsync.delete(value); };
                void value.then(settled, settled); // Observe the SAME promise/error.
            } else context.live = false;
            return value;
        });
    }

    /** Public SDK clients, including an allocation later rejected by connect.
     * The SDK owns/replaces raw sockets internally. This is NOT a raw socket or
     * private reconnect-loop join. That native frontier stays explicitly open.
     */
    private retainOriginalClient(acquired: any) {
        let closeOwner: Promise<void> | undefined;
        let fallbackOwner: Promise<void> | undefined;
        const record = {
            client: acquired,
            fallback: (): Promise<void> => {
                // Exact original destructive fallback, once; does not acquire
                // terminal-close authority or pretend queued requests drained.
                if (!fallbackOwner) {
                    try { fallbackOwner = acquired.disconnect(); }
                    catch (original) { fallbackOwner = Promise.reject(original); }
                    void fallbackOwner.catch(() => undefined);
                }
                return fallbackOwner;
            },
            close: (): Promise<void> => {
                if (!closeOwner) {
                    closeOwner = (async () => {
                        if (fallbackOwner) await fallbackOwner;
                        if (acquired.isOpen) await acquired.close();
                        // isOpen=false is ONLY the public SDK logical state.
                        // close resolves when socket.destroy() is called, not
                        // when a raw socket close event or retry task is joined.
                    })();
                    void closeOwner.catch(() => undefined);
                }
                return closeOwner;
            }
        };
        this.originalClients.push(record);
        return record;
    }

    public originalNativeFrontier() {
        return { admissionOpen: this.admissionOpen, pendingOriginalRoots: this.originalAsync.size,
            pendingOriginalExpiries: this.originalExpiries.size,
            clients: this.originalClients.map(record => ({ isOpen: record.client.isOpen, isReady: record.client.isReady })),
            sdkSocketAndReconnectClosure: this.originalClients.length ? 'UNSUPPORTED_PUBLIC_JOIN_API' : 'NOT_ACQUIRED_IN_THIS_INSTANCE' };
    }
    private isConnected: boolean = false;
    private connectingOwner: Promise<void> | undefined;
    private isMock: boolean = false;
    private mockStore: Map<string, string> = new Map();

    constructor() {
        // Client is initialized lazily in connect(). Host seal also closes roots.
        this.ownership.onSeal(() => { this.admissionOpen = false; });
    }

    /** Returns true if running in mock (in-memory) mode */
    public isMockMode(): boolean {
        return this.isMock;
    }

    public connect() {
        return this.original('original-connect', operation => this.connectOriginal(operation));
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
                const originalClient = this.retainOriginalClient(acquired);
                this.ownership.acquire(reservation, acquired, originalClient.close,
                    () => ({ source: 'redis:service-client-candidate', disposition: 'INCOMPLETE',
                        reason: 'SDK_PRIVATE_SOCKET_AND_RECONNECT_JOIN_UNSUPPORTED' }));

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
                        await this.originalClients.find(record => record.client === this.client)!.fallback();
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

    /** Terminal close: upstream admissions/borrowers must already be joined.
     * Public and registered close share the exact memoized per-client closure.
     * This improves original request ownership but does not close the SDK's
     * unsupported private transport/reconnect frontier or the global marker.
     */
    public disconnect(): Promise<void> {
        if (this.originalContext.getStore()?.live)
            throw new OwnershipConflict('Redis close cannot join its own original request');
        if (this.closeOwner) return this.closeOwner;
        this.admissionOpen = false;
        this.closeOwner = (async () => {
            await Promise.allSettled([...this.originalAsync]);
            // Original fallback lock expiry remains at its original duration;
            // join it, do not cancel it or fabricate a completed child guard.
            await Promise.allSettled([...this.originalExpiries]);
            const failures: unknown[] = [];
            for (const record of this.originalClients) {
                try { await record.close(); }
                catch (original) { failures.push(original); this.ownership.failure('service-original-close', original); }
            }
            this.client = null; this.isConnected = false;
            if (this.originalClients.length)
                this.ownership.unknown('SDK_PRIVATE_SOCKET_AND_RECONNECT_JOIN_UNSUPPORTED');
            if (failures.length) throw new AggregateError(failures, 'Original Redis client close failed');
        })();
        void this.closeOwner.catch(() => undefined);
        return this.closeOwner;
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
        return this.original('original-command-set', operation => this.setOriginal(operation, key, value, ttl));
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
        return this.original('original-command-get', operation => this.getOriginal(operation, key));
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
        return this.original('original-command-del', operation => this.delOriginal(operation, key));
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
        return this.original('original-command-keys', operation => this.keysOriginal(operation, pattern));
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
        return this.original('original-command-acquireLock', operation => this.acquireLockOriginal(operation, lockKey, ttlMs));
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
                let finish!: () => void;
                const originalExpiry = new Promise<void>(resolve => { finish = resolve; });
                this.originalExpiries.add(originalExpiry);
                this.originalContext.exit(() => setTimeout(() => {
                    try { this.ownership.invokeChild(expiry, () => this.mockStore.delete(lockKey)); }
                    finally { this.originalExpiries.delete(originalExpiry); finish(); }
                }, ttlMs));
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
        return this.original('original-command-releaseLock', operation => this.releaseLockOriginal(operation, lockKey));
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
