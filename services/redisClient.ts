import { ResourceScope } from '../server/runtime/resourceScope';
import { REDIS_CONFIG } from '../constants';
import { incidentRegistry } from './incidentRegistry';

const MOCK_STORE_MAX_SIZE = 10000; // Eviction threshold for in-memory fallback

class RedisService {
    private readonly operations = new ResourceScope('redis-cache');
    private connectionTask?: Promise<void>;
    private releaseClient?: () => Promise<void>;
    public getLifecycleDiagnostics() { return this.operations.getDiagnostics(); }
    public getLifecycleFailures() { return this.operations.getFailures(); }
    private client: any;
    private isConnected: boolean = false;
    private isMock: boolean = false;
    private mockStore: Map<string, string> = new Map();

    constructor() {
        // Client is initialized lazily in connect()
    }

    /** Returns true if running in mock (in-memory) mode */
    public isMockMode(): boolean {
        return this.isMock;
    }

    public connect(): Promise<void> {
        if (this.connectionTask) return this.connectionTask;
        this.connectionTask = this.operations.run('connect', () => this.connectOnce()).finally(() => { this.connectionTask = undefined; });
        return this.connectionTask;
    }
    private async connectOnce() {
        // 1. Browser Safety Check: Never run in browser
        if (typeof window !== 'undefined') return;

        // 2. Singleton Check
        if (!this.client && !this.isMock) {
            try {
                // 3. Dynamic Import: Prevents bundler from including 'redis' package in frontend build
                const redisModule = await import('redis');
                const createClient = redisModule.createClient;

                const redisUrl = `redis://${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`;
                console.log(`[REDIS] Connecting to ${REDIS_CONFIG.host}:${REDIS_CONFIG.port}...`);

                this.operations.assertAccepting();
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

                const ownedClient = this.client;
                this.releaseClient = this.operations.own({ name: 'redis-client', close: async () => {
                    if (ownedClient.isOpen) await ownedClient.disconnect();
                } });

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
                this.operations.assertWorkAccepted();
            } catch (e: any) {
                console.warn(`[REDIS] Connection Failed: ${e.message || e}. Using In-Memory Fallback (data lost on restart).`);
                this.operations.recordDiagnostic('redis-connect-fallback', e, 'DEGRADED_FALLBACK', 'UNAVAILABLE');
                await this.releaseClient?.();
                this.client = null;
                this.isMock = true;
                this.isConnected = true;
                // [R6] durable incident: in-memory fallback loses data on restart
                incidentRegistry.recordIncident('redis', 'outage',
                    `Redis unavailable: ${e.message || e}. Using in-memory fallback.`,
                    'Cached data is lost on restart while the fallback is active.');
            }
        }
    }

    public async disconnect() {
        const report = await this.operations.close();
        this.client = null;
        this.isConnected = false;
        if (report.failures.length) throw new AggregateError(report.failures.map(f => f.error), 'Redis cleanup failed');
        return report;
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
        if (!this.isConnected) await this.connect();
    }

    public async set(key: string, value: string, ttl?: number) {
        return this.operations.run('set', async () => {

        await this.ensureConnected();
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
    
        });
    }

    public async get(key: string): Promise<string | null> {
        return this.operations.run('get', async () => {

        await this.ensureConnected();
        if (!this.isConnected) return null;

        if (this.isMock) {
            return this.mockStore.get(key) || null;
        }

        return this.client ? await this.client.get(key) : null;
    
        });
    }

    public async del(key: string) {
        return this.operations.run('del', async () => {

        await this.ensureConnected();
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.delete(key);
            return;
        }

        if (this.client) await this.client.del(key);
    
        });
    }

    public async keys(pattern: string): Promise<string[]> {
        return this.operations.run('keys', async () => {

        await this.ensureConnected();
        if (!this.isConnected) return [];

        if (this.isMock) {
            // Proper glob-to-regex: escape special chars, convert * to .*
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            const regex = new RegExp('^' + escaped + '$');
            return Array.from(this.mockStore.keys()).filter(k => regex.test(k));
        }

        return this.client ? await this.client.keys(pattern) : [];
    
        });
    }

    // ── Distributed Locks ──
    /**
     * Tries to acquire a distributed lock using Redis SET NX.
     * @param lockKey The unique key for the lock
     * @param ttlMs Time to live in milliseconds (avoids deadlocks)
     * @returns boolean True if lock acquired, false if already locked
     */
    public async acquireLock(lockKey: string, ttlMs: number): Promise<boolean> {
        return this.operations.run('acquireLock', async () => {

        await this.ensureConnected();
        if (!this.isConnected) return true; // Fallback to allowing execution if no redis

        if (this.isMock) {
            // Mock implementation of SET NX EX
            if (this.mockStore.has(lockKey)) return false;
            this.mockStore.set(lockKey, 'locked');
            this.operations.timeout(`redis-lock-expiry:${lockKey}`, ttlMs, () => { this.mockStore.delete(lockKey); });
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
            this.operations.recordDiagnostic('redis-lock-acquire', e, 'OPERATION_REJECTED', 'UNAVAILABLE');
            console.error('[REDIS] Error acquiring lock:', e);
            return false;
        }
    
        });
    }

    /**
     * Releases a distributed lock.
     */
    public async releaseLock(lockKey: string): Promise<void> {
        return this.operations.run('releaseLock', async () => {

        await this.ensureConnected();
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.delete(lockKey);
            return;
        }

        try {
            await this.client.del(lockKey);
        } catch (e) {
            this.operations.recordFailure('redis-lock-release', e);
            console.error('[REDIS] Error releasing lock:', e);
        }
    
        });
    }
}

export const redisClient = new RedisService();
