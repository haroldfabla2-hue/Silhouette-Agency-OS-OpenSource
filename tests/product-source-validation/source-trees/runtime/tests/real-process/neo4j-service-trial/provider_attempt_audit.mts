// Source candidate only. Observational diagnostics, no monkeypatch/interception.
// Import before application modules. No requests or product imports on import.
import dc from 'node:diagnostics_channel';
import http from 'node:http';

export function beginProviderAttemptAudit() {
    const counts = { nodeHttpCreated: 0, undiciCreated: 0, loopbackAllowed: 0,
        unexpectedHttp: 0, invalidObservation: 0, netClientSocketCreated: 0 };
    let stopped = false;
    const allowedPorts = new Set(['3405', '7474']);
    const classified = new WeakSet<object>();
    function classify(request: any, rawOrigin: unknown, kind: 'nodeHttpCreated' | 'undiciCreated') {
        try {
            if (!request || typeof request !== 'object') { counts.invalidObservation++; return; }
            // Different channel implementations can publish the same object.
            if (classified.has(request)) return;
            classified.add(request); counts[kind]++;
            if (typeof rawOrigin !== 'string' && !(rawOrigin instanceof URL)) {
                counts.invalidObservation++; return;
            }
            const url = new URL(String(rawOrigin));
            const port = url.port || (url.protocol === 'https:' ? '443' : '80');
            if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && allowedPorts.has(port)) counts.loopbackAllowed++;
            else counts.unexpectedHttp++;
        } catch { counts.invalidObservation++; }
    }
    const node = (value: any) => {
        try {
            const request = value.request;
            const host = request.getHeader('host');
            if (typeof host !== 'string') { counts.invalidObservation++; return; }
            classify(request, `${request.protocol || 'http:'}//${host}`, 'nodeHttpCreated');
        } catch { counts.invalidObservation++; }
    };
    const undici = (value: any) => { try { classify(value.request, value.request.origin, 'undiciCreated'); } catch { counts.invalidObservation++; } };
    const socket = () => { counts.netClientSocketCreated++; };
    const subscriptions: [string, (value: any) => void][] = [
        ['http.client.request.created', node], ['undici:request:create', undici], ['net.client.socket', socket]
    ];
    for (const [name, handler] of subscriptions) dc.subscribe(name, handler);
    return {
        snapshot() { return { ...counts, stopped,
            status: counts.unexpectedHttp || counts.invalidObservation ? 'FAIL_OR_INCOMPLETE' : 'NO_UNEXPECTED_HTTP_OBSERVED',
            coverage: 'NODE22_HTTP_REQUEST_CREATED_AND_UNDICI_CREATE_ONLY_NOT_ALL_NETWORK_OR_ALL_PROVIDER_METHOD_INVOCATIONS' }; },
        async verifyActualLoopbackChannels() {
            // Exact synthetic HTTP endpoint. This is a real connection and body,
            // not a fabricated provider response. Separate phase before imports.
            const before = { ...counts };
            const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('fixture-audit-ready'); });
            await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(3405, '127.0.0.1', resolve); });
            try {
                await new Promise<void>((resolve, reject) => {
                    const request = http.get('http://127.0.0.1:3405/', response => {
                        let body = ''; response.setEncoding('utf8'); response.on('data', b => { body += b; });
                        response.on('end', () => body === 'fixture-audit-ready' ? resolve() : reject(new Error('actual HTTP audit selfcheck body mismatch')));
                    }); request.setTimeout(1000, () => request.destroy(new Error('HTTP audit selfcheck timeout'))); request.once('error', reject);
                });
                const response = await fetch('http://127.0.0.1:3405/', { signal: AbortSignal.timeout(1000) });
                if (response.status !== 200 || await response.text() !== 'fixture-audit-ready') throw new Error('actual fetch audit selfcheck failed');
                if (counts.nodeHttpCreated <= before.nodeHttpCreated || counts.undiciCreated <= before.undiciCreated || counts.invalidObservation !== before.invalidObservation) throw new Error('diagnostics source channels not observed on actual runtime');
            } finally {
                await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            }
            return { status: 'ACTUAL_LOOPBACK_HTTP_AND_FETCH_CHANNELS_OBSERVED', before, after: { ...counts },
                note: 'These real fixture-only requests are baseline activity, not product/provider attempts.' };
        },
        stop() { if (!stopped) for (const [name, handler] of subscriptions) dc.unsubscribe(name, handler); stopped = true; }
    };
}
