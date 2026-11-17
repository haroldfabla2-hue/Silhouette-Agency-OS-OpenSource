/**
 * MCP session isolation: real two-client lifecycle over loopback HTTP/SSE.
 *
 * Regression evidence for Unit B (GHSA-345p-7cg4-v4c7, cross-client data leak
 * via shared server/transport instance reuse). The pre-fix wrapper held ONE
 * McpServer and ONE mutable transport: a second SSE connection overwrote
 * this.transport, so the first client's POST /mcp/messages were routed to the
 * second client's stream (session confusion), and disconnects left stale
 * state. This test mounts the REAL wrapper with the REAL apiKeyService
 * (per-worker disposable SQLite, provider OFF) and drives REAL SDK clients
 * and raw HTTP/SSE consumers concurrently. No mocks: keys are created
 * through the real service, auth negatives hit the real middleware.
 *
 * Unit B review R1 additions:
 * - Session ownership is bound to the validated ApiKey.id (stable uuid),
 *   never the display name. A DIFFERENT key — even with an IDENTICAL name
 *   and equal permissions — posting to a victim's sessionId is rejected
 *   403 before any SDK processing, the victim's stream receives nothing,
 *   and the owner key keeps working. Same-key multi-client stays allowed.
 * - Stream-abort cleanup: aborting the SSE response mid-session disposes
 *   the session (real socket close path, no client cooperation).
 * - Disposal completion is proven by a NATURAL server.close() completing
 *   with no fallback: Node's close() reaps idle keep-alive sockets but
 *   cannot complete while an SSE stream is alive, so a completing close
 *   means no connection leaked. closeAllConnections is a failure-annotated
 *   fallback only.
 *
 * Preserved-surface checks: zero-tool policy (tools/list fails closed as
 * method-not-found, tools/call unknown tool fails), prompts resource
 * served, endpoint auth and permission checks unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { MCPWrapper } from '../../server/mcp/mcpServer';
import { apiKeyService } from '../../services/apiKeyService';

let server: Server;
let port: number;
let wrapper: MCPWrapper;
let fullKey: string;
let readOnlyKey: string;

// Session disposal is intentionally asynchronous: client.close() resolves
// when the client transport closes, while the server observes res 'close'
// a tick later. Poll for the converged count; a missing cleanup path would
// make this time out and fail the test honestly.
const waitForSessionCount = async (expected: number, timeoutMs = 5000, w: MCPWrapper = wrapper) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (w.activeSessionCount === expected) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(w.activeSessionCount).toBe(expected);
};

const connectClient = async (name: string, key: string) => {
    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${port}/mcp/sse`), {
        requestInit: { headers: { Authorization: `Bearer ${key}` } },
    });
    const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    return { client, transport };
};

/** Minimal SSE frame collector over a raw fetch stream. */
class RawSseStream {
    public readonly events: Array<{ event: string; data: string }> = [];
    private reading: Promise<void>;

    private constructor(
        public readonly response: globalThis.Response,
        private readonly controller: AbortController,
    ) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        this.reading = (async () => {
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let idx: number;
                    while ((idx = buffer.indexOf('\n\n')) !== -1) {
                        const frame = buffer.slice(0, idx);
                        buffer = buffer.slice(idx + 2);
                        let event = 'message';
                        let data = '';
                        for (const line of frame.split('\n')) {
                            if (line.startsWith('event:')) event = line.slice(6).trim();
                            else if (line.startsWith('data:')) data += line.slice(5).trim();
                        }
                        this.events.push({ event, data });
                    }
                }
            } catch {
                // aborted or socket closed mid-frame: expected on cleanup
            }
        })();
    }

    static async open(url: string, key: string): Promise<RawSseStream> {
        const controller = new AbortController();
        const probe = await fetch(url, {
            headers: { Authorization: `Bearer ${key}`, Accept: 'text/event-stream' },
            signal: controller.signal,
        });
        if (probe.status !== 200 || !probe.body) {
            await probe.arrayBuffer();
            throw new Error(`SSE open failed: ${probe.status}`);
        }
        return new RawSseStream(probe, controller);
    }

    async waitForEvent(pred: (e: { event: string; data: string }) => boolean, timeoutMs = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const hit = this.events.find(pred);
            if (hit) return hit;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(`SSE event not seen within ${timeoutMs}ms; events=${JSON.stringify(this.events)}`);
    }

    /** Wait `ms`, collecting whatever arrives (used for absence proofs). */
    async settle(ms: number) {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async close() {
        // Aborting the fetch destroys the real socket mid-stream (a plain
        // body.cancel() leaves the keep-alive socket alive and the server
        // never sees 'close' — verified in this fixture). The server must
        // reap the session via the transport close path alone.
        this.controller.abort();
        await this.reading;
    }
}

