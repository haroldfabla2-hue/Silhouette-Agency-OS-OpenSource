import { REDIS_CONFIG } from '../constants';
import { incidentRegistry } from './incidentRegistry';
import { acceptanceBoot } from './security/bootMode';

const MOCK_STORE_MAX_SIZE = 10000; // Eviction threshold for in-memory fallback

class RedisService {
    private client: any;
    private isConnected: boolean = false;
    private isMock: boolean = false;
    private mockStore: Map<string, string> = new Map();
    // Single-flight connect: concurrent connect() callers share one attempt,
    // and disconnect() can settle an in-flight attempt instead of racing it.
    private connectTask: Promise<void> | null = null;
    // Single-flight disconnect: concurrent disconnect() callers share one
    // close of the same client, and connect() waits out an in-flight close
    // so no operation rides a closing handle.
    private disconnectTask: Promise<void> | null = null;
    // Failed-close receipt: set when a real disconnect() of an open client
    // throws. The handle stays OWNED (never silently discarded); the next
    // connect() or disconnect() retries the close before anything else.
    private closeFailed: boolean = false;
    // One-time observability receipt ONLY. The policy check itself is made
    // LIVE (acceptanceBoot()) at every access boundary and in every getter,
    // never read back from a latch, so the barrier cannot go stale.
    private disabledLogged: boolean = false;

    constructor() {
        // Client is initialized lazily in connect()
    }

    /** Returns true if running in mock (in-memory) mode */
    public isMockMode(): boolean {
        return this.isMock;
    }

    /** True when acceptance policy disables Redis (voluntary, not an outage).
     *  Derived LIVE from the process boot mode - never from a latch - so it is
     *  correct before the first connect and at every call site. Boot-stable:
     *  SILHOUETTE_BOOT_MODE is process-start policy, not a runtime toggle. */
    public isDisabledByPolicy(): boolean {
        return acceptanceBoot();
    }

    /** Truthful serving state: a live REAL client past the protocol handshake
     *  (driver isReady), never mock, never policy-disabled, with no failed
     *  close latched and no connect/disconnect in flight. */
    public isReallyConnected(): boolean {
        if (acceptanceBoot()) return false;
        if (this.isMock || this.closeFailed) return false;
        if (this.connectTask || this.disconnectTask) return false;
        return this.isConnected && !!this.client && this.client.isReady === true;
    }

    // Acceptance barrier: configForRuntime already declares modules.redis=false
    // and dummy endpoints in this mode; this client must honor that AT the
    // access boundary - before importing the driver, creating a client or
    // opening a socket. Disabled is NOT mock and NOT connected: operations
    // keep their existing unavailable semantics (set/del/releaseLock no-op,
    // get null, keys []) and NO in-memory fallback is engaged.
    private logPolicyDisabledOnce(): void {
        if (!this.disabledLogged) {
            this.disabledLogged = true;
            console.info('[REDIS] Disabled by acceptance policy (modules.redis=false); no client will be created.');
        }
    }

    public async connect(): Promise<void> {
        if (acceptanceBoot()) {
            this.logPolicyDisabledOnce();
            return;
        }
        // 1. Browser Safety Check: Never run in browser
        if (typeof window !== 'undefined') return;

        // Never ride a closing handle: an in-flight disconnect settles
        // first. A latched close failure then gets its retry before any
        // new connection is considered; both stay non-throwing here so
        // the current (possibly mock) capability keeps serving while the
        // failure remains latched and visible at the drain.
        if (this.disconnectTask) {
            try { await this.disconnectTask; } catch { /* logged + latched at source */ }
        }
        if (this.closeFailed) {
            try { await this.disconnect(); } catch { /* logged + latched at source */ }
        }

        // 2. Single-flight FIRST: doConnect assigns this.client before the
        // connection actually settles, so checking this.client first would
        // let a concurrent caller mistake an in-flight attempt for an
        // established connection. Then the singleton check.
        if (this.connectTask) return this.connectTask;
        if (this.closeFailed && this.client && !this.isMock) {
            // The retry above failed: the retained real handle is uncertain.
            // Never silently serve it - keep availability false and the
            // failure loud until a disconnect retry confirms the close.
            console.error('[REDIS] Retained client whose close failed is not reusable; availability stays false until a disconnect retry confirms it.');
            this.isConnected = false;
            return;
        }
        if (this.client || this.isMock) return;
        this.connectTask = this.doConnect();
        try {
            await this.connectTask;
        } finally {
            this.connectTask = null;
        }
    }

