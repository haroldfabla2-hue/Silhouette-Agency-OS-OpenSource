/**
 * Browser-safe Redis Mock for the 'redis' package
 * Prevents the real Redis client from being bundled into the browser.
 */

export const createClient = () => ({
    connect: async () => { },
    disconnect: async () => { },
    isReady: false,
    get: async () => null,
    set: async () => { },
    del: async () => { },
    hGet: async () => null,
    hSet: async () => { },
    hGetAll: async () => ({}),
    on: function () { return this; },
    once: function () { return this; },
    off: function () { return this; },
    subscribe: async () => { },
    publish: async () => { },
    pSubscribe: async () => { },
    quit: async () => { },
});

export type RedisClientType = ReturnType<typeof createClient>;

export default { createClient };
