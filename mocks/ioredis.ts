/**
 * Browser-safe ioredis Mock
 * Prevents ioredis from being bundled into the browser.
 */

class IORedisMock {
    status = 'disconnected';

    async connect() {
        this.status = 'ready';
    }

    async disconnect() {
        this.status = 'disconnected';
    }

    async get() { return null; }
    async set() { return 'OK'; }
    async del() { return 0; }
    async hget() { return null; }
    async hset() { return 0; }
    async hgetall() { return {}; }
    async expire() { return 0; }
    async ttl() { return -1; }
    async keys() { return []; }
    async publish() { return 0; }
    async subscribe() { }
    async unsubscribe() { }
    async quit() { return 'OK'; }

    on() { return this; }
    once() { return this; }
    off() { return this; }

    duplicate() {
        return new IORedisMock();
    }
}

export default IORedisMock;
export { IORedisMock as Redis };
