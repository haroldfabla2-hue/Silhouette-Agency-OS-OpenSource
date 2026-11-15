// Test-only passive observer. No timers, I/O, product mutation or raw values emitted.
import type http from 'node:http';
import type { Socket } from 'node:net';
export function passivePairs() {
    // side1 client,2 server; masks:seen1,end2,close4,free8,assignedPOST8 16,HPE32,responseClose64.
    // event1 seen,2 pair,3 end,4 close,5 free,6 POST8assigned,7 HPE,8 POST8http400,9 POST8error,10 responseClose.
    // roles:0 unknown/nonSSE,1 initialA,2 initialB,3 identityA,4..6 extraA,7 laterA,8 other.
    let overflow = false, unavailable = false, cCount = 0, sCount = 0, beforeEvents = 0;
    const clients = new WeakMap<object, number>(), servers = new WeakMap<object, number>();
    const states: number[][] = [], pairs: number[][] = [], events: number[][] = [];
    const cleanups: Array<() => void> = [];
    let post8 = 0;
    // Same128 total rows, not an expanded cap. Reserve32 for POST8/HPE.
    // Generic loss ALWAYS keeps overflow=true/UNKNOWN; never claim full history.
    let genericRows = 0, decisiveRows = 0;
    function event(kind: number, side: number, id: number, detail = 0) {
        const decisive = kind === 6 || kind === 7 || kind === 8 || kind === 9;
        if (decisive ? decisiveRows >= 32 : genericRows >= 96) { overflow = true; return; }
        if (decisive) decisiveRows++; else genericRows++;
        events.push([kind, side, id, detail]);
    }
    function mark(side: number, id: number, bit: number) {
        const row = states.find(v => v[0] === side && v[1] === id);
        if (row) row[2] |= bit;
    }
    function listen(emitter: NodeJS.EventEmitter, name: string, fn: (...args: any[]) => void) {
        // Never prepend/intercept/suppress. Removal owns only our callback.
        emitter.on(name, fn); cleanups.push(() => emitter.removeListener(name, fn));
    }
    function socketId(side: number, socket: unknown): number {
        if (!socket || typeof socket !== 'object') { unavailable = true; return 0; }
        const table = side === 1 ? clients : servers;
        const old = table.get(socket); if (old) return old;
        if ((side === 1 ? cCount : sCount) >= 128) { overflow = true; return 0; }
        const id = side === 1 ? ++cCount : ++sCount;
        table.set(socket, id); states.push([side, id, 1]); event(1, side, id);
        // Socket is a real object supplied by http events, never a duck-typed payload.
        listen(socket as Socket, 'close', () => { mark(side, id, 4); event(4, side, id); });
        return id;
    }
    function pair(wrapper: unknown, endpoint: string, request: http.ClientRequest, response: http.IncomingMessage, role: number) {
        try {
            const w = wrapper as { sessions?: unknown };
            if (!Object.hasOwn(w, 'sessions') || !(w.sessions instanceof Map)) { unavailable = true; return; }
            const ids = new URL(endpoint, 'http://localhost').searchParams.getAll('sessionId');
            if (ids.length !== 1) { unavailable = true; return; }
            const entry: unknown = w.sessions.get(ids[0]);
            if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'transport')) { unavailable = true; return; }
            const transport = (entry as { transport: unknown }).transport;
            if (!transport || typeof transport !== 'object' || !Object.hasOwn(transport, 'res')) { unavailable = true; return; }
            const res = (transport as { res: http.ServerResponse }).res;
            const c = socketId(1, request.socket), s = socketId(2, res?.socket);
            if (!c || !s || pairs.length >= 64) { if (pairs.length >= 64) overflow = true; return; }
            // Reuse may create multiple pair records for one connection. Preserve each role.
            pairs.push([c, s, role]); event(2, 1, c, pairs.length);
            listen(response, 'end', () => { mark(1, c, 2); event(3, 1, c); });
            listen(response, 'close', () => { mark(1, c, 64); event(10, 1, c); });
            listen(res, 'close', () => { mark(2, s, 64); event(10, 2, s); });
            listen(res, 'finish', () => { mark(2, s, 2); event(3, 2, s); });
        } catch { unavailable = true; }
    }
    function connection(socket: Socket) { socketId(2, socket); }
    function assigned(socket: Socket, isPost8: boolean) {
        const id = socketId(1, socket);
        if (isPost8 && id) { post8 = id; const prior = states.find(v => v[0] === 1 && v[1] === id)?.[2] ?? 0; event(6, 1, id, prior); mark(1, id, 16); }
    }
    function free(socket: Socket) { const id = socketId(1, socket); if (id) { mark(1, id, 8); event(5, 1, id); } }
    function hpe(socket: Socket, code: string) {
        // Same closed code enum as existing observer, no messages/rawPacket.
        const names = ['HPE_INVALID_METHOD','HPE_INVALID_URL','HPE_INVALID_VERSION','HPE_INVALID_HEADER_TOKEN','HPE_INVALID_CONTENT_LENGTH','HPE_UNEXPECTED_CONTENT_LENGTH','HPE_INVALID_CHUNK_SIZE','HPE_INVALID_EOF_STATE','HPE_CLOSED_CONNECTION','HPE_HEADER_OVERFLOW','HPE_CHUNK_EXTENSIONS_OVERFLOW'];
        const codeId = names.indexOf(code) + 1; if (!codeId) return;
        const id = socketId(2, socket); if (id) { mark(2, id, 32); event(7, 2, id, codeId); }
    }
    function postResult(status: number, error: boolean) { if (post8 && (error || status === 400)) event(error ? 9 : 8, 1, post8); }
    function before() {
        beforeEvents = events.length;
        const value = { schema: 1, overflow, unavailable, cCount, sCount, post8, states, pairs, events };
        const raw = JSON.stringify(value);
        // Reserve512 bytes within8192 for the independent final phase descriptor.
        if (Buffer.byteLength(raw) > 7680) { overflow = true; return JSON.stringify({ schema: 1, overflow: true, unavailable, cCount, sCount, post8, states: [], pairs: [], events: [] }); }
        return raw;
    }
    function after() {
        // Do not copy an unbounded event tail or falsely assert resources closed.
        const raw = JSON.stringify({ schema: 1, phase: 'AFTER_ORIGINAL_FINALLY', overflow,
            unavailable, cCount, sCount, eventsAfterSnapshot: events.length - beforeEvents });
        for (const remove of cleanups) remove();
        cleanups.length = 0;
        return raw;
    }
    return { pair, connection, assigned, free, hpe, postResult, before, after };
}
