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
import path from 'node:path';
const mode = process.argv[2];
// [D-CANON] Evidence directory passed ONLY as argv[3] by the supervisor: an
// absolute path owned by THIS run, outside every removable cwd and the shared
// stores root. It is never added to env or to any policy surface, so the
// module-eval env scrub is irrelevant to it. Absence is EXPECTED for every
// non-canonical mode (silent null); for a canonical memory-restart phase,
// which is always requested WITH capture, absence is an explicit evidence
// FAILURE recorded on stderr. Diagnostic evidence code NEVER alters the
// primary flow, the oracle, the stops, or cleanup - that discipline covers
// ALL of it, not only the file writes.
const isCanonicalRestart = mode === 'memory-restart-write' || mode === 'memory-restart-read';
const evidenceDir = ((): string | null => {
    const arg = process.argv[3];
    if (typeof arg !== 'string' || arg.length === 0) {
        if (isCanonicalRestart) process.stderr.write('[evidence] canonical restart phase requested WITHOUT capture dir (argv[3] missing): evidence FAILURE, primary flow untouched\n');
        return null;
    }
    if (!path.isAbsolute(arg)) {
        process.stderr.write('[evidence] argv[3] is not an absolute path; checkpoint evidence disabled\n');
        return null;
    }
    return arg;
})();
const evidenceNote = (msg: string): void => { try { process.stderr.write(`[evidence] ${msg}\n`); } catch { /* no channel left */ } };
/** [D-CANON] Checkpoint writer: captures its OWN errors (side .err file plus
 *  stderr note) and NEVER throws. Its writeFileSync IS synchronous inside the
 *  child: the capture adds overhead to the phase/exit path and is NOT
 *  temporally identical to the uninstrumented run - declared, never hidden.
 *  A checkpoint file absent because an earlier phase failed is reachability
 *  evidence for the supervisor - never a faked phase. Names are unique per
 *  mode+phase: the reader never overwrites the writer. */
const writeCheckpoint = (phase: string, build: () => Record<string, unknown>): void => {
    if (evidenceDir === null) return;
    try {
        fs.writeFileSync(path.join(evidenceDir, `${mode}.${phase}.json`), JSON.stringify(build()));
    } catch (e) {
        try { fs.writeFileSync(path.join(evidenceDir, `${mode}.${phase}.err`), String((e as Error)?.stack ?? e)); } catch { /* nothing left to record on */ }
        evidenceNote(`${phase}: checkpoint write failed (recorded separately; primary flow untouched)`);
    }
};

// [DIAG] Census of what still holds the event loop, taken AFTER teardown.
// Type names + counts only (constructor/resource names, timer period and
// callback name as owner proxies): no payloads, paths or user data, and the
// handle list is bounded to its first 8 entries. getActiveResourcesInfo is
// included because Node's _getActiveHandles() can omit Timers - timer
// evidence must be explicit. Not an oracle: if the child still fails to
// exit after this print, the census names what kept the loop alive.
const activeResourceSummary = (): Record<string, unknown> => {
    try {
        const p = process as unknown as {
            getActiveResourcesInfo?: () => string[];
            _getActiveHandles?: () => Array<Record<string, any>>;
        };
        const resourceCounts: Record<string, number> = {};
        if (typeof p.getActiveResourcesInfo === 'function') {
            for (const r of p.getActiveResourcesInfo()) resourceCounts[r] = (resourceCounts[r] ?? 0) + 1;
        }
        const handles = typeof p._getActiveHandles === 'function' ? p._getActiveHandles() : [];
        const handleHead = handles.slice(0, 8).map((h) => {
            const type = h?.constructor?.name ?? 'unknown';
            if (type === 'Timeout') return { type, idleTimeoutMs: h._idleTimeout, callback: typeof h._onTimeout === 'function' ? (h._onTimeout.name || 'anonymous') : 'none' };
            return type;
        });
        return { resourceCounts, handleTotal: handles.length, handleHead, truncated: handles.length > 8 };
    } catch (e) {
        return { censusError: String((e as Error)?.message ?? e) };
    }
};
fs.mkdirSync('data', { recursive: true });

// memory-restart-* fixture corpus: plain third-person public fixture text (no
// first-person statements, so the continuum perspective transform must be an
// identity on it; the oracle asserts exact content equality). source is
// USER_INFERRED (no owner message exists to quote, so USER_STATED would be
// false provenance), status hypothesis, so the continuum provenance tag is
// deterministically source:ASSISTANT_SAID.
type FixtureFact = {
    type: string;
    content: string;
    subject?: string;
    attribute?: string;
    value?: string;
    source: 'USER_INFERRED';
    status: 'hypothesis';
    confidence: number;
};
const FIXTURE_OWNER_A = 'fixture-owner-a';
const FIXTURE_OWNER_B = 'fixture-owner-b';
const FIXTURE_FACTS_A: FixtureFact[] = [
    { type: 'PROJECT', content: 'Project Kestrel deploy window is Friday 18:00.', subject: 'Kestrel', attribute: 'deploy_window', value: 'Friday 18:00', source: 'USER_INFERRED', status: 'hypothesis', confidence: 0.7 },
    { type: 'PREFERENCE', content: 'Kestrel release notes go to the ops channel first.', source: 'USER_INFERRED', status: 'hypothesis', confidence: 0.6 }
];
const FIXTURE_FACT_B: FixtureFact = { type: 'PROJECT', content: 'Project Albedo uses a weekly review cadence.', subject: 'Albedo', attribute: 'cadence', value: 'weekly', source: 'USER_INFERRED', status: 'hypothesis', confidence: 0.8 };
const FIXTURE_FACTS: FixtureFact[] = [...FIXTURE_FACTS_A, FIXTURE_FACT_B];
const FIXTURE_WRITES: Array<{ fact: FixtureFact; owner: string }> = [
    ...FIXTURE_FACTS_A.map(fact => ({ fact, owner: FIXTURE_OWNER_A })),
    { fact: FIXTURE_FACT_B, owner: FIXTURE_OWNER_B }
];

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

