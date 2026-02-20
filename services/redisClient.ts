import { REDIS_CONFIG } from '../constants';

const MOCK_STORE_MAX_SIZE = 10000; // Eviction threshold for in-memory fallback

class RedisService {
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

    public async connect() {
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

                this.client.on('error', (err: any) => {
                    // Only log if not already in mock mode to avoid spam
                    if (!this.isMock) console.error('[REDIS] Client Error:', err.message);
                });

                this.client.on('connect', () => {
                    console.log('[REDIS] Connected (Warm Persistence Active)');
                    this.isConnected = true;
                });

                await this.client.connect();
            } catch (e: any) {
                console.warn(`[REDIS] Connection Failed: ${e.message || e}. Using In-Memory Fallback (data lost on restart).`);
                if (this.client) {
                    try { await this.client.disconnect(); } catch (err) { }
                    this.client = null;
                }
                this.isMock = true;
                this.isConnected = true;
            }
        }
    }

    public async disconnect() {
        if (this.client) {
            try {
                await this.client.disconnect();
                console.log('[REDIS] Disconnected.');
            } catch { }
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

    public async set(key: string, value: string, ttl?: number) {
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
        if (!this.isConnected) return null;

        if (this.isMock) {
            return this.mockStore.get(key) || null;
        }

        return this.client ? await this.client.get(key) : null;
    }

    public async del(key: string) {
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.delete(key);
            return;
        }

        if (this.client) await this.client.del(key);
    }

    public async keys(pattern: string): Promise<string[]> {
        if (!this.isConnected) return [];

        if (this.isMock) {
            // Proper glob-to-regex: escape special chars, convert * to .*
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            const regex = new RegExp('^' + escaped + '$');
            return Array.from(this.mockStore.keys()).filter(k => regex.test(k));
        }

        return this.client ? await this.client.keys(pattern) : [];
    }
}

export const redisClient = new RedisService();
