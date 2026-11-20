/**
 * Acceptance Redis policy barrier - fresh-process proof (real modules, no
 * doubles; instrumentation is call-counting/recording wrappers only, never
 * behavior replacements).
 *
 * The supervisor sets SILHOUETTE_BOOT_MODE=acceptance AND both Redis upgrade
 * flags (USE_REDIS=true, REDIS_URL) in the ENVIRONMENT BEFORE the process
 * starts. THE REAL ROUTE includes a scrub: importing redisClient statically
 * pulls incidentRegistry -> sqliteService -> runtimeCredentials, whose module
 * eval (runtimeCredentials.ts:88) runs the acceptance scrub that DELETES
 * USE_REDIS/REDIS_URL (absent from the ACCEPTANCE_ENV allowlist) while
 * preserving SILHOUETTE_BOOT_MODE. This child never disables that scrub and
 * never widens the allowlist: it OBSERVES the scrub explicitly, proves the
 * systemBus policy gate BEFORE it (flags asserted immediately before the
 * first product import), and for the two post-scrub policy decisions
 * (nervous registration skip, adapter construction rejection) it
 * re-establishes the same non-secret fixture values and asserts them
 * present at the exact call site - so each outcome is attributable to
 * POLICY, never to config absence.
 *
 * Proves, in one fresh process:
 *  (a) before any connect: policy getter true, real-serving false, fallback
 *      NOT engaged; checkRedisHealth reports disabled without touching
 *      set/get; registerRedisMonitoring() (the REAL registration path used
 *      by initializeNervousSystem) skips registration with REDIS_URL present
 *      - WITHOUT the global initializer (no heartbeat, no foreign probes).
 *  (b) every operation keeps its unavailable semantics without importing the
 *      driver, creating a client, engaging the mock, or recording an outage
 *      incident; acquireLock denies with REDIS_DISABLED_BY_POLICY; a DUE
 *      daemon task is PROVEN to reach the lock attempt (delegating counter
 *      on the real acquireLock, exact key+ttl asserted) and then never
 *      executes and stays due.
 *  (c) systemBus, imported FIRST with both flags present, stays on the
 *      memory adapter; the exact barrier receipt line is captured (not only
 *      the adapter class name); the flags are verified present immediately
 *      before that import (no scrub ran).
 *  (d) direct `new RedisBusAdapter()` is REJECTED; cleanup stays usable and
 *      falsifies nothing.
 *  (e) socket DENIAL evidence: a fail-on-attempt sentinel replaces
 *      net.Socket.prototype.connect BEFORE any product import: it RECORDS
 *      the attempt and THROWS - the real network is never called. This is
 *      not a product mock and does not simulate Redis: it is I/O denial for
 *      test safety plus tamper evidence. A barrier breach therefore fails
 *      LOUDLY at the attempt site (and via the assertions below), never
 *      after contacting a default/foreign endpoint. Declared limit: the
 *      sentinel covers ONLY this socket API - not kernel-level egress,
 *      fetch, or any other mechanism; this is not universal isolation.
 *
 * Natural exit: no process.exit on any path; the supervisor bounds the
 * process externally and probes the group.
 */
import assert from 'node:assert/strict';
import net from 'node:net';

// ── I/O denial sentinel installed BEFORE any product import ──────────────
const socketAttempts: Array<{ address: string; port: number | undefined }> = [];
(net.Socket.prototype as any).connect = function (...args: any[]) {
    const opts = args[0];
    socketAttempts.push({
        address: typeof opts === 'object' && opts !== null ? String((opts as any).host ?? (opts as any).address ?? 'unknown') : String(opts),
        port: typeof opts === 'object' && opts !== null ? (opts as any).port : undefined
    });
    throw new Error('FIXTURE_IO_DENIED: net.Socket.connect attempted in the acceptance barrier child');
};

const consoleLines: string[] = [];
for (const method of ['info', 'log', 'warn'] as const) {
    const orig = console[method];
    console[method] = ((...args: any[]) => {
        consoleLines.push(args.map(String).join(' '));
        return orig.apply(console, args);
    }) as any;
}

// ── Flags present from birth (set by the supervisor env) ─────────────────
assert.equal(process.env.SILHOUETTE_BOOT_MODE, 'acceptance',
    'barrier child must boot in explicit acceptance mode');