if (mode === 'producers-never-started') {
    const endpoint = await resettingEndpoint();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(endpoint.port);
    process.env.NEO4J_URI = `bolt://127.0.0.1:${endpoint.port}`;
    try {
        const { ownedProducerNames } = await import('../../services/lifecycle/ownedProducers');
        assert.deepEqual(ownedProducerNames(), [], 'reading ownership must not construct producers');
        const { drainCurrentBackend, getLastDrainProducerReceipts } = await import('../../server/currentBackendDrain');
        assert.equal(await drainCurrentBackend(), true);
        assert.deepEqual(ownedProducerNames(), [], 'drain must not import and arm previously unused producers');
        assert.deepEqual(getLastDrainProducerReceipts(), {});
    } finally { await endpoint.cleanup(); }
    console.log(JSON.stringify({ mode, noProducerAcquired: true, activeResources: activeResourceSummary() }));
} else if (mode === 'narrative-pending-storage-failure') {
    const endpoint = await resettingEndpoint();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(endpoint.port);
    process.env.NEO4J_URI = `bolt://127.0.0.1:${endpoint.port}`;
    let primaryError: unknown = null;
    const cleanupErrors: unknown[] = [];
    let retryPreserved: number | null = null;
    try {
        const { narrative } = await import('../../services/narrativeService');
        await narrative.enqueuePendingNarration({ source: 'CONSCIOUS', content: 'Public fixture storage failure', importance: 0.9 });
        const before = await narrative.pendingNarrationSnapshot();
        fs.mkdirSync('data', { recursive: true });
        const journalPath = 'data/wal/pending-narrations.json';
        const backupPath = journalPath + '.fixture-backup';
        const original = fs.readFileSync(journalPath);
        fs.renameSync(journalPath, backupPath);
        fs.mkdirSync(journalPath); // real rename obstruction at the destination

        try {
            const failed = await narrative.preserveAndStopBatchProcessor();
            assert.equal(failed.error, 'PRESERVATION_FAILED');
            assert.equal(failed.remainingItems, 1);
            assert.equal(failed.pendingPreserved, 0);
            assert.deepEqual(await narrative.pendingNarrationSnapshot(), before);
            const { drainCurrentBackend } = await import('../../server/currentBackendDrain');
            assert.equal(await drainCurrentBackend(), false, 'failed preservation must fail real drain before store closure');
            assert.equal(fs.statSync(journalPath).isDirectory(), true);
            assert.deepEqual(fs.readFileSync(backupPath), original);
        } finally {
            fs.rmdirSync(journalPath);
            fs.renameSync(backupPath, journalPath);
        }
        // Retry the SAME real drain after storage recovery, not just producer
        // stops. The failed drain intentionally left backing services open.
        const { drainCurrentBackend, getLastDrainProducerReceipts } = await import('../../server/currentBackendDrain');
        assert.equal(await drainCurrentBackend(), true, 'restored storage must permit the full drain, including backing services');
        const retry = getLastDrainProducerReceipts()?.narrative;
        assert.ok(retry, 'full drain retry must receipt the registered narrative owner');
        assert.equal(retry.error, null);
        assert.equal(retry.pendingPreserved, 1);
        retryPreserved = retry.pendingPreserved;
        assert.deepEqual(JSON.parse(fs.readFileSync('data/wal/pending-narrations.json', 'utf8')).items, before);
    } catch (error) {
        primaryError = error;
    } finally {
        // Cleanup uses the product drain too, including when an assertion
        // failed after the initial false drain. Never mask the primary error.
        try {
            const { drainCurrentBackend } = await import('../../server/currentBackendDrain');
            assert.equal(await drainCurrentBackend(), true, 'fixture cleanup full drain must complete');
        } catch (error) { cleanupErrors.push(error); }
        try { await endpoint.cleanup(); } catch (error) { cleanupErrors.push(error); }
    }
    if (primaryError !== null) {
        if (cleanupErrors.length > 0) console.error('[narrative storage fixture cleanup errors]', cleanupErrors);
        throw primaryError;
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'narrative storage fixture cleanup failed');
    console.log(JSON.stringify({ mode, failedWithoutLoss: true, retryPreserved, fullDrainRetried: true, activeResources: activeResourceSummary() }));
} else if (mode === 'narrative-pending-write' || mode === 'narrative-pending-read') {
    const endpoint = await resettingEndpoint();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(endpoint.port);
    process.env.NEO4J_URI = `bolt://127.0.0.1:${endpoint.port}`;
    const fixture = [
        { source: 'CONSCIOUS', content: 'Public fixture pending thought one', importance: 0.9, metadata: { fixture: 1 } },
        { source: 'AGENCY', content: 'Public fixture pending thought two', importance: 0.8, metadata: { fixture: 2 } }
    ];
    let receipt: Record<string, unknown> = {};
    let stopNarrative: (() => Promise<unknown>) | null = null;
    try {
        const { narrative } = await import('../../services/narrativeService');
        stopNarrative = () => narrative.preserveAndStopBatchProcessor();
        if (mode === 'narrative-pending-write') {
            for (const item of fixture) await narrative.enqueuePendingNarration(item);
        }
        const pending = await narrative.pendingNarrationSnapshot();
        assert.deepEqual(pending.map(({ id, ...item }) => item), fixture, 'original work must recover byte-for-value, not narrated filler');
        assert.equal(new Set(pending.map(item => item.id)).size, 2);
        const { drainCurrentBackend, getLastDrainProducerReceipts } = await import('../../server/currentBackendDrain');
        const drainOk = await drainCurrentBackend();
        const stops = getLastDrainProducerReceipts();
        // Evidence only: never a second mode receipt, never pending payloads.
        // Three known owners, at most 20 scalar fields each, strings <=160.
        try {
            const owners: Record<string, unknown> = {};
            for (const owner of ['narrative', 'arbiter', 'power'] as const) {
                const value = stops?.[owner];
                owners[owner] = value ? Object.fromEntries(Object.entries(value).slice(0, 20)
                    .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
                    .map(([k, v]) => [k.slice(0, 64), typeof v === 'string' ? v.slice(0, 160) : v])) : null;
            }
            const diagnostic = JSON.stringify({ phase: 'pending-drain-diagnostic', drainOk, producerReceipts: owners });
            console.log('[drain-diagnostic] ' + (diagnostic.length <= 8192 ? diagnostic : '{"diagnosticTruncated":true}'));
        } catch {
            try { console.error('[drain-diagnostic] unavailable; primary assertion follows'); } catch { /* evidence only */ }
        }
        assert.equal(drainOk, true);
        assert.equal(stops?.narrative?.pendingPreserved, 2);
        assert.equal(stops?.narrative?.remainingItems, 0);
        assert.equal(stops?.narrative?.error, null);
        const journal = JSON.parse(fs.readFileSync('data/wal/pending-narrations.json', 'utf8'));
        assert.deepEqual(journal.items, pending);
        assert.deepEqual(journal.completed, [], 'shutdown must not process pending work');
        // Sequential stop cannot overwrite two durable pendings with [].
        await narrative.preserveAndStopBatchProcessor();
        await assert.rejects(narrative.enqueuePendingNarration({ source: 'AGENCY', content: 'Public late fixture refusal', importance: 0.8 }), 'late work must be explicitly refused, not acknowledged');
        const afterRefusal = await narrative.preserveAndStopBatchProcessor();
        assert.equal(afterRefusal.error, null, 'late refusal must not poison preservation');
        assert.equal(afterRefusal.refusedLate, 1, 'rejected work must be counted, not claimed preserved');
        assert.equal(afterRefusal.pendingPreserved, 2);
        assert.deepEqual(JSON.parse(fs.readFileSync('data/wal/pending-narrations.json', 'utf8')).items, pending);
        receipt = { mode, pendingRecovered: mode.endsWith('read') ? pending.length : 0,
            pendingPreserved: stops?.narrative?.pendingPreserved, originalWorkEqual: true,
            completedDuringDrain: journal.completed.length };
    } finally {
        try { await stopNarrative?.(); } finally { await endpoint.cleanup(); }
    }
    console.log(JSON.stringify({ ...receipt, activeResources: activeResourceSummary() }));
} else if (mode === 'redis-fallback-quiet') {
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
        const connectFailure = redisClient.getLastConnectFailure();
        assert.ok(connectFailure, 'the rejected real connect attempt must be receipted, not inferred from logs');
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
        console.log(JSON.stringify({ mode, fallback_visible: true, fallback_noise: false, shared_disconnect_promise: true, redis_connect_failure: connectFailure, activeResources: activeResourceSummary() }));
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
        const connectFailure = redisClient.getLastConnectFailure();
        assert.ok(connectFailure, 'the rejected real connect attempt must be receipted, not inferred from logs');
        const { drainCurrentBackend, getLastDrainProducerReceipts } = await import('../../server/currentBackendDrain');
        assert.equal(await drainCurrentBackend(), true, 'idempotent receipts must succeed');
        const producerStops = getLastDrainProducerReceipts();
        assert.deepEqual(producerStops, {}, 'never-used producers must remain unconstructed during drain');
        console.log(JSON.stringify({ mode, drain_ok: true, redis_connect_failure: connectFailure, producer_stops: producerStops, activeResources: activeResourceSummary() }));
    } finally {
        await endpoint.cleanup();
    }
    // natural exit: module completion drains the loop.
} else if (mode === 'sqlite-close-causality') {
    // Step-5 causality of the REAL drain: a genuinely busy SQLite (live
    // multi-row iterator) must fail the drain with the step-5 error and NO
    // SQLite-success receipt, repeatedly (failure is not consumed), while no
    // other component fails; releasing the iterator must let a later drain
    // really close the handle. Fresh child = fresh singleton (retry-safe);
    // the child (not the drain) imports sqliteService, so no acquisition
    // happens inside the drain during this proof.
    const endpoint = await resettingEndpoint();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(endpoint.port);
    process.env.NEO4J_URI = `bolt://127.0.0.1:${endpoint.port}`;
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: any[]) => { errors.push(args.map(String).join(' ')); originalError(...args); };
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); originalLog(...args); };
    // Tracked acquisitions: released independently in the finally, so one
    // cleanup failure never skips the rest nor replaces the primary error.
    let iterator: IterableIterator<unknown> | null = null;
    let acquiredCore: { close: () => void; db: { open: boolean } } | null = null;
    const cleanupErrors: unknown[] = [];
    try {
        // Established quiet Redis fallback (real connect attempt against the
        // fixture's own resetting endpoint) and healthy never-started memory:
        // continuousMemory is loaded but never initialized.
        const { redisClient } = await import('../../services/redisClient');
        await redisClient.set('probe:key', 'v', 60);
        const { continuousMemory } = await import('../../services/memory/continuousMemory');
        assert.ok(redisClient.isMockMode() && continuousMemory);
        assert.ok(redisClient.getLastConnectFailure(), 'the rejected real connect attempt must be receipted, not inferred from logs');

        const { sqliteService } = await import('../../services/sqliteService');
        acquiredCore = sqliteService;
        const db = sqliteService.db;
        assert.equal(db.open, true);
        db.exec('CREATE TABLE IF NOT EXISTS close_causality_probe (id INTEGER PRIMARY KEY, v TEXT)');
        db.prepare('INSERT INTO close_causality_probe (v) VALUES (?)').run('a');
        db.prepare('INSERT INTO close_causality_probe (v) VALUES (?)').run('b');
        iterator = db.prepare('SELECT v FROM close_causality_probe ORDER BY id').iterate();
        assert.equal(iterator.next().done, false, 'probe must be multi-row so the iterator is genuinely live');

        const { drainCurrentBackend } = await import('../../server/currentBackendDrain');
        // Per-invocation slices: each drain call is judged on ITS OWN new
        // error/log lines, never on a first-call snapshot.
        const drainOnce = async () => {
            const errorsBefore = errors.length;
            const logsBefore = logs.length;
            const result = await drainCurrentBackend();
            return { result, newErrors: errors.slice(errorsBefore), newLogs: logs.slice(logsBefore) };
        };
        const sqliteFailures = (lines: string[]) => lines.filter(line => line.includes('[SHUTDOWN] SQLite close failed'));
        const otherFailures = (lines: string[]) => lines.filter(line => line.startsWith('[SHUTDOWN]') && (line.includes('failed') || line.includes('unverified')) && !line.includes('SQLite close failed'));
        const sqliteSuccess = (lines: string[]) => lines.filter(line => line.includes('[SHUTDOWN] SQLite closed'));

        const first = await drainOnce();
        assert.equal(first.result, false, 'busy SQLite must fail the drain');
        assert.equal(sqliteFailures(first.newErrors).length, 1, 'first busy drain must log its own step-5 failure');
        assert.deepEqual(sqliteSuccess(first.newLogs), [], 'no false SQLite success receipt (first busy drain)');
        assert.deepEqual(otherFailures(first.newErrors), [], `no other counted component failure (first busy drain): ${otherFailures(first.newErrors).join(' | ')}`);
        const openBusyFirst = db.open;
        assert.equal(openBusyFirst, true, 'failed close leaves the handle owned and open (first)');

        const repeat = await drainOnce();
        assert.equal(repeat.result, false, 'repeated drain while busy must fail again: the failure is not consumed');
        assert.equal(sqliteFailures(repeat.newErrors).length, 1, 'repeat busy drain must log its OWN step-5 failure');
        assert.deepEqual(sqliteSuccess(repeat.newLogs), [], 'no false SQLite success receipt (repeat busy drain)');
        assert.deepEqual(otherFailures(repeat.newErrors), [], `no other counted component failure (repeat busy drain): ${otherFailures(repeat.newErrors).join(' | ')}`);
        const openBusyRepeat = db.open;
        assert.equal(openBusyRepeat, true, 'failed close leaves the handle owned and open (repeat)');

        iterator.return?.(); // release the real iterator, then the retry must really close
        iterator = null;
        const after = await drainOnce();
        assert.equal(after.result, true, 'drain must succeed once the iterator settles');
        assert.equal(sqliteSuccess(after.newLogs).length, 1, 'qualified SQLite success receipt after release');
        assert.ok(sqliteSuccess(after.newLogs)[0].includes('(driver close completed'), 'success receipt must carry the no-persistence qualifier');
        assert.deepEqual(otherFailures(after.newErrors), [], `no other counted component failure (post-release drain): ${otherFailures(after.newErrors).join(' | ')}`);
        assert.equal(db.open, false, 'retry really closed the driver handle');

        console.log(JSON.stringify({
            mode,
            drain_busy_first: first.result,
            drain_busy_repeat: repeat.result,
            drain_after_release: after.result,
            step5_errors_first: sqliteFailures(first.newErrors).length,
            step5_errors_repeat: sqliteFailures(repeat.newErrors).length,
            other_failures_first: otherFailures(first.newErrors).length,
            other_failures_repeat: otherFailures(repeat.newErrors).length,
            other_failures_after_release: otherFailures(after.newErrors).length,
            open_while_busy_first: openBusyFirst,
            open_while_busy_repeat: openBusyRepeat,
            open_after_release: db.open,
            redis_connect_failure: redisClient.getLastConnectFailure(),
            activeResources: activeResourceSummary(),
            memory_step1_uninvolved: otherFailures(first.newErrors).length + otherFailures(repeat.newErrors).length + otherFailures(after.newErrors).length === 0
        }));
    } finally {
        // Independent cleanup attempts, primary error always preserved.
        try { iterator?.return?.(); iterator = null; } catch (e) { cleanupErrors.push(e); }
        try { console.error = originalError; console.log = originalLog; } catch (e) { cleanupErrors.push(e); }
        try { if (acquiredCore && acquiredCore.db.open) acquiredCore.close(); } catch (e) { cleanupErrors.push(e); }
        try { await endpoint.cleanup(); } catch (e) { cleanupErrors.push(e); }
        if (cleanupErrors.length > 0) originalError('[sqlite-close-causality cleanup errors]', cleanupErrors);
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'sqlite-close-causality cleanup failed');
    // natural exit: module completion drains the loop.
} else if (mode === 'memory-restart-write' || mode === 'memory-restart-read') {
    // Cross-process canonical memory restart slice. The WRITER persists facts
    // through the REAL factRepository.addFact (durable SQLite + honest graph/
    // continuum projection receipts) and exits through the REAL drain; the
    // READER is a fresh process over the same two owned stores and is the
    // oracle: exact owner-scoped SQLite rows AND exact LONG nodes in the
    // canonical LanceDB store. No mocks, providers OFF, every lazy connection
    // lands on the controlled endpoint below. Both phases share ONLY the two
    // explicit store paths from the supervisor env; cwd-relative state stays
    // per-child.
    const endpoint = await resettingEndpoint();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(endpoint.port);
    process.env.NEO4J_URI = `bolt://127.0.0.1:${endpoint.port}`;
    const cleanupErrors: unknown[] = [];
    // Tracked cascade producer refs for the finally safety net. OWNERSHIP of
    // the stops moved to the drain (step 1.5): these refs only let the
    // finally stop them idempotently when an early failure prevented the
    // drain from running; the asserted receipts are the drain's. All three
    // refs stay null in the READER, which never stores and must not acquire
    // these producers.
    let writerArbiter: { stopProcessingTimer(): { intervalWasArmed: boolean; pendingAdmissions: number; activeAdmissions: number; activeQueueRuns: number } } | null = null;
    let writerPower: { stopThrottleTimer(): { intervalWasArmed: boolean } } | null = null;
    let writerNarrative: { stopBatchProcessor(): { intervalWasArmed: boolean; queuedItems: number } } | null = null;
    let writerProducerStops: import('../../server/currentBackendDrain').DrainProducerReceipts | null = null;
    let writerReceipt: Record<string, unknown> | null = null;
    let readerReceipt: Record<string, unknown> | null = null;
    // [D-CANON] Diagnostic observation STATE and helpers at BRANCH scope (the
    // sibling finally's CP2 must see them); the RISKY imports/init live
    // INSIDE the try below, so the endpoint cleanup always runs on failure.
    let captureWatermark: typeof import('../../services/asyncWorkLedger').captureWatermark | null = null;
    let getEvidenceSnapshot: typeof import('../../services/asyncWorkLedger').getEvidenceSnapshot | null = null;
    let o1Observation: () => Record<string, unknown> = () => ({ observation: 'unavailable' });
    let o2Token: number | null = null;
    let predrainReached = false;
    const o2Checkpoint = (tokenKind: string, token: number | null): Record<string, unknown> => ({
        mode,
        tokenKind,
        watermarkOrdinal: token,
        o2: token !== null && getEvidenceSnapshot !== null
            ? { observation: 'snapshot', evidence: getEvidenceSnapshot(token) }
            : { observation: 'unavailable' },
        o1: o1Observation()
    });
    try {
        // [D-CANON] Neutral pre-imports with ZERO product dependencies
        // (verified in source), BEFORE the first product import of this
        // branch and AFTER the policy env above. On ANY failure the
        // observation degrades to 'unavailable': recorded, never thrown, and
        // the real work continues with honestly degraded checkpoints.
        try {
            const ownership = await import('../../services/startupOwnership');
            const ledger = await import('../../services/asyncWorkLedger');
            const startupHandle = ownership.getSingletonStartupHandle();
            // The settlement Promise is NEVER inspected and no state
            // (started/pending/prepared) is inferred from it: the receipt is
            // captured locally IF and WHEN it arrives. Plain-data report only.
            let startupReceipt: unknown = null;
            startupHandle.settlement.then(
                r => { startupReceipt = r; },
                (e: unknown) => { startupReceipt = { settlementRejected: e instanceof Error ? e.message : String(e) }; }
            );
            o1Observation = () => startupReceipt !== null
                ? { observation: 'receipt-observed', receipt: startupReceipt }
                : { observation: 'receipt-not-yet-observed', id: startupHandle.id, claimId: startupHandle.claimId };
            captureWatermark = ledger.captureWatermark;
            getEvidenceSnapshot = ledger.getEvidenceSnapshot;
        } catch (e) {
            evidenceNote(`diagnostic observation unavailable: ${String((e as Error)?.message ?? e)}`);
        }
        // DETERMINISTIC OWNED STARTUP PRECONDITIONS (before any memory import):
        // 1. A valid empty volatile snapshot at the owned cwd path: continuum's
        //    unawaited loadSnapshot settles on DISK with zero merges and never
        //    takes the Redis fallback (continuumMemory.ts:191-229). Not a sleep,
        //    not import-as-settlement: the file content forces the branch.
        // 2. Fresh owned cwd => transition journal absent => pending() returns
        //    [] (memoryTransitions.ts:196-204) => reconcileTransitions replays
        //    zero entries and schedules no late writes.
        // 3. active_goals=[] seeded and VERIFIED through the REAL SQLite config
        //    API so introspectionEngine.loadGoalsFromMemory takes its SQLite
        //    early return (introspectionEngine.ts:416-426) and never reaches
        //    the legacy continuum.retrieve -> geminiService embedding resolver.
        fs.writeFileSync(path.join('data', 'memory_snapshot.json'), JSON.stringify({ working: [] }));
        assert.equal(fs.existsSync(path.join('data', 'memory-transitions')), false, 'transition journal must be absent in a fresh owned cwd');
        // [D-CANON] An import failure here is recorded SEPARATELY and the
        // original error rethrown untouched. It is NEVER marked on the O1
        // singleton ticket: this import is not the ticket owner's import, so
        // a failure here proves nothing about the owner's module evaluation.
        let sqliteService: typeof import('../../services/sqliteService').sqliteService;
        try {
            ({ sqliteService } = await import('../../services/sqliteService'));
        } catch (e) {
            evidenceNote(`sqliteService import failed: ${String((e as Error)?.message ?? e)}`);
            throw e;
        }
        sqliteService.setConfig('active_goals', []);
        assert.deepEqual(sqliteService.getConfig('active_goals'), [], 'active_goals seed must verify through the real config API');
        const { factRepository } = await import('../../services/memory/factRepository');
        const { lancedbService } = await import('../../services/lancedbService');
        const { MemoryTier } = await import('../../types');

        const expectedContinuumTags = (fact: typeof FIXTURE_FACTS[number], owner: string, id: string): string[] =>
            ['FACT', 'USER', fact.type, fact.source, `attr:${fact.attribute ?? 'general'}`, `owner:${owner}`, `factid:${id}`, 'source:ASSISTANT_SAID'];
        const assertSqliteRow = (row: any, fact: typeof FIXTURE_FACTS[number], owner: string) => {
            assert.ok(row, `SQLite row for "${fact.content}" must exist`);
            assert.equal(row.ownerId, owner);
            assert.equal(row.type, fact.type);
            assert.equal(row.content, fact.content);
            assert.equal(row.subject ?? null, fact.subject ?? null);
            assert.equal(row.attribute ?? null, fact.attribute ?? null);
            assert.equal(row.value ?? null, fact.value ?? null);
            assert.equal(row.source, fact.source);
            assert.equal(row.quote ?? null, null);
            assert.equal(row.status, fact.status);
            assert.equal(row.confidence, fact.confidence);
            assert.equal(row.retractedAt, null);
            assert.equal(typeof row.createdAt, 'number');
            assert.equal(typeof row.updatedAt, 'number');
        };
        const assertLongNode = (node: any, fact: typeof FIXTURE_FACTS[number], owner: string, id: string) => {
            assert.ok(node, `LONG node for fact ${id} must exist in the canonical store`);
            assert.equal(node.tier, MemoryTier.LONG);
            // Third-person fixture text must survive verbatim: any perspective
            // transform would break this equality and fail the oracle loudly.
            assert.equal(node.content, fact.content, 'stored content must be exact');
            assert.equal(node.originalContent, fact.content, 'originalContent must be exact');
            assert.equal(node.ownerId, owner);
            for (const t of expectedContinuumTags(fact, owner, id)) {
                assert.ok(node.tags.includes(t), `LONG node ${id} missing tag ${t}`);
            }
            // Contradiction rejection: exactly one owner tag and exactly one
            // provenance tag, matching expectation (inclusion alone would let a
            // contradictory second tag pass).
            const ownerTags = node.tags.filter((t: string) => t.startsWith('owner:'));
            assert.deepEqual(ownerTags, [`owner:${owner}`], `LONG node ${id} owner tags contradictory`);
            const sourceTags = node.tags.filter((t: string) => t.startsWith('source:'));
            assert.deepEqual(sourceTags, ['source:ASSISTANT_SAID'], `LONG node ${id} provenance tags contradictory`);
            assert.ok(node.tags.includes('FACT'), `LONG node ${id} must carry the FACT tag`);
        };
        // Duplicate factid projections FAIL: a Map overwrite would silently
        // hide a contradictory second projection.
        const longFactNodes = async (): Promise<Map<string, any>> => {
            const nodes = await lancedbService.getNodesByTier(MemoryTier.LONG, 100);
            const byFactId = new Map<string, any>();
            for (const n of nodes) {
                const factIdTags = (n.tags ?? []).filter((t: string) => t.startsWith('factid:'));
                if (factIdTags.length === 0) continue;
                assert.equal(factIdTags.length, 1, `LONG node ${n.id} must carry exactly one factid tag, got ${factIdTags.length}`);
                const factId = factIdTags[0].slice('factid:'.length);
                assert.ok(!byFactId.has(factId), `duplicate LONG projection for fact ${factId}`);
                byFactId.set(factId, n);
            }
            return byFactId;
        };

        if (mode === 'memory-restart-write') {
            // DELIBERATE WRITER-ONLY CASCADE ACQUISITION (before any write):
            // every addFact below fires continuum.store's fire-and-forget
            // `import('./dreamerService')` cascade. Acquiring the chain here,
            // up front, makes the writer the EXPLICIT owner of the cascade
            // producers (resourceArbiter's ref'd queue timer - armed through
            // a pending powerManager import - and powerManager's ref'd 30s
            // throttle timer) so their stops are attempted in the finally on
            // EVERY outcome, not only after all assertions pass. The READER
            // never runs this and never acquires these producers.
            // dreamerService statically imports geminiService, so this slice
            // is NOT model-module-import-free: providers OFF prevents
            // provider/local model WORK, not the import. Its requestAdmission
            // calls are reachable only via attemptDream/triggerNeuralTraining
            // (dream loop never started here; 3 notifications stay below the
            // 30-count forced-dream cap), so the fixture invokes no admission.
            await import('../../services/dreamerService');
            writerArbiter = (await import('../../services/resourceArbiter')).resourceArbiter;
            writerPower = (await import('../../services/powerManager')).powerManager;
            // narrativeService arms a REF'd 30s batch interval at construction
            // (module singleton, imported by the genesis cascade below) with no
            // unref and no other stop path: without this stop it holds the event
            // loop after all work drains (memory-restart-facts timeout evidence).
            writerNarrative = (await import('../../services/narrativeService')).narrative;
            const receipts = [];
            for (const { fact, owner } of FIXTURE_WRITES) receipts.push(await factRepository.addFact({ ...fact }, owner));
            for (let i = 0; i < FIXTURE_WRITES.length; i++) {
                const r = receipts[i];
                assert.equal(r.action, 'ADD');
                assert.equal(r.sqliteRows, 1, 'durable SQLite row must be written');
                const graph = r.projections.find(p => p.backend === 'graph');
                const cont = r.projections.find(p => p.backend === 'continuum');
                // Graph receipt: RECORDED and reported verbatim. Against the
                // controlled dead endpoint the actual serving path may be the
                // graphService SQLite fallback (graphService.runQuery ->
                // runSqliteQuery), so ok is NOT asserted either way and never
                // counted toward this slice's success: graph persistence is an
                // explicitly uncovered projection here.
                assert.ok(graph, 'graph projection receipt must be recorded');
                assert.equal(typeof graph.ok, 'boolean');
                assert.ok(cont, 'continuum projection receipt must be recorded');
                assert.equal(cont.ok, true, `continuum LONG projection must genuinely succeed (receipt: ${cont?.detail})`);
            }
            // Void-silent guard: continuum.store resolves void even when an
            // internal gate (loop pattern, dedup, schema gate) rejected the
            // write, so a true receipt alone can claim a write that never
            // landed. The nodes must actually EXIST in this same process.
            const byFactId = await longFactNodes();
            assert.equal(byFactId.size, FIXTURE_WRITES.length, 'exactly the written fact projections must exist');
            for (let i = 0; i < FIXTURE_WRITES.length; i++) {
                assertLongNode(byFactId.get(receipts[i].id), FIXTURE_WRITES[i].fact, FIXTURE_WRITES[i].owner, receipts[i].id);
            }
            // [D-CANON] CP1 predrain: capture+token+snapshot ALL inside the
            // no-throw evidence discipline. The ONE O2 cohort token of this
            // child is fixed HERE and reused by CP2.
            try {
                if (o2Token === null && captureWatermark !== null) o2Token = captureWatermark();
                const token = o2Token;
                if (token !== null) predrainReached = true;
                writeCheckpoint('predrain', () => o2Checkpoint(token === null ? 'unavailable' : 'predrain', token));
            } catch (e) { evidenceNote(`predrain: checkpoint failed: ${String((e as Error)?.message ?? e)}`); }
            const { drainCurrentBackend, getLastDrainProducerReceipts } = await import('../../server/currentBackendDrain');
            const drainOk = await drainCurrentBackend();
            writerProducerStops = getLastDrainProducerReceipts();
            assert.equal(drainOk, true, 'graceful drain must succeed');
            // Receipt prints AFTER the finally teardown (see below), so a
            // teardown defect fails the phase with the measured stop counters
            // instead of surfacing as a supervisor timeout.
            writerReceipt = { mode, sqlite_ids: receipts.map(r => r.id), lance_fact_ids: [...byFactId.keys()], receipts, drain_ok: drainOk };
        } else {
            // READER (fresh process): the oracle. Every assertion reads through
            // the real read paths over the shared owned stores.
            const aFacts = factRepository.getFacts(FIXTURE_OWNER_A);
            const bFacts = factRepository.getFacts(FIXTURE_OWNER_B);
            assert.equal(aFacts.length, FIXTURE_FACTS_A.length, 'owner A must read back exactly its written facts');
            assert.equal(bFacts.length, 1, 'owner B must read back exactly its written fact');
            const aByContent = new Map(aFacts.map((r: any) => [r.content, r]));
            for (const fact of FIXTURE_FACTS_A) assertSqliteRow(aByContent.get(fact.content), fact, FIXTURE_OWNER_A);
            assertSqliteRow(bFacts[0], FIXTURE_FACT_B, FIXTURE_OWNER_B);
            // Wrong-owner isolation on the real scoped read path.
            for (const row of aFacts) assert.equal(factRepository.getFact(row.id, FIXTURE_OWNER_B), null, 'owner B must not see owner A facts');
            assert.equal(factRepository.getFact(bFacts[0].id, FIXTURE_OWNER_A), null, 'owner A must not see owner B facts');
            // Canonical LONG store read-back: exactly the written projections,
            // each factid tag identical to the durable SQLite row id.
            const byFactId = await longFactNodes();
            assert.equal(byFactId.size, FIXTURE_WRITES.length, 'exactly the written fact projections must survive the restart');
            const expectedLong: Array<{ row: any; fact: typeof FIXTURE_FACTS[number]; owner: string }> = [
                ...FIXTURE_FACTS_A.map(fact => ({ row: aByContent.get(fact.content), fact, owner: FIXTURE_OWNER_A })),
                { row: bFacts[0], fact: FIXTURE_FACT_B, owner: FIXTURE_OWNER_B }
            ];
            for (const { row, fact, owner } of expectedLong) {
                assertLongNode(byFactId.get(row.id), fact, owner, row.id);
            }
            // [D-CANON] CP1 predrain: capture+token+snapshot ALL inside the
            // no-throw evidence discipline. The ONE O2 cohort token of this
            // child is fixed HERE and reused by CP2.
            try {
                if (o2Token === null && captureWatermark !== null) o2Token = captureWatermark();
                const token = o2Token;
                if (token !== null) predrainReached = true;
                writeCheckpoint('predrain', () => o2Checkpoint(token === null ? 'unavailable' : 'predrain', token));
            } catch (e) { evidenceNote(`predrain: checkpoint failed: ${String((e as Error)?.message ?? e)}`); }
            const { drainCurrentBackend } = await import('../../server/currentBackendDrain');
            const drainOk = await drainCurrentBackend();
            assert.equal(drainOk, true, 'reader graceful drain must succeed');
            readerReceipt = {
                mode,
                sqlite_ids_a: aFacts.map((r: any) => r.id),
                sqlite_ids_b: bFacts.map((r: any) => r.id),
                lance_fact_ids: [...byFactId.keys()],
                drain_ok: drainOk
            };
        }
    } finally {
        // Independent cleanup attempts, primary error always preserved.
        // WRITER-ONLY producer teardown on EVERY outcome (success or
        // failure): without these stops the ref'd intervals hold the event
        // loop, and a primary assertion failure would be buried under the
        // supervisor timeout. If an early failure left a tracked ref null,
        // the import below returns the already-evaluated module when the
        // cascade loaded it (no re-evaluation); when the module truly never
        // loaded it deliberately acquires-then-immediately-stops it - the
        // stop latch prevents the pending arbiter arm and powerManager's
        // synchronously armed interval is cleared by its stop, so this path
        // cannot leak a timer either. The READER skips this entirely: it
        // never stores, and its import chain (factRepository ->
        // continuumMemory/graphService, lancedbService, sqliteService, drain)
        // contains no resourceArbiter/powerManager/dreamerService reference
        // (source-checked); initializeNervousSystem's heartbeat start is only
        // invoked by the server boot loaders, and the gated powerManager
        // imports inside introspectionEngine/curiosityService never run at
        // module evaluation. Importing those singletons in the reader just
        // to stop them would ACQUIRE producers that phase never started.
        if (mode === 'memory-restart-write') {
            try {
                if (writerArbiter === null) writerArbiter = (await import('../../services/resourceArbiter')).resourceArbiter;
                writerArbiter.stopProcessingTimer();
            } catch (e) { cleanupErrors.push(e); }
            try {
                if (writerPower === null) writerPower = (await import('../../services/powerManager')).powerManager;
                writerPower.stopThrottleTimer();
            } catch (e) { cleanupErrors.push(e); }
            try {
                if (writerNarrative === null) writerNarrative = (await import('../../services/narrativeService')).narrative;
                writerNarrative.stopBatchProcessor();
            } catch (e) { cleanupErrors.push(e); }
        }
        // lancedbService exposes no close(): its connection teardown is process
        // exit itself, which the natural-exit supervision verifies.
        try { await endpoint.cleanup(); } catch (e) { cleanupErrors.push(e); }
        // [D-CANON] CP2 post-cleanup-attempts: inside this outer finally so
        // it runs on EVERY outcome (success, assertion failure, cleanup
        // failure), BEFORE the aggregation throw and the receipt asserts
        // below. Fully no-throw; primary error, stops order and aggregation
        // untouched. Fallback token is labelled distinctly when CP1 never ran.
        try {
            if (o2Token === null && captureWatermark !== null) o2Token = captureWatermark();
            const token = o2Token;
            const tokenKind = token === null ? 'unavailable' : (predrainReached ? 'predrain' : 'fallback-no-predrain');
            writeCheckpoint('postcleanup', () => o2Checkpoint(tokenKind, token));
        } catch (e) { evidenceNote(`postcleanup: checkpoint failed: ${String((e as Error)?.message ?? e)}`); }
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, `${mode} cleanup failed`);
    // Receipts print only after teardown, only on full success.
    if (writerReceipt !== null) {
        const stops = writerProducerStops;
        // DRAIN-owned producer receipts (step 1.5): the drain, not this
        // child, stopped narrative/arbiter/power; the finally stops above are
        // only an early-failure safety net and are never asserted. Counters
        // stay scoped to THIS process's own usage (source-checked: the writer
        // reaches no requestAdmission call), so zeros are expected values,
        // not a generic settled-state claim.
        assert.ok(stops, 'drain producer receipts must exist: the drain owns these stops');
        assert.equal(stops.narrative?.intervalWasArmed, true, 'narrative batch timer must have been armed in this writer process');
        assert.equal(stops.narrative?.remainingItems, 0, 'no queued narration may be lost at drain');
        assert.equal(stops.narrative?.error, null, 'narrative queue flush must not fail');
        assert.equal(stops.arbiter?.intervalWasArmed, true, 'arbiter processing timer must have been armed in this writer process');
        assert.equal(stops.arbiter?.remainingQueue, 0, 'no queued admission promise may exist at drain');
        assert.equal(stops.arbiter?.activeAdmissions, 0, 'no in-flight admission may exist at drain');
        assert.equal(stops.arbiter?.activeQueueRuns, 0, 'no in-flight queue processing may exist at drain');
        assert.equal(stops.arbiter?.boundExhausted, false, 'arbiter drain must not exhaust its bound');
        assert.equal(stops.power?.intervalWasArmed, true, 'power throttle timer must have been armed in this writer process');
        // [DIAG] The post-teardown active-resource census rides INSIDE the
        // parsed receipt so it is preserved on the green path too (bounded
        // labels/counts, never user data).
        console.log(JSON.stringify({ ...writerReceipt, stops, activeResources: activeResourceSummary() }));
    } else if (readerReceipt !== null) {
        console.log(JSON.stringify({ ...readerReceipt, activeResources: activeResourceSummary() }));
    }
    // natural exit: module completion drains the loop.
} else {
    throw new Error(`unknown mode: ${mode}`);
}