const postJson = (url: string, key: string, body: unknown) =>
    fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

beforeAll(async () => {
    fullKey = apiKeyService.createApiKey(
        { name: 'unit-b-full', permissions: ['tools:read', 'tools:execute', 'resources:read'] },
        'unit-b-fixture'
    ).key;
    readOnlyKey = apiKeyService.createApiKey(
        { name: 'unit-b-readonly', permissions: ['tools:read'] },
        'unit-b-fixture'
    ).key;

    wrapper = new MCPWrapper();
    await wrapper.initialize();
    const app = express();
    await wrapper.mount(app);
    server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no ephemeral port');
    port = addr.port;
}, 30000);

afterAll(async () => {
    if (server) {
        // Natural close first. Node's server.close() reaps idle keep-alive
        // sockets but CANNOT complete while an SSE stream is alive, so a
        // completing close() proves no connection leaked out of the tests.
        // closeAllConnections is only a fallback and its use fails the run.
        const closed = await Promise.race([
            new Promise<boolean>((resolve) => server.close(() => resolve(true))),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10000)),
        ]);
        if (!closed) {
            (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
            await new Promise<void>((resolve) => server.close(() => resolve()));
            throw new Error('MCP test server needed closeAllConnections fallback: an SSE stream leaked');
        }
    }
}, 30000);

