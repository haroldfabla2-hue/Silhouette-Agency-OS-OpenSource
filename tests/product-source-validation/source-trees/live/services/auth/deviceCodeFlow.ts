/**
 * [auth-connections] RFC 8628 device authorization grant - the headless
 * login pattern verified in NousResearch/hermes-agent hermes_cli/
 * auth_device_flow.py (MIT, commit 14e1e43): request a device code, show the
 * user a verification URL, poll the token endpoint honoring
 * authorization_pending and slow_down. Fits a server-hosted agent with no
 * local browser. Fetch is injectable for tests; no vendor client IDs here.
 */
export interface DeviceCodeResponse {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    intervalMs: number;
    expiresInMs: number;
}

export interface DeviceTokenResult {
    accessToken: string;
    refreshToken?: string;
    expiresInSec?: number;
    scopes?: string[];
}

export class DeviceFlowError extends Error {
    constructor(message: string, public readonly code?: string) { super(message); }
}

export async function requestDeviceCode(
    endpoint: string, clientId: string, scope: string | undefined,
    fetcher: typeof fetch = fetch,
): Promise<DeviceCodeResponse> {
    const body = new URLSearchParams({ client_id: clientId, ...(scope ? { scope } : {}) });
    const res = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'error' });
    if (!res.ok) { await res.body?.cancel(); throw new DeviceFlowError(`device code request failed: HTTP ${res.status}`); }
    const data: any = await res.json();
    if (typeof data?.device_code !== 'string' || typeof data?.user_code !== 'string' || typeof data?.verification_uri !== 'string') {
        throw new DeviceFlowError('invalid device code response');
    }
    return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        intervalMs: Math.max(1, Number(data.interval ?? 5)) * 1000,
        expiresInMs: Math.max(1, Number(data.expires_in ?? 900)) * 1000,
    };
}

export async function pollDeviceToken(
    endpoint: string, clientId: string, deviceCode: string, options: {
        intervalMs: number; timeoutMs: number; signal?: AbortSignal;
        sleep?: (ms: number) => Promise<void>;
    },
    fetcher: typeof fetch = fetch,
): Promise<DeviceTokenResult> {
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    const deadline = Date.now() + options.timeoutMs;
    let interval = options.intervalMs;
    for (;;) {
        if (options.signal?.aborted) throw new DeviceFlowError('login cancelled');
        if (Date.now() + interval > deadline) throw new DeviceFlowError('device code expired', 'expired_token');
        await sleep(interval);
        const res = await fetcher(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                client_id: clientId,
                device_code: deviceCode,
            }),
            redirect: 'error',
        });
        const data: any = await res.json().catch(() => ({}));
        if (res.ok) {
            if (typeof data?.access_token !== 'string') throw new DeviceFlowError('invalid token response');
            return {
                accessToken: data.access_token,
                ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
                ...(Number.isFinite(data.expires_in) ? { expiresInSec: Number(data.expires_in) } : {}),
                ...(typeof data.scope === 'string' ? { scopes: data.scope.split(' ').filter(Boolean) } : {}),
            };
        }
        const err = data?.error;
        if (err === 'authorization_pending') continue;
        if (err === 'slow_down') { interval += 5000; continue; }
        if (err === 'expired_token') throw new DeviceFlowError('device code expired', err);
        if (err === 'access_denied') throw new DeviceFlowError('user denied authorization', err);
        throw new DeviceFlowError(`token polling failed: HTTP ${res.status} ${err || ''}`.trim(), err);
    }
}
