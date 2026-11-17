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
    // Tracked WRITER-owned cascade producers and receipts. Both refs stay null
    // in the READER, which never stores and must not acquire these producers.
    let writerArbiter: { stopProcessingTimer(): { intervalWasArmed: boolean; pendingAdmissions: number; activeAdmissions: number; activeQueueRuns: number } } | null = null;
    let writerPower: { stopThrottleTimer(): { intervalWasArmed: boolean } } | null = null;
    let writerStops: { arbiter?: { intervalWasArmed: boolean; pendingAdmissions: number; activeAdmissions: number; activeQueueRuns: number }; power?: { intervalWasArmed: boolean } } = {};
    let writerReceipt: Record<string, unknown> | null = null;
    let readerReceipt: Record<string, unknown> | null = null;
    try {
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
        const { sqliteService } = await import('../../services/sqliteService');
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
            const { drainCurrentBackend } = await import('../../server/currentBackendDrain');
            const drainOk = await drainCurrentBackend();
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
                writerStops.arbiter = writerArbiter.stopProcessingTimer();
            } catch (e) { cleanupErrors.push(e); }
            try {
                if (writerPower === null) writerPower = (await import('../../services/powerManager')).powerManager;
                writerStops.power = writerPower.stopThrottleTimer();
            } catch (e) { cleanupErrors.push(e); }
        }
        // lancedbService exposes no close(): its connection teardown is process
        // exit itself, which the natural-exit supervision verifies.
        try { await endpoint.cleanup(); } catch (e) { cleanupErrors.push(e); }
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, `${mode} cleanup failed`);
    // Receipts print only after teardown, only on full success.
    if (writerReceipt !== null) {
        const stops = writerStops;
        // Measured active-work receipt, scoped: these counters cover only
        // admissions and queue runs THIS process actually invoked. The
        // writer's execution reaches no requestAdmission call (source-checked
        // above), so zero is the expected and asserted value - this is not a
        // generic settled-admission claim.
        assert.ok(stops.arbiter, 'writer arbiter stop receipt must exist');
        assert.equal(stops.arbiter.pendingAdmissions, 0, 'no queued admission promise may exist at stop');
        assert.equal(stops.arbiter.activeAdmissions, 0, 'no in-flight admission may exist at stop');
        assert.equal(stops.arbiter.activeQueueRuns, 0, 'no in-flight queue processing may exist at stop');
        assert.ok(stops.power, 'writer power stop receipt must exist');
        console.log(JSON.stringify({ ...writerReceipt, stops }));
    } else if (readerReceipt !== null) {
        console.log(JSON.stringify(readerReceipt));
    }
    // natural exit: module completion drains the loop.
} else {
    throw new Error(`unknown mode: ${mode}`);
}