    private async doConnect(): Promise<void> {
        // Defensive recheck at the real boundary: never import the driver or
        // create a client under acceptance, whatever path led here.
        if (acceptanceBoot()) {
            this.logPolicyDisabledOnce();
            return;
        }
        if (!this.client && !this.isMock) {
            try {
                // 3. Dynamic Import: Prevents bundler from including 'redis' package in frontend build
                const redisModule = await import('redis');
                // Recheck across the await: never create a client under policy.
                if (acceptanceBoot()) {
                    this.logPolicyDisabledOnce();
                    return;
                }
                const createClient = redisModule.createClient;

                const redisUrl = `redis://${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`;
                console.log(`[REDIS] Connecting to ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}...`);

                this.client = createClient({
                    url: redisUrl,
                    password: REDIS_CONFIG.password || undefined,
                    socket: {
                        connectTimeout: 5000,
                        reconnectStrategy: (retries: number) => {
                            if (retries > 3) {
                                console.warn('[REDIS] Max retries reached. Switching to In-Memory Fallback.');
                                return new Error('Max retries reached');
                            }
                            return Math.min(retries * 100, 3000);
                        }
                    }
                });

                // Recheck before opening the socket. Unreachable under the
                // boot-stable scope; if it ever tripped, the just-created
                // client never opened, so releasing the reference is not a
                // close and nothing is disguised as one.
                if (acceptanceBoot()) {
                    this.logPolicyDisabledOnce();
                    if (this.client && !this.client.isOpen) this.client = null;
                    return;
                }

                this.client.on('error', (err: any) => {
                    // Only log if not already in mock mode to avoid spam
                    if (!this.isMock) console.error('[REDIS] Client Error:', err.message);
                });

                this.client.on('connect', () => {
                    console.log('[REDIS] Connected (Warm Persistence Active)');
                    this.isConnected = true;
                    // [R6] recovery closes the SAME incident the fallback opened
                    incidentRegistry.resolveIncidents('redis');
                });

                await this.client.connect();
            } catch (e: any) {
                console.warn(`[REDIS] Connection Failed: ${e.message || e}. Using In-Memory Fallback (data lost on restart).`);
                if (this.client) {
                    if (this.client.isOpen) {
                        // An OPEN client that fails to close is a genuine
                        // failure: keep the handle owned and the receipt
                        // visible instead of discarding it into a clean
                        // fallback claim.
                        try { await this.client.disconnect(); } catch (err) {
                            console.error("[REDIS] Failed to disconnect during fallback:", err);
                            this.closeFailed = true;
                        }
                    }
                    // A never-opened client has nothing to disconnect; its
                    // ClientClosedError is a predictable condition of the
                    // fallback path, not an error worth logging.
                    if (!this.closeFailed) this.client = null;
                }
                this.isMock = true;
                this.isConnected = true;
                // [R6] durable incident: in-memory fallback loses data on restart
                incidentRegistry.recordIncident('redis', 'outage',
                    `Redis unavailable: ${e.message || e}. Using in-memory fallback.`,
                    'Cached data is lost on restart while the fallback is active.');
            }
        }
    }

    public disconnect(): Promise<void> {
        // Deliberately NO policy guard: cleanup of an acquired handle stays
        // usable in every mode. The barrier blocks acquisition and commands,
        // never close.
        // Non-async wrapper: every concurrent caller receives the SAME
        // stored promise, so one client can never be closed twice and a
        // shared failure reaches every caller.
        if (this.disconnectTask) return this.disconnectTask;
        this.disconnectTask = this.doDisconnect();
        const clear = () => { this.disconnectTask = null; };
        this.disconnectTask.then(clear, clear);
        return this.disconnectTask;
    }

