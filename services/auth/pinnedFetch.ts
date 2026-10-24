/**
 * [auth-connections] Pinned-connection fetcher for operator-supplied OAuth
 * endpoints. Resolves the host ONCE, requires every resolved address to be
 * public (unless declared test mode), then pins the connection to one
 * validated address via a connect-time lookup override: the DNS answer an
 * attacker flips between check and use never reaches the socket. TLS still
 * validates the URL hostname as usual; redirects stay refused by callers.
 */
import { Agent, fetch as undiciFetch } from 'undici';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class PinnedFetchError extends Error {
    constructor(public readonly code: string, message: string) { super(message); this.name = 'PinnedFetchError'; }
}

export function isPublicAddress(addr: string): boolean {
    const v = isIP(addr);
    if (v === 4) {
        const p = addr.split('.').map(Number);
        if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
        if (p[0] === 169 && p[1] === 254) return false;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
        if (p[0] === 192 && p[1] === 168) return false;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
        if (p[0] >= 224) return false; // multicast/reserved
        return true;
    }
    if (v === 6) {
        const a = addr.toLowerCase();
        if (a === '::1' || a === '::') return false;
        if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return false;
        if (a.startsWith('::ffff:')) { const m = a.slice(7); return isIP(m) === 4 ? isPublicAddress(m) : false; }
        return true;
    }
    return false;
}

export interface PinnedFetcher {
    fetcher: typeof fetch;
    close(): Promise<void>;
}

/**
 * Validate + pin `endpoint`'s host. allowPrivate is the DECLARED test mode
 * (loopback double AS); production wiring never sets it.
 */
export async function createPinnedFetcher(endpoint: string, field: string, allowPrivate = false): Promise<PinnedFetcher> {
    const url = new URL(endpoint);
    const host = url.hostname;
    let pinned: string;
    let family: 4 | 6;
    if (isIP(host)) {
        if (!allowPrivate && !isPublicAddress(host)) {
            throw new PinnedFetchError('private-endpoint', `${field} points at a non-public address`);
        }
        pinned = host;
        family = isIP(host) as 4 | 6;
    } else {
        let addresses: { address: string; family: number }[];
        try { addresses = await lookup(host, { all: true }); } catch { throw new PinnedFetchError('unresolvable-endpoint', `${field} host does not resolve`); }
        if (!addresses.length) throw new PinnedFetchError('unresolvable-endpoint', `${field} host does not resolve`);
        if (!allowPrivate && addresses.some(a => !isPublicAddress(a.address))) {
            throw new PinnedFetchError('private-endpoint', `${field} resolves to a non-public address`);
        }
        pinned = addresses[0].address;
        family = addresses[0].family as 4 | 6;
    }
    const agent = new Agent({
        connect: {
            // The socket ALWAYS dials the validated address; a changed DNS
            // answer at request time is never consulted. TLS SNI/hostname
            // verification still uses the URL host.
            lookup: (hostname, _opts, cb) => {
                if (hostname !== host) { cb(new Error('pinned host mismatch'), '' as any, 4); return; }
                cb(null, pinned, family);
            },
        },
    });
    const fetcher = ((input: any, init?: any) =>
        undiciFetch(input, { ...init, dispatcher: agent, redirect: 'error' })) as unknown as typeof fetch;
    return { fetcher, close: () => agent.close() };
}
