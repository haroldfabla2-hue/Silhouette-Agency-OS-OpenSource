/**
 * RedisBusAdapter NORMAL lifecycle controls against an OWNED endpoint.
 *
 * No BOOT_MODE (normal mode). The "redis server" is a fixture TCP server
 * owned by THIS child on an ephemeral 127.0.0.1 port: every contacted
 * endpoint is owned; no host-default service is touched. The adapter under
 * test and the driver are REAL - the fixture only plays the far end of the
 * socket. This is a PROTOCOL fixture, NOT a real Redis and NOT full
 * pub/sub/mailbox semantics (replies are scripted constants); it does not
 * replace later integration against a real owned Redis service.
 *
 * Scripted against the PINNED driver source: package-lock.json pins
 * redis/@redis/client 5.10.0; observed sources:
 *   https://unpkg.com/@redis/client@5.10.0/dist/lib/client/index.js
 *   https://unpkg.com/@redis/client@5.10.0/dist/lib/client/socket.js
 *   https://unpkg.com/@redis/client@5.10.0/dist/lib/commands/HELLO.js
 * Facts used: default handshake (RESP unset, no credentials, db 0) sends NO
 * HELLO/AUTH/SELECT and always pipelines 2 x CLIENT SETINFO whose failures
 * the client explicitly ignores; client.disconnect() is destroy(): it
 * throws ClientClosedError only when ALREADY closed, otherwise destroys the
 * socket synchronously with no server round-trip. CONSEQUENCE (declared
 * limit for THIS pinned version, not a universal claim): a wire-induced
 * close failure cannot be produced here, so the adapter's
 * closeFailed/retained-pair route is DEFENSIVE and remains an explicitly
 * UNCOVERED path; what is covered is the double-close guard.
 *
 * Phases (each records whether the attempt and cleanup were real):
 *  P1 two concurrent connect() calls share ONE attempt (exactly one client
 *     pair on the wire); ready only after BOTH connects + SUBSCRIBE;
 *     publish/send/checkMailbox/hasMail smoke against scripted replies.
 *  P2 partial failure (sub sockets destroyed by the server): connect()
 *     rejects, isConnected stays false, the OPEN pub close is OBSERVED on
 *     the server (event-based wait), no pair retained.
 *  P3 reconnect on the SAME adapter: old pub close observed BEFORE the new
 *     pair opens; ready again.
 *  P4 SUBSCRIBE failure: connect() rejects, isConnected never true, BOTH
 *     client closes observed independently.
 *  P5 double disconnect (concurrent + sequential): exactly ONE close per
 *     client observed, all callers resolve, fields released.
 *  P6 connect-after-disconnect: a fresh pair works (lifecycle preserved).
 *  P7 connect() issued DURING an in-flight disconnect() fences behind the
 *     close, then opens a fresh pair (never rides a closing handle).
 *
 * Ownership and cleanup: EVERY acquisition - listen, the dynamic import,
 * and all phases - sits INSIDE one outer try/catch/finally, so a failing
 * import or listen with the socket half-open still reaches cleanup. Listen
 * ownership is tracked by the REAL 'listening'/'error' events, never by the
 * acquisition wrapper: a deadline can reject the wrapper while the bind
 * completes LATE, so the finally first awaits definitive listen settlement
 * (bind or failure) under budget, then closes a bound listener definitively
 * and REPORTS any still-unconfirmed state instead of assuming it. The
 * primary timeout failure is preserved even when a late close succeeds.
 * The finally owns EVERY resource under ONE shared deadline that bounds
 * EACH await: all registered adapters (registered at creation) are
 * disconnected independently and EVERY one is attempted, remaining sockets
 * destroyed, and server.close awaited - even if a disconnect hangs. The
 * deadline helper clears its own timer on settle, so no artificial handle
 * survives. A primary failure is preserved as the first element of the
 * AggregateError, cleanup errors follow; the receipt prints ONLY after
 * phases AND cleanup. No process.exit on any path.
 */
import assert from 'node:assert/strict';
import net from 'node:net';

// ── Owned scripted RESP endpoint ─────────────────────────────────────────
interface ServerEvent { seq: number; type: 'open' | 'close' | 'cmd'; conn: number; cmd?: string }
const events: ServerEvent[] = [];
let seq = 0;
let connCounter = 0;
const openSockets = new Set<net.Socket>();
const closeWaiters: Array<{ conn: number; done: () => void }> = [];
const closedConns = new Set<number>();