describe('MCP per-client session isolation (real SDK clients over loopback SSE)', () => {
    it('auth negatives unchanged: no token 401, bad token 403', async () => {
        const noAuth = await fetch(`http://127.0.0.1:${port}/mcp/sse`);
        expect(noAuth.status).toBe(401);
        await noAuth.arrayBuffer();
        const badAuth = await fetch(`http://127.0.0.1:${port}/mcp/sse`, { headers: { Authorization: 'Bearer sk_silhouette_wrong' } });
        expect(badAuth.status).toBe(403);
        await badAuth.arrayBuffer();
    });

    it('two concurrent clients with the SAME key each complete initialize + listTools (same-key multi-client preserved)', async () => {
        const a = await connectClient('client-a', fullKey);
        const b = await connectClient('client-b', fullKey);
        try {
            await waitForSessionCount(2);
            // Zero-tool policy preserved and identical on both isolated
            // sessions: no tools capability is advertised, so tools/list
            // fails closed as method-not-found (SDK behavior verified
            // identical before/after the bump).
            await expect(a.client.listTools()).rejects.toThrow(/-32601|Method not found/);
            await expect(b.client.listTools()).rejects.toThrow(/-32601|Method not found/);
        } finally {
            await a.client.close();
            await b.client.close();
        }
    }, 30000);

    it('prompts resource served identically on two sessions', async () => {
        const a = await connectClient('client-a2', fullKey);
        const b = await connectClient('client-b2', fullKey);
        try {
            const [ra, rb] = await Promise.all([
                a.client.readResource({ uri: 'mcp://prompts' }),
                b.client.readResource({ uri: 'mcp://prompts' }),
            ]);
            const textA = (ra.contents[0] as { text: string }).text;
            const textB = (rb.contents[0] as { text: string }).text;
            expect(JSON.parse(textA)).toHaveProperty('available_categories');
            expect(textA).toBe(textB);
        } finally {
            await a.client.close();
            await b.client.close();
        }
    }, 30000);

    it('closing one session disposes only its own pair; the other session keeps working', async () => {
        const a = await connectClient('client-a3', fullKey);
        const b = await connectClient('client-b3', fullKey);
        await waitForSessionCount(2);

        await a.client.close();
        // Real cleanup path: transport onclose -> session removed + server closed.
        await waitForSessionCount(1);

        await expect(b.client.listTools()).rejects.toThrow(/-32601|Method not found/);
        const rb = await b.client.readResource({ uri: 'mcp://prompts' });
        expect((rb.contents[0] as { text: string }).text).toContain('available_categories');

        await b.client.close();
        await waitForSessionCount(0);
    }, 30000);

    it('POST to unknown/expired session fails closed with 400 (no cross-session routing)', async () => {
        const res = await postJson(
            `http://127.0.0.1:${port}/mcp/messages?sessionId=00000000-0000-0000-0000-000000000000`,
            fullKey,
            { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
        );
        expect(res.status).toBe(400);
        await res.arrayBuffer();
    });

    it('POST with read-only key still requires tools:execute (permission check preserved)', async () => {
        const res = await postJson(
            `http://127.0.0.1:${port}/mcp/messages?sessionId=whatever`,
            readOnlyKey,
            { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
        );
        expect(res.status).toBe(403);
        await res.arrayBuffer();
    });

    it('tools/call of an unregistered tool fails honestly (no simulated success)', async () => {
        const a = await connectClient('client-a4', fullKey);
        try {
            await expect(a.client.callTool({ name: 'definitely_not_registered', arguments: {} })).rejects.toThrow();
        } finally {
            await a.client.close();
        }
    }, 30000);

    it('session ownership: a DIFFERENT execute key — even with an IDENTICAL display name — cannot inject into a victim session', async () => {
        await waitForSessionCount(0);
        // Two keys, SAME display name, SAME permissions, different ApiKey.id.
        const sharedName = 'unit-b-twins';
        const keyVictim = apiKeyService.createApiKey(
            { name: sharedName, permissions: ['tools:read', 'tools:execute'] },
            'unit-b-fixture'
        ).key;
        const keyAttacker = apiKeyService.createApiKey(
            { name: sharedName, permissions: ['tools:read', 'tools:execute'] },
            'unit-b-fixture'
        ).key;
        expect(keyVictim).not.toBe(keyAttacker);

        // Victim opens a real SSE session (raw stream, full observability).
        const victim = await RawSseStream.open(`http://127.0.0.1:${port}/mcp/sse`, keyVictim);
        try {
            const endpoint = await victim.waitForEvent((e) => e.event === 'endpoint');
            const victimSessionId = new URLSearchParams(endpoint.data.split('?')[1]).get('sessionId');
            expect(victimSessionId).toBeTruthy();
            expect(wrapper.activeSessionIds).toContain(victimSessionId);

            // Attacker knows the victim's sessionId and holds a VALID
            // execute key with the SAME display name. The POST must be
            // rejected before any SDK processing.
            const attack = await postJson(
                `http://127.0.0.1:${port}/mcp/messages?sessionId=${victimSessionId}`,
                keyAttacker,
                { jsonrpc: '2.0', id: 777, method: 'tools/list', params: {} }
            );
            expect(attack.status).toBe(403);
            await attack.arrayBuffer();

            // The owner key still works on its own session.
            const owner = await postJson(
                `http://127.0.0.1:${port}/mcp/messages?sessionId=${victimSessionId}`,
                keyVictim,
                { jsonrpc: '2.0', id: 778, method: 'tools/list', params: {} }
            );
            expect(owner.status).toBe(202);
            await owner.arrayBuffer();

            // Victim stream receives the owner's answer and NOTHING for the
            // attacker's request id 777 (no injection onto the victim stream).
            await victim.waitForEvent((e) => {
                if (e.event !== 'message') return false;
                try { return (JSON.parse(e.data) as { id?: number }).id === 778; } catch { return false; }
            });
            await victim.settle(400); // window for any straggler frames
            const injected = victim.events.some((e) => {
                if (e.event !== 'message') return false;
                try { return (JSON.parse(e.data) as { id?: number }).id === 777; } catch { return false; }
            });
            expect(injected).toBe(false);
        } finally {
            await victim.close();
        }
        await waitForSessionCount(0);
    }, 30000);

    it('session ownership: a differently-named full-permission key is equally rejected', async () => {
        await waitForSessionCount(0);
        const keyOwner = apiKeyService.createApiKey(
            { name: 'unit-b-owner', permissions: ['tools:read', 'tools:execute'] },
            'unit-b-fixture'
        ).key;
        const keyOther = apiKeyService.createApiKey(
            { name: 'unit-b-other', permissions: ['tools:read', 'tools:execute', 'resources:read'] },
            'unit-b-fixture'
        ).key;

        const owner = await RawSseStream.open(`http://127.0.0.1:${port}/mcp/sse`, keyOwner);
        try {
            const endpoint = await owner.waitForEvent((e) => e.event === 'endpoint');
            const sessionId = new URLSearchParams(endpoint.data.split('?')[1]).get('sessionId');
            const attack = await postJson(
                `http://127.0.0.1:${port}/mcp/messages?sessionId=${sessionId}`,
                keyOther,
                { jsonrpc: '2.0', id: 900, method: 'tools/list', params: {} }
            );
            expect(attack.status).toBe(403);
            await attack.arrayBuffer();
            await owner.settle(300);
            expect(owner.events.some((e) => e.event === 'message' && e.data.includes('"id":900'))).toBe(false);
        } finally {
            await owner.close();
        }
        await waitForSessionCount(0);
    }, 30000);

    it('aborting the SSE stream mid-session disposes the session (real socket close path)', async () => {
        await waitForSessionCount(0);
        const stream = await RawSseStream.open(`http://127.0.0.1:${port}/mcp/sse`, fullKey);
        const endpoint = await stream.waitForEvent((e) => e.event === 'endpoint');
        const sessionId = new URLSearchParams(endpoint.data.split('?')[1]).get('sessionId');
        expect(wrapper.activeSessionIds).toContain(sessionId);

        // Client vanishes without any MCP-level close: the server must reap
        // the session via the transport close path alone.
        await stream.close();
        await waitForSessionCount(0);
    }, 30000);

    it('disposal completion: a dedicated server with a closed session finishes a NATURAL close with no fallback', async () => {
        const w = new MCPWrapper();
        await w.initialize();
        const app = express();
        await w.mount(app);
        const s = await new Promise<Server>((resolve) => {
            const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
        });
        const addr = s.address();
        if (!addr || typeof addr === 'string') throw new Error('no ephemeral port');
        const p = addr.port;

        const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${p}/mcp/sse`), {
            requestInit: { headers: { Authorization: `Bearer ${fullKey}` } },
        });
        const client = new Client({ name: 'disposal-client', version: '1.0.0' }, { capabilities: {} });
        await client.connect(transport);
        await waitForSessionCount(1, 5000, w);

        await client.close();
        await waitForSessionCount(0, 5000, w);

        // Node's server.close() reaps idle keep-alive sockets but cannot
        // complete while an SSE stream is still open. A completing close is
        // therefore real proof that the session's connection is gone — not
        // merely that a Map entry was removed.
        const closed = await Promise.race([
            new Promise<boolean>((resolve) => s.close(() => resolve(true))),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!closed) {
            (s as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
            await new Promise<void>((resolve) => s.close(() => resolve()));
        }
        expect(closed).toBe(true);
    }, 30000);
});
