/** Report the backend that actually serves the probe, not only a set/get value.
 * In-memory fallback can answer but loses Redis durability across restarts.
 */
export async function checkRedisHealth(redis: {
    isMockMode(): boolean;
    isDisabledByPolicy?(): boolean;
    set(key: string, value: string, ttl: number): Promise<unknown>;
    get(key: string): Promise<unknown>;
}) {
    const start = Date.now();
    const fallback = () => ({ status: 'degraded' as const, backend: 'in-memory-fallback',
        latencyMs: Date.now() - start, note: 'Redis unavailable; in-memory fallback loses data on restart.' });
    // Voluntary policy disable is healthy-by-design (same semantics as the
    // graph module's disabled state), NOT an outage and NOT a redis backend:
    // report it before any probe so no set/get is even attempted.
    if (redis.isDisabledByPolicy?.()) return { status: 'up' as const, backend: 'disabled-by-policy',
        latencyMs: Date.now() - start, note: 'Redis disabled by acceptance policy; intentionally not serving.' };
    if (redis.isMockMode()) return fallback();
    await redis.set('health:check', 'ok', 10);
    const value = await redis.get('health:check');
    if (redis.isMockMode()) return fallback();
    return { status: value === 'ok' ? 'up' as const : 'down' as const,
        backend: 'redis', latencyMs: Date.now() - start };
}
