import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { requestDeviceCode, pollDeviceToken, DeviceFlowError } from '../../../services/auth/deviceCodeFlow';

let server: Server | undefined;
let base = '';
afterEach(() => new Promise<void>(r => { server?.close(() => r()); server = undefined; }));

async function start(handler: (body: string, path: string) => [number, any]): Promise<void> {
    server = createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            const [status, payload] = handler(body, req.url || '/');
            res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
        });
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server!.address() as any).port}`;
}

describe('deviceCodeFlow', () => {
    it('requests a device code and validates the response shape', async () => {
        await start(() => [200, { device_code: 'dc-1', user_code: 'ABCD-EFGH', verification_uri: 'https://provider.example/activate', interval: 1, expires_in: 600 }]);
        const r = await requestDeviceCode(`${base}/device`, 'client-1', 'scope1');
        expect(r).toMatchObject({ deviceCode: 'dc-1', userCode: 'ABCD-EFGH', intervalMs: 1000, expiresInMs: 600_000 });
    });
    it('rejects malformed device code responses', async () => {
        await start(() => [200, { nope: true }]);
        await expect(requestDeviceCode(`${base}/device`, 'c', undefined)).rejects.toThrow(/invalid device code response/);
    });
    it('polls through pending and slow_down to success, honoring RFC 8628 grant body', async () => {
        const seen: string[] = [];
        let calls = 0;
        await start((body) => {
            calls++;
            seen.push(new URLSearchParams(body).get('grant_type') || '');
            if (calls < 2) return [400, { error: 'authorization_pending' }];
            if (calls < 3) return [400, { error: 'slow_down' }];
            return [200, { access_token: 'at-final', refresh_token: 'rt-final', expires_in: 3600, scope: 'scope1 scope2' }];
        });
        const sleeps: number[] = [];
        const result = await pollDeviceToken(`${base}/token`, 'client-1', 'dc-1', {
            intervalMs: 100, timeoutMs: 60_000, sleep: async (ms) => { sleeps.push(ms); },
        });
        expect(result).toEqual({ accessToken: 'at-final', refreshToken: 'rt-final', expiresInSec: 3600, scopes: ['scope1', 'scope2'] });
        expect(seen[0]).toBe('urn:ietf:params:oauth:grant-type:device_code');
        expect(sleeps).toEqual([100, 100, 5100]); // slow_down adds 5s per RFC 8628
    });
    it('maps expired_token and access_denied to typed errors', async () => {
        await start(() => [400, { error: 'expired_token' }]);
        await expect(pollDeviceToken(`${base}/token`, 'c', 'dc', { intervalMs: 1, timeoutMs: 5000, sleep: async () => {} }))
            .rejects.toMatchObject({ code: 'expired_token' });
        await start(() => [400, { error: 'access_denied' }]);
        await expect(pollDeviceToken(`${base}/token`, 'c', 'dc', { intervalMs: 1, timeoutMs: 5000, sleep: async () => {} }))
            .rejects.toMatchObject({ code: 'access_denied' });
        await expect(pollDeviceToken(`${base}/token`, 'c', 'dc', { intervalMs: 1, timeoutMs: 5000, sleep: async () => {} }))
            .rejects.toBeInstanceOf(DeviceFlowError);
    });
});