    private async doDisconnect(): Promise<void> {
        // Fence operations from riding a closing handle. A pending connect's
        // 'connect' event or fallback catch may set this back to true while
        // we await its settlement below; availability is therefore restored
        // truthfully at COMPLETION, from the final state.
        this.isConnected = false;
        // Settle an in-flight connect first: its outcome (open client or
        // fallback) is owned here, never lost by racing the reference.
        if (this.connectTask) {
            try { await this.connectTask; } catch { /* failure already recorded by connect itself */ }
        }
        if (this.client) {
            if (!this.client.isOpen) {
                // Handle confirmed closed (by whichever cause): the
                // uncertainty a closeFailed latch tracked is resolved.
                this.client = null;
                this.closeFailed = false;
            } else {
                try {
                    await this.client.disconnect();
                    console.log('[REDIS] Disconnected.');
                    this.client = null;
                    this.closeFailed = false;
                } catch (err) {
                    // Retain the owned handle and the failed receipt so a
                    // caller can retry or terminate explicitly; propagate
                    // so the caller's outcome is truthful. Availability is
                    // restored first: the mock store keeps serving, the
                    // uncertain real handle is never served.
                    console.error("[REDIS] Failed to disconnect:", err);
                    this.closeFailed = true;
                    this.isConnected = this.isMock;
                    throw err;
                }
            }
        }
        // Truthful availability at completion: the mock capability survives
        // any cleanup outcome; a real client never survives its own close.
        this.isConnected = this.isMock;
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
     *  intermittently. connect() is idempotent and never throws. */
    private async ensureConnected(): Promise<void> {
        // Acceptance barrier at the operation fence itself, BEFORE the
        // isConnected early-return below: no operation may be admitted on a
        // pre-existing or future handle in this mode. closeFailed and pending
        // disconnect/connect tasks are PRESERVED for their owners; returning
        // early here neither closes nor discards anything.
        if (acceptanceBoot()) {
            this.logPolicyDisabledOnce();
            return;
        }
        // Admission fence, revalidated across EVERY await boundary - a
        // single entry check is not enough: a disconnect can begin while
        // this caller awaits connect settlement, and the TCP 'connect'
        // event sets isConnected before the protocol handshake (the
        // pending connectTask) completes. Loop only while lifecycle tasks
        // are actually changing state; each recheck is bounded by a real
        // task settlement, never by a static false availability.
        //
        // FINITE OUTCOME: one connect attempt per call. If its settlement
        // leaves availability stably false (browser guard, retained failed
        // close), that is TERMINAL for this operation - return and let the
        // caller's existing unavailable guard answer, instead of spinning
        // reconnects or close retries. The fallback store's availability
        // is independent: once a settle leaves isMock true, the loop exits
        // and operations serve the mock path without touching the handle.
        //
        // RESIDUAL (named, not claimed away): after this function returns,
        // another owner can begin disconnect() before the caller's
        // synchronous continuation issues its command. This contract
        // covers settlement and final state, not operation leases; a
        // command admitted into that window and closed underneath gets the
        // driver's own rejection, the preexisting op semantics.
        let connectAttempted = false;
        for (;;) {
            // Policy revalidated at every loop turn, i.e. after each await
            // below: boot-stable in practice, but the fence never trusts a
            // stale check from before an await.
            if (acceptanceBoot()) {
                this.logPolicyDisabledOnce();
                return;
            }
            if (this.disconnectTask) {
                try { await this.disconnectTask; } catch { /* logged + latched at source */ }
                continue;
            }
            if (this.connectTask) {
                try { await this.connectTask; } catch { /* recorded at source */ }
                continue;
            }
            if (this.isConnected) return;
            if (connectAttempted) return; // stable false: terminal unavailable
            connectAttempted = true;
            await this.connect();
        }
    }

    public async set(key: string, value: string, ttl?: number) {
        await this.ensureConnected();
        // Post-await fence: ensureConnected can also return via its early
        // isConnected path; policy is revalidated before ANY command so no
        // operation rides a handle in acceptance (boot-stable scope: this is
        // not a hot-toggle contract).
        if (acceptanceBoot()) { this.logPolicyDisabledOnce(); return; }
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

    public async get(key: string): Promise<string | null> {
        await this.ensureConnected();
        if (acceptanceBoot()) { this.logPolicyDisabledOnce(); return null; }
        if (!this.isConnected) return null;

        if (this.isMock) {
            return this.mockStore.get(key) || null;
        }

        return this.client ? await this.client.get(key) : null;
    }

    public async del(key: string) {
        await this.ensureConnected();
        if (acceptanceBoot()) { this.logPolicyDisabledOnce(); return; }
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.delete(key);
            return;
        }

        if (this.client) await this.client.del(key);
    }

    public async keys(pattern: string): Promise<string[]> {
        await this.ensureConnected();
        if (acceptanceBoot()) { this.logPolicyDisabledOnce(); return []; }
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
    public async acquireLock(lockKey: string, ttlMs: number): Promise<boolean> {
        // Policy denial is NOT lock-busy and NOT the normal no-redis fallback:
        // under acceptance there is NO distributed exclusion, so returning
        // true would let the caller run as if a lock were held. Throw an
        // identifiable error instead; callers (e.g. unifiedDaemon) already
        // treat lock errors as retry-later with the task still due. Outside
        // acceptance the fallback below is unchanged. The policy check is
        // LIVE - before AND after the await - never read from a latch.
        if (acceptanceBoot()) { this.logPolicyDisabledOnce(); throw new Error('REDIS_DISABLED_BY_POLICY'); }
        await this.ensureConnected();
        if (acceptanceBoot()) { this.logPolicyDisabledOnce(); throw new Error('REDIS_DISABLED_BY_POLICY'); }
        if (!this.isConnected) return true; // Fallback to allowing execution if no redis

        if (this.isMock) {
            // Mock implementation of SET NX EX
            if (this.mockStore.has(lockKey)) return false;
            this.mockStore.set(lockKey, 'locked');
            setTimeout(() => this.mockStore.delete(lockKey), ttlMs);
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
            console.error('[REDIS] Error acquiring lock:', e);
            return false;
        }
    }

    /**
     * Releases a distributed lock.
     */
    public async releaseLock(lockKey: string): Promise<void> {
        await this.ensureConnected();
        if (acceptanceBoot()) { this.logPolicyDisabledOnce(); return; }
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.delete(lockKey);
            return;
        }

        try {
            await this.client.del(lockKey);
        } catch (e) {
            console.error('[REDIS] Error releasing lock:', e);
        }
    }
}

export const redisClient = new RedisService();