assert.equal(process.env.USE_REDIS, 'true', 'upgrade flag must be present from birth');
assert.ok(process.env.REDIS_URL, 'REDIS_URL must be present from birth');

// ── (c) systemBus FIRST, with both flags present ─────────────────────────
// Verified immediately before the FIRST product import: the scrub has not
// run yet (it fires later, at the redisClient import chain), so this gate
// is proven with the flags present.
assert.equal(process.env.USE_REDIS, 'true');
assert.ok(process.env.REDIS_URL);
const { systemBus } = await import('../../services/systemBus');
// upgradeToRedis() is fire-and-forget from the SystemBus constructor; its
// acceptance path contains NO await before returning, so one macrotask turn
// settles it deterministically (no sleep-based timing).
await new Promise(r => setImmediate(r));
assert.equal((systemBus as any).adapter.constructor.name, 'MemoryBusAdapter',
    'systemBus must stay on the memory adapter under policy');
assert.ok(
    consoleLines.some(l => l.includes('[SYSTEM BUS] Redis adapter upgrade disabled by acceptance policy')),
    'the exact barrier receipt line must be emitted');

// ── (a) fresh acceptance, before any connect ─────────────────────────────
const { redisClient } = await import('../../services/redisClient');
// OBSERVE the real-route scrub exactly where it fires: the redisClient
// import chain evaluates runtimeCredentials, whose acceptance scrub deletes
// the upgrade flags (not allowlisted) and preserves the policy mode.
assert.equal(process.env.USE_REDIS, undefined,
    'the real route scrubs the upgrade flag at the redisClient import');
assert.equal(process.env.REDIS_URL, undefined,
    'the real route scrubs REDIS_URL at the redisClient import');
assert.equal(process.env.SILHOUETTE_BOOT_MODE, 'acceptance',
    'the scrub preserves the policy mode itself');
assert.ok(process.env.SILHOUETTE_DB_PATH && process.env.SILHOUETTE_MIGRATIONS_DIR,
    'allowlisted storage env must survive the scrub');
assert.equal(redisClient.isDisabledByPolicy(), true,
    'policy getter must be true BEFORE the first connect (pure, not latched)');
assert.equal(redisClient.isReallyConnected(), false);
assert.equal(redisClient.isMockMode(), false,
    'policy disable must NOT engage the in-memory fallback');

let healthSetCalls = 0;
let healthGetCalls = 0;
const origSet = redisClient.set.bind(redisClient);
const origGet = redisClient.get.bind(redisClient);
(redisClient as any).set = async (...a: any[]) => { healthSetCalls++; return origSet(...a); };
(redisClient as any).get = async (...a: any[]) => { healthGetCalls++; return origGet(...a); };
const { checkRedisHealth } = await import('../../services/health/redisHealth');
const health = await checkRedisHealth(redisClient);
assert.equal(health.status, 'up');
assert.equal(health.backend, 'disabled-by-policy');
assert.ok(health.note && health.note.includes('not serving'),
    'disabled receipt must say it is not serving');
assert.equal(healthSetCalls, 0, 'health must not SET through a barriered client');
assert.equal(healthGetCalls, 0, 'health must not GET through a barriered client');
(redisClient as any).set = origSet;
(redisClient as any).get = origGet;

// Nervous: the REAL registration path, with REDIS_URL present, must skip
// redis - without the global initializer (no heartbeat, no foreign probes).
// registerRedisMonitoring returns SILENTLY when REDIS_URL is absent
// (connectionNervousSystem.ts:330) BEFORE its policy check: after the
// observed scrub a missing receipt would prove config absence, not policy.
// Re-establish the same non-secret FIXTURE values and assert them present
// at the exact call site.
process.env.USE_REDIS = 'true';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
assert.equal(process.env.USE_REDIS, 'true');
assert.ok(process.env.REDIS_URL);
const { registerRedisMonitoring, nervousSystem } = await import('../../services/connectionNervousSystem');
await registerRedisMonitoring();
assert.equal(nervousSystem.isRegistered('redis'), false,
    'nervous must skip redis registration under policy even with REDIS_URL set');
