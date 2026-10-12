/**
 * Browser-safe Redis shim.
 *
 * Prevents the real Redis client from being bundled into the browser.
 * The actual Redis functionality runs only on the server.
 *
 * Honesty contract: this shim NEVER reports a connected client and never
 * fabricates cache hits/misses. connect() is a no-op that leaves the client
 * NOT ready, and every data operation fails loudly with UNAVAILABLE.
 */

const unavailable = (): Error => new Error(
    'UNAVAILABLE: Redis is server-side only. The browser must use the backend API.'
);

class RedisClientMock {
    // Always false in the browser: reporting "ready" here would be a lie.
    public isReady: boolean = false;
    private connected: boolean = false;

    async connect(): Promise<void> {
        console.warn('[REDIS SHIM] Browser mode - Redis runs on the server only; this client stays disconnected.');
        this.connected = false;
        this.isReady = false;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.isReady = false;
    }

    async get(_key: string): Promise<never> { throw unavailable(); }
    async set(_key: string, _value: string, _options?: any): Promise<never> { throw unavailable(); }
    async del(_key: string): Promise<never> { throw unavailable(); }
    async hGet(_key: string, _field: string): Promise<never> { throw unavailable(); }
    async hSet(_key: string, _field: string, _value: string): Promise<never> { throw unavailable(); }
    async hGetAll(_key: string): Promise<never> { throw unavailable(); }

    on(_event: string, _callback: Function): this { return this; }
    once(_event: string, _callback: Function): this { return this; }
    off(_event: string, _callback: Function): this { return this; }
}

export const redisClient = new RedisClientMock();
export default redisClient;