// Phase behavior, mutated between phases:
//  destroyOnConnect: connection is destroyed immediately (connect failure)
//  failSubscribe: SUBSCRIBE gets -ERR instead of the confirmation
let behavior: { destroyOnConnect: (conn: number) => boolean; failSubscribe: boolean } = {
    destroyOnConnect: () => false,
    failSubscribe: false
};

const simple = (s: string) => `+${s}\r\n`;
const errReply = (s: string) => `-${s}\r\n`;
const intReply = (n: number) => `:${n}\r\n`;
const nullBulk = '$-1\r\n';
const subscribeReply = (channel: string) =>
    `*3\r\n$9\r\nsubscribe\r\n$${channel.length}\r\n${channel}\r\n:1\r\n`;

/** Bounded race that CLEARS its own timer when the wrapped promise settles
 * first: no artificial handle left alive on the winning path, and no wait
 * is ever unbounded. Used for listen, listen settlement, disconnect and
 * server.close. */
const withDeadline = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    new Promise<T>((resolvePromise, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label}: deadline exceeded (${ms}ms)`)), ms);
        p.then(
            (v) => { clearTimeout(timer); resolvePromise(v); },
            (e) => { clearTimeout(timer); reject(e); }
        );
    });

/** Event-based wait for the SERVER-OBSERVED close of a connection, bounded
 * by a deadline (no sleeps, no fixed delays). The timer is cleared when the
 * close event wins, and an expired waiter is REMOVED from the registry so
 * timed-out entries never accumulate. */
const waitClosed = (conn: number, deadlineMs = 5000): Promise<void> => {
    if (closedConns.has(conn)) return Promise.resolve();
    return new Promise<void>((resolvePromise, reject) => {
        const waiter = { conn, done: () => { clearTimeout(timer); resolvePromise(); } };
        const timer = setTimeout(() => {
            const i = closeWaiters.indexOf(waiter);
            if (i !== -1) closeWaiters.splice(i, 1);
            reject(new Error(`deadline waiting for server-observed close of conn ${conn}`));
        }, deadlineMs);
        closeWaiters.push(waiter);
    });
};

/** Incremental parser for RESP arrays of bulk strings (what node-redis writes). */
const makeParser = (onCommand: (args: string[]) => void) => {
    let buf = Buffer.alloc(0);
    const tryParse = (): string[] | null => {
        if (buf.length === 0 || buf[0] !== 0x2a /* * */) return null;
        let pos = 1;
        const line = (from: number): { value: string; next: number } | null => {
            const end = buf.indexOf('\r\n', from);
            if (end === -1) return null;
            return { value: buf.subarray(from, end).toString('utf8'), next: end + 2 };
        };
        const head = line(pos);
        if (!head) return null;
        const count = parseInt(head.value, 10);
        pos = head.next;
        const args: string[] = [];
        for (let i = 0; i < count; i++) {
            if (buf[pos] !== 0x24 /* $ */) return null;
            const lenLine = line(pos + 1);
            if (!lenLine) return null;
            const len = parseInt(lenLine.value, 10);
            pos = lenLine.next;
            if (buf.length < pos + len + 2) return null;
            args.push(buf.subarray(pos, pos + len).toString('utf8'));
            pos += len + 2;
        }
        buf = buf.subarray(pos);
        return args;
    };
    return (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        let cmd: string[] | null;
        while ((cmd = tryParse()) !== null) onCommand(cmd);
    };
};

const server = net.createServer((socket) => {
    const conn = ++connCounter;
    openSockets.add(socket);
    events.push({ seq: seq++, type: 'open', conn });
    socket.on('close', () => {
        openSockets.delete(socket);
        closedConns.add(conn);
        events.push({ seq: seq++, type: 'close', conn });
        for (const w of closeWaiters.splice(0)) if (w.conn === conn) w.done(); else closeWaiters.push(w);
    });
    socket.on('error', () => { /* client-side destroys surface as ECONNRESET; the close event is the record */ });
    if (behavior.destroyOnConnect(conn)) {
        socket.destroy();
        return;
    }
    const parse = makeParser((args) => {
        const cmd = (args[0] || '').toUpperCase();
        events.push({ seq: seq++, type: 'cmd', conn, cmd });
        switch (cmd) {
            case 'CLIENT': socket.write(errReply('ERR unknown command')); break; // SETINFO failures are ignored by the client
            case 'SUBSCRIBE':
                if (behavior.failSubscribe) socket.write(errReply('ERR subscribe disabled by fixture'));
                else socket.write(subscribeReply(args[1]));
                break;
            case 'PUBLISH': socket.write(intReply(1)); break;
            case 'LPUSH': case 'RPUSH': socket.write(intReply(1)); break;
            case 'LLEN': socket.write(intReply(0)); break;
            case 'LPOP': case 'GET': socket.write(nullBulk); break;
            case 'SET': socket.write(simple('OK')); break;
            case 'DEL': socket.write(intReply(1)); break;
            case 'PING': socket.write(simple('PONG')); break;
            default: socket.write(errReply(`ERR unknown command '${cmd}'`));
        }
    });
    socket.on('data', parse);
});

// ── Ownership registry: everything acquired inside the try is released in
// the finally, under ONE shared deadline that bounds EACH cleanup await. ──
const CLEANUP_DEADLINE_MS = 5000;
const adapters: Array<{ disconnect(): Promise<void> }> = [];
let primaryError: any = null;
const cleanupErrors: any[] = [];

// Listen ownership is tracked by REAL events, never by wrapper success: a
// deadline can reject the acquisition wrapper while the bind completes LATE.
// listenState changes only on observed events; the finally awaits definitive
// settlement, then closes. (Latch design chosen over AbortSignal: it relies
// only on 'listening'/'error'/close, present in every Node contract, so the
// fixture makes no version-specific API claim.)
type ListenState = 'pending' | 'listening' | 'failed' | 'closed';
let listenState: ListenState = 'pending';
let listenFailure: any = null;
let resolveListenSettled!: () => void;
const listenSettled = new Promise<void>((res) => { resolveListenSettled = res; });
server.on('listening', () => {
    if (listenState === 'pending') { listenState = 'listening'; resolveListenSettled(); }
});
server.on('error', (e) => {
    if (listenState === 'pending') { listenState = 'failed'; listenFailure = e; resolveListenSettled(); }
    else if (listenState === 'listening') cleanupErrors.push(e); // post-bind server error: recorded, never uncaught
});

try {
    // Acquisition lives INSIDE the outer try: a listen rejection or a failed
    // dynamic import still reaches the owned cleanup below. A SYNCHRONOUS
    // listen throw marks the state failed immediately.
    try {
        server.listen(0, '127.0.0.1');
    } catch (e) {
        listenState = 'failed';
        listenFailure = e;
        resolveListenSettled();
        throw e;
    }
    await withDeadline((async () => {
        await listenSettled;
        if (listenState === 'failed') throw listenFailure;
    })(), CLEANUP_DEADLINE_MS, 'server.listen');
    const port = (server.address() as net.AddressInfo).port;
    const url = `redis://127.0.0.1:${port}`;

    const { RedisBusAdapter } = await import('../../services/bus/RedisBusAdapter');

    const connsOf = (type: 'open' | 'close') => events.filter(e => e.type === type).map(e => e.conn);
    const cmdsOn = (conn: number) => events.filter(e => e.type === 'cmd' && e.conn === conn).map(e => e.cmd);

    // Every adapter is registered at creation: cleanup owns them ALL.
    const newAdapter = () => {
        const a = new RedisBusAdapter(url);
        adapters.push(a);
        return a;
    };

    // ── P1: concurrent connects share one attempt; ready after subscribe ──
    const adapter = newAdapter();
    await Promise.all([adapter.connect(), adapter.connect()]);
    assert.equal(connsOf('open').length, 2, 'single-flight: exactly ONE client pair on the wire');
    const pubConn = connsOf('open')[0];
    const subConn = connsOf('open')[1];
    assert.equal((adapter as any).isConnected, true);
    assert.equal((adapter as any).pubClient?.isReady, true, 'pub must be handshake-ready');
    assert.equal((adapter as any).subClient?.isReady, true, 'sub must be handshake-ready');
    assert.ok(cmdsOn(subConn).includes('SUBSCRIBE'), 'global subscription must be active before connected');

    const ev = { type: 'BOOT_COMPLETE', payload: { ok: true }, timestamp: Date.now(), sourceAgentId: 'fixture' } as any;
    await adapter.publish(ev);                       // PUBLISH on pub
    await adapter.send({ targetId: 'a1', payload: {}, priority: 'NORMAL' } as any); // RPUSH + PUBLISH wake
    assert.deepEqual(await adapter.checkMailbox('a1'), []);
    assert.equal(await adapter.hasMail('a1'), false);
    assert.ok(cmdsOn(pubConn).includes('PUBLISH'), 'publish must ride the pub connection');
    assert.ok(cmdsOn(pubConn).includes('RPUSH'), 'send must ride the pub connection');

    // ── P2: partial failure - sub connect destroyed, open pub cleaned ─────
    const phase2Base = connCounter;
    behavior = { destroyOnConnect: (c) => c > phase2Base + 1, failSubscribe: false };
    const adapter2 = newAdapter();
    let p2Err: any = null;
    try { await adapter2.connect(); } catch (e: any) { p2Err = e; }
    assert.ok(p2Err, 'P2 connect must reject when the sub connection never establishes');
    assert.equal((adapter2 as any).isConnected, false, 'connected must never be declared on partial failure');
    assert.equal((adapter2 as any).pubClient, null, 'cleanly-closed pair is released, not retained');
    assert.equal((adapter2 as any).subClient, null);
    const p2Pub = phase2Base + 1;
    await waitClosed(p2Pub); // SERVER-OBSERVED close, event-based
    const p2SubAttempts = connsOf('open').filter(c => c > p2Pub).length;
    assert.ok(p2SubAttempts >= 2, 'bounded retries must have been attempted before giving up');

    // ── P3: reconnect on the SAME adapter - old handle closed before new pair ─
    behavior = { destroyOnConnect: () => false, failSubscribe: false };
    const p2PubCloseSeq = events.filter(e => e.type === 'close' && e.conn === p2Pub).at(-1)!.seq;
    await adapter2.connect();
    assert.equal((adapter2 as any).isConnected, true);
    const p3Pair = connsOf('open').filter(c => c > p2Pub && !connsOf('close').includes(c));
    assert.equal(p3Pair.length, 2, 'a fresh pair serves the reconnect');
    assert.ok(events.find(e => e.type === 'open' && e.conn === p3Pair[0])!.seq > p2PubCloseSeq,
        'the previous pub must be observed CLOSED before the new pair opens (no overwrite of an open handle)');
    assert.equal((adapter2 as any).pubClient?.isReady, true);
    assert.equal((adapter2 as any).subClient?.isReady, true);
    await adapter2.disconnect();
    await waitClosed(p3Pair[0]);
    await waitClosed(p3Pair[1]);
    assert.equal((adapter2 as any).pubClient, null);
    assert.equal((adapter2 as any).subClient, null);

    // ── P4: SUBSCRIBE failure - both clients independently closed ─────────
    behavior = { destroyOnConnect: () => false, failSubscribe: true };
    const adapter3 = newAdapter();
    const p4Base = connCounter;
    let p4Err: any = null;
    try { await adapter3.connect(); } catch (e: any) { p4Err = e; }
    assert.ok(p4Err, 'P4 connect must reject when SUBSCRIBE fails');
    assert.equal((adapter3 as any).isConnected, false, 'connected must never be set before the subscription');
    await waitClosed(p4Base + 1); // pub closed independently
    await waitClosed(p4Base + 2); // sub closed independently
    assert.equal((adapter3 as any).pubClient, null);
    assert.equal((adapter3 as any).subClient, null);

    // ── P5: double disconnect - exactly one close per client ──────────────
    behavior = { destroyOnConnect: () => false, failSubscribe: false };
    const adapter4 = newAdapter();
    await adapter4.connect();
    const p5Pair = [connCounter - 1, connCounter]; // the two most recent opens
    const d1 = adapter4.disconnect();
    const d2 = adapter4.disconnect(); // adopts the same close TASK (not the identical Promise object)
    await Promise.all([d1, d2]);
    await adapter4.disconnect(); // sequential no-op: resolves, no ClientClosedError
    await waitClosed(p5Pair[0]);
    await waitClosed(p5Pair[1]);
    for (const c of p5Pair) {
        assert.equal(connsOf('close').filter(x => x === c).length, 1, `connection ${c} closed exactly once`);
    }
    assert.equal((adapter4 as any).isConnected, false);
    assert.equal((adapter4 as any).pubClient, null);

    // ── P6: connect-after-disconnect - lifecycle preserved ────────────────
    await adapter4.connect();
    assert.equal((adapter4 as any).isConnected, true);
    await adapter4.publish(ev);
    const p6Pair = [connCounter - 1, connCounter];
    await adapter4.disconnect();
    await waitClosed(p6Pair[0]);
    await waitClosed(p6Pair[1]);

    // ── P7: connect DURING disconnect fences behind the close ─────────────
    const adapter5 = newAdapter();
    await adapter5.connect();
    const p7Pair = [connCounter - 1, connCounter];
    const closing = adapter5.disconnect(); // sets the single-flight task synchronously
    const reopening = adapter5.connect();  // must fence behind the close, then open a fresh pair
    await Promise.all([closing, reopening]);
    assert.equal((adapter5 as any).isConnected, true);
    await waitClosed(p7Pair[0]);
    await waitClosed(p7Pair[1]);
    const p7NewPair = connsOf('open').filter(c => c > p7Pair[1]);
    assert.equal(p7NewPair.length, 2, 'a fresh pair serves the fenced reconnect');
    await adapter5.disconnect();
    await waitClosed(p7NewPair[0]);
    await waitClosed(p7NewPair[1]);
    assert.equal((adapter5 as any).isConnected, false);
} catch (e) {
    primaryError = e;
} finally {
    // Owned cleanup, ALWAYS - even when acquisition itself failed. ONE
    // shared deadline bounds EACH await; EVERY adapter is attempted, then
    // sockets are destroyed and the listener closed even if a disconnect
    // hangs. The primary error is preserved and never masked.
    const deadline = Date.now() + CLEANUP_DEADLINE_MS;
    const remaining = () => Math.max(0, deadline - Date.now());
    // Resolve listen ownership DEFINITIVELY first: if the bind was still in
    // flight when the acquisition wrapper timed out, await its REAL
    // settlement (bind or failure) under budget before deciding the branch.
    if (listenState === 'pending') {
        try { await withDeadline(listenSettled, remaining(), 'listen settlement'); }
        catch (e) { cleanupErrors.push(e); }
    }
    for (const a of adapters) {
        try { await withDeadline(a.disconnect(), remaining(), 'adapter.disconnect'); } catch (e) { cleanupErrors.push(e); }
    }
    for (const s of openSockets) {
        try { s.destroy(); } catch (e) { cleanupErrors.push(e); }
    }
    if (listenState === 'listening') {
        try {
            await withDeadline(
                new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
                remaining(), 'server.close');
            listenState = 'closed';
        } catch (e) { cleanupErrors.push(e); }
    } else if (listenState === 'failed') {
        // listen definitively failed: no bound resource exists. close() on a
        // never-listening server reports exactly ERR_SERVER_NOT_RUNNING via
        // its callback (asynchronous, no deadline needed); ONLY that code is
        // ignored - any other error is recorded.
        await new Promise<void>((res) => {
            try {
                server.close((e: any) => {
                    if (e && e.code !== 'ERR_SERVER_NOT_RUNNING') cleanupErrors.push(e);
                    res();
                });
            } catch { res(); }
        });
    } else {
        // STILL 'pending' after its own settlement budget: ownership is
        // UNCONFIRMED (the bind may complete later; the supervisor reaps
        // this process). Attempt close and report - never claim confirmed
        // cleanup. The primary timeout failure stays the first error.
        try { server.close(() => { /* unconfirmed */ }); } catch { /* unconfirmed */ }
        cleanupErrors.push(new Error('server listen state UNCONFIRMED at cleanup deadline'));
    }
}

if (primaryError || cleanupErrors.length > 0) {
    throw new AggregateError(
        [...(primaryError ? [primaryError] : []), ...cleanupErrors],
        'redis-bus-lifecycle child failed (primary preserved first, cleanup errors follow)');
}

console.log('REDIS_BUS_LIFECYCLE_CHILD_OK');