assert.ok(
    consoleLines.some(l => l.includes('Redis disabled by policy; skipping monitoring registration')),
    'the exact nervous skip receipt line must be emitted');

// ── (b) operations: unavailable semantics, no fallback, no incident ──────
await redisClient.set('barrier:k', 'v', 5);
assert.equal(await redisClient.get('barrier:k'), null);
await redisClient.del('barrier:k');
assert.deepEqual(await redisClient.keys('barrier:*'), []);
assert.equal(redisClient.isMockMode(), false,
    'no operation may engage the in-memory fallback under policy');
assert.equal(redisClient.isReallyConnected(), false);

const { incidentRegistry } = await import('../../services/incidentRegistry');
assert.equal(
    incidentRegistry.getOpenIncidents().filter((i: any) => i.source === 'redis').length, 0,
    'voluntary policy disable must NOT open a redis outage incident');

await redisClient.releaseLock('barrier:lock'); // no-op, must not throw

let lockErr: any = null;
try {
    await redisClient.acquireLock('barrier:lock', 1000);
} catch (e) {
    lockErr = e;
}
assert.equal(lockErr?.message, 'REDIS_DISABLED_BY_POLICY',
    'acquireLock must DENY identifiably, never admit work as if locked');

// Daemon: PROVE the due task reaches the lock attempt (delegating counter on
// the real acquireLock), then never executes and stays due.
const lockAttempts: Array<{ key: string; ttl: number }> = [];
const origAcquire = redisClient.acquireLock.bind(redisClient);
(redisClient as any).acquireLock = async (key: string, ttl: number) => {
    lockAttempts.push({ key, ttl });
    return origAcquire(key, ttl);
};
const { producerAdmissionOpen } = await import('../../server/desktop/producerScope.js');
assert.equal(producerAdmissionOpen(), true,
    'admission must be OPEN, or a skipped daemon body proves nothing');
const { unifiedDaemon } = await import('../../services/daemon/unifiedDaemon');
let bodyRuns = 0;
const probeTask = {
    name: 'barrier-probe',
    intervalMs: 5000, // due (lastRun 0); lock ttl becomes min(5000-1000, cap) = 4000
    enabled: true,
    lastRun: 0,
    execute: async () => { bodyRuns++; }
};
(unifiedDaemon as any).tasks.push(probeTask);
await (unifiedDaemon as any).tick();
assert.deepEqual(
    lockAttempts.filter(a => a.key === 'lock:daemon:barrier-probe'),
    [{ key: 'lock:daemon:barrier-probe', ttl: 4000 }],
    'the due task must REACH the lock attempt with its exact key and ttl');
assert.equal(bodyRuns, 0, 'daemon body must not run when the lock is denied');
assert.equal(probeTask.lastRun, 0,
    'a denied lock is not a run: the task stays due (lastRun untouched)');
assert.ok(
    consoleLines.some(l => l.includes('[DAEMON: LOCK-ERROR]') && l.includes('barrier-probe')),
    'the daemon lock-error route (task stays due) must be the one taken');

// ── (d) direct adapter construction rejected; cleanup usable ─────────────
const { RedisBusAdapter } = await import('../../services/bus/RedisBusAdapter');
assert.equal(process.env.USE_REDIS, 'true',
    'fixture flags present at adapter construction: rejection is policy, not absence');
assert.ok(process.env.REDIS_URL);
let ctorErr: any = null;
try {
    new RedisBusAdapter();
} catch (e) {
    ctorErr = e;
}
assert.equal(ctorErr?.message, 'REDIS_BUS_DISABLED_BY_POLICY',
    'construction must be REJECTED identifiably, not return a half-instance');

await redisClient.disconnect();
assert.equal((redisClient as any).closeFailed, false,
    'no failed-close receipt may be invented by the barrier');

// ── (e) socket denial evidence; flags are the re-established fixtures ────
assert.equal(process.env.USE_REDIS, 'true',
    'flags present are the re-established fixture values (originals scrubbed by the real route, observed above)');
assert.ok(process.env.REDIS_URL);
assert.equal((redisClient as any).client ?? null, null,
    'no redis client field may ever have been assigned');
assert.deepEqual(socketAttempts, [],
    'no net.Socket connection may have been attempted in acceptance');

console.log('REDIS_POLICY_BARRIER_CHILD_OK');
