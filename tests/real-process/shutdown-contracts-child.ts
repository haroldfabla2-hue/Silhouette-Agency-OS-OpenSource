/** Real modules, real sockets, real filesystem. No fake transports, no fake
 * faults, providers OFF, disposable cwd only. The fixture holds its own
 * controlled 127.0.0.1 endpoint on an ephemeral port and sets the endpoint
 * env BEFORE importing any service module (constants.ts snapshots
 * REDIS_CONFIG at module evaluation; runtimeCredentials/bootMode never
 * import constants, verified in source). Host-default Redis is never
 * contacted and absence is never relied on.
 *
 * NATURAL TERMINATION: no mode calls process.exit on the success path.
 * The child ends when the event loop drains; a lingering interval, socket
 * or pending handle keeps the process alive and fails the externally
 * bounded execFileSync timeout - the timeout is the supervision, natural
 * exit is the evidence. Assertion failures exit non-zero on their own. */
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
const mode = process.argv[2];
fs.mkdirSync('data', { recursive: true });

/** Real TCP endpoint that accepts and immediately destroys: genuine socket
 * errors for the client under test, not a protocol impersonation. */
async function resettingEndpoint(): Promise<{ server: net.Server; port: number; cleanup: () => Promise<void> }> {
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => { sockets.add(socket); socket.destroy(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const cleanup = () => new Promise<void>(resolve => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
    });
    return { server, port: (server.address() as net.AddressInfo).port, cleanup };
}

if (mode === 'redis-fallback-quiet') {
    const endpoint = await resettingEndpoint();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(endpoint.port);
    process.env.NEO4J_URI = `bolt://127.0.0.1:${endpoint.port}`;
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: any[]) => { errors.push(args.map(String).join(' ')); originalError(...args); };
    try {
        const { redisClient } = await import('../../services/redisClient');
        await redisClient.set('probe:key', 'v', 60); // first op drives the real connect attempt
        assert.equal(redisClient.isMockMode(), true, 'fallback must engage against an unreachable server');
        assert.equal(await redisClient.get('probe:key'), 'v', 'fallback store must keep working');
        const noise = errors.filter(line => line.includes('Failed to disconnect during fallback'));
        assert.equal(noise.length, 0, `predictable close of a never-opened client must not be error-logged: ${noise.join(' | ')}`);
        const { incidentRegistry } = await import('../../services/incidentRegistry');
        assert.ok(incidentRegistry.getOpenIncidents().some(i => i.source === 'redis'), 'fallback must remain a visible incident');
        // Single-flight receipt: concurrent disconnects share one stored
        // promise; a fallback-mode (never-opened) disconnect is a clean no-op.
        const first = redisClient.disconnect();
        const second = redisClient.disconnect();
        assert.equal(first, second, 'concurrent disconnects must share one stored promise');
        await first;
        console.log(JSON.stringify({ mode, fallback_visible: true, fallback_noise: false, shared_disconnect_promise: true }));
    } finally {
        // Listener cleanup must run even when an assertion fails, so the
        // original failure is never buried under a supervision timeout.
        await endpoint.cleanup();
    }
    // natural exit: module completion drains the loop.
} else if (mode === 'memory-never-started-fresh' || mode === 'memory-never-started-prior-wal') {
    const walFile = 'data/wal/memory_wal.json';
    let priorBytes: Buffer | null = null;
    if (mode.endsWith('prior-wal')) {
        fs.mkdirSync('data/wal', { recursive: true });
        // Valid per validRecord: id, timestamp, agentId under data/agents base,
        // enum type, object data, enum status.
        const entry = { id: 'wal-prior-1', timestamp: 1, agentId: 'wal-fixture', type: 'TASK_STARTED', data: { input: 'prior process unfinished work' }, status: 'PENDING' };
        fs.writeFileSync(walFile, JSON.stringify([entry]));
        priorBytes = fs.readFileSync(walFile);
    }
    const { continuousMemory } = await import('../../services/memory/continuousMemory');
    continuousMemory.shutdown(); // must NOT initialize: no mkdir, no replay, no interval
    if (priorBytes) {
        assert.deepEqual(fs.readFileSync(walFile), priorBytes, 'previous WAL must stay byte-untouched');
    } else {
        assert.equal(fs.existsSync('data/wal'), false, 'never-started shutdown must not create WAL storage');
    }
    console.log(JSON.stringify({ mode, prior_wal_preserved: priorBytes !== null, no_files_created: priorBytes === null }));
    // natural exit: had shutdown started the consolidation interval, the
    // loop would stay alive and the external timeout would fire.
} else if (mode === 'memory-blocked-store') {
    // Controlled endpoint even here: nothing in this mode should ever
    // contact Redis or Neo4j, but if any code path tries, it must hit the
    // fixture's own dead endpoint, never a host-default port.
    const endpoint = await resettingEndpoint();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(endpoint.port);
    process.env.NEO4J_URI = `bolt://127.0.0.1:${endpoint.port}`;
    try {
        const walFile = 'data/wal/memory_wal.json';
        fs.mkdirSync('data/wal', { recursive: true });
        fs.writeFileSync(walFile, '{broken original WAL');
        const before = fs.readFileSync(walFile);
        const { continuousMemory } = await import('../../services/memory/continuousMemory');
        assert.throws(() => continuousMemory.logBeforeProcessing('wal-fixture', 'TASK_STARTED', { input: 'must not be accepted' }), 'blocked store must refuse writes');
        assert.throws(() => continuousMemory.shutdown(), 'blocked store must NOT shut down quietly');
        assert.throws(() => continuousMemory.shutdown(), 'the failure must be STICKY, not consumed by being seen');
        assert.deepEqual(fs.readFileSync(walFile), before, 'original WAL must be preserved');
        // The drain calls shutdown() AGAIN: the sticky failure must still reach
        // it, so the outcome is honestly false.
        const { drainCurrentBackend } = await import('../../server/currentBackendDrain');
        assert.equal(await drainCurrentBackend(), false, 'a genuinely failing component must fail the drain outcome');
        assert.deepEqual(fs.readFileSync(walFile), before, 'original WAL must survive the drain too');
        console.log(JSON.stringify({ mode, writes_refused: true, failure_sticky: true, original_preserved: true, drain_ok: false }));
    } finally {
        await endpoint.cleanup();
    }
    // natural exit: module completion drains the loop.
} else if (mode === 'drain-receipts-ok') {
    const endpoint = await resettingEndpoint();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(endpoint.port);
    process.env.NEO4J_URI = `bolt://127.0.0.1:${endpoint.port}`;
    try {
        const { redisClient } = await import('../../services/redisClient');
        await redisClient.set('probe:key', 'v', 60); // engage the fallback really
        const { continuousMemory } = await import('../../services/memory/continuousMemory'); // loaded, never initialized
        assert.ok(redisClient.isMockMode() && continuousMemory);
        const { drainCurrentBackend } = await import('../../server/currentBackendDrain');
        assert.equal(await drainCurrentBackend(), true, 'idempotent receipts must succeed');
        console.log(JSON.stringify({ mode, drain_ok: true }));
    } finally {
        await endpoint.cleanup();
    }
    // natural exit: module completion drains the loop.
} else {
    throw new Error(`unknown mode: ${mode}`);
}
