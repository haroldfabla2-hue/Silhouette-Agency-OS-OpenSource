import { REDIS_CONFIG } from '../constants';

class RedisService {
    private client: any;
    private isConnected: boolean = false;
    private isMock: boolean = false;
    private mockStore: Map<string, string> = new Map();

    constructor() {
        // Client is initialized lazily in connect()
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

                this.client = createClient({
                    url: `redis://${REDIS_CONFIG.host}:${REDIS_CONFIG.port}`,
                    socket: {
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
                    if (!this.isMock) console.error('❌ Redis Client Error', err.message);
                });

                this.client.on('connect', () => {
                    console.log('✅ Redis Connected (Warm Persistence Active)');
                    this.isConnected = true;
                });

                await this.client.connect();
            } catch (e) {
                console.warn("⚠️ Redis Connection Failed. Switching to In-Memory Storage (Session Only).");
                if (this.client) {
                    try { await this.client.disconnect(); } catch (err) { }
                    this.client = null; // Ensure we don't try to use it
                }
                this.isMock = true;
                this.isConnected = true; // Technically "connected" to the mock
            }
        }
    }

    public async set(key: string, value: string, ttl?: number) {
        if (!this.isConnected) return;

        if (this.isMock) {
            this.mockStore.set(key, value);
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
            // Simple regex match for mock keys
            const regex = new RegExp(pattern.replace('*', '.*'));
            return Array.from(this.mockStore.keys()).filter(k => regex.test(k));
        }

        return this.client ? await this.client.keys(pattern) : [];
    }
}

export const redisClient = new RedisService();
