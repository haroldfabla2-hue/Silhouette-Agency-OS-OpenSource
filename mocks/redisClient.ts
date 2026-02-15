/**
 * Browser-safe Redis Mock
 * 
 * This mock prevents the real Redis client from being bundled into the browser.
 * The actual Redis functionality runs only on the server.
 */

class RedisClientMock {
    public isReady: boolean = false;
    private connected: boolean = false;

    async connect(): Promise<void> {
        console.log('[REDIS MOCK] Browser mode - Redis runs on server only');
        this.connected = true;
        this.isReady = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.isReady = false;
    }

    async get(key: string): Promise<string | null> {
        return null;
    }

    async set(key: string, value: string, options?: any): Promise<void> {
        // No-op in browser
    }

    async del(key: string): Promise<void> {
        // No-op in browser
    }

    async hGet(key: string, field: string): Promise<string | null> {
        return null;
    }

    async hSet(key: string, field: string, value: string): Promise<void> {
        // No-op in browser
    }

    async hGetAll(key: string): Promise<Record<string, string>> {
        return {};
    }

    on(event: string, callback: Function): this {
        // No-op event handler
        return this;
    }

    once(event: string, callback: Function): this {
        return this;
    }

    off(event: string, callback: Function): this {
        return this;
    }
}

export const redisClient = new RedisClientMock();
export default redisClient;
