/**
 * DETERMINISTIC pin-contract proof (no external adversarial DNS, no login):
 * an injectable resolver answers 127.0.0.1 at validation time and 10.0.0.1
 * (private, "attacker flip") afterwards. If the socket truly dials the
 * pinned address, the request still reaches the loopback double server,
 * the resolver is consulted exactly ONCE, and a flipped DNS answer never
 * reaches the connection.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPinnedFetcher, PinnedFetchError } from '../../../services/auth/pinnedFetch';

const servers: Server[] = [];
afterEach(async () => { while (servers.length) await new Promise<void>(r => servers.pop()!.close(() => r())); });

async function doubleServer() {
    const seen: string[] = [];
    const server = createServer((req, res) => { seen.push(req.url || '/'); res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    return { port: (server.address() as AddressInfo).port, seen };
}

describe('pinned fetch contract (deterministic)', () => {
    it('socket dials the pinned address even when later DNS answers flip to a private IP', async () => {
        const { port, seen } = await doubleServer();
        let calls = 0;
        const flippingLookup = (async (_host: string, _opts: any) => {
            calls++;
            // First (validation) answer: loopback. Any later answer: flipped.
            return [{ address: calls === 1 ? '127.0.0.1' : '10.9.9.9', family: 4 }];
        }) as any;
        const pinned = await createPinnedFetcher(`http://localhost:${port}/x`, 'test.ep', true, flippingLookup);
        const res = await pinned.fetcher(`http://localhost:${port}/x`);
        expect(res.ok).toBe(true);
        expect(seen).toEqual(['/x']);   // the loopback server actually got the request
        expect(calls).toBe(1);          // resolver consulted once: at validation
        await pinned.close();
    });
    it('strict mode rejects a host whose ONLY answer is private, before any traffic', async () => {
        const privateLookup = (async () => [{ address: '10.9.9.9', family: 4 }]) as any;
        await expect(createPinnedFetcher('https://internal.example/x', 'test.ep', false, privateLookup))
            .rejects.toThrow(PinnedFetchError);
    });
    it('validation requires EVERY resolved address public', async () => {
        const mixedLookup = (async () => [{ address: '8.8.8.8', family: 4 }, { address: '192.168.0.1', family: 4 }]) as any;
        await expect(createPinnedFetcher('https://mixed.example/x', 'test.ep', false, mixedLookup))
            .rejects.toThrow(/non-public/);
    });
    it('a connection to a different host through the same fetcher is refused', async () => {
        const { port } = await doubleServer();
        const loopLookup = (async () => [{ address: '127.0.0.1', family: 4 }]) as any;
        const pinned = await createPinnedFetcher(`http://localhost:${port}/x`, 'test.ep', true, loopLookup);
        await expect(pinned.fetcher(`http://other-host:${port}/y`)).rejects.toThrow();
        await pinned.close();
    });
});
