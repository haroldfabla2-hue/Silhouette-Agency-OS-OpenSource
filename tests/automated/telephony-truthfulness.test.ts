import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { telephonyService, mapProviderStatus, canTransition } from '../../services/telephony/telephonyService';

const svc: any = telephonyService;
const realFetch = globalThis.fetch;
const resp = (status: number, json: any = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => json }) as any;

describe('Telephony: no false successes (regressions)', () => {
    beforeEach(() => {
        delete process.env.SILHOUETTE_DEMO_MODE;
        svc.accountSid = 'ACtest'; svc.authToken = 'tok';
        process.env.SILHOUETTE_VOICE_WEBHOOK = 'https://example.test/v1/voices/twiml';
    });
    afterEach(() => { globalThis.fetch = realFetch; svc.accountSid = null; svc.authToken = null; svc.setMediaStreamSender(null); delete process.env.SILHOUETTE_VOICE_WEBHOOK; });

    it('Twilio 401 => FAILED, no SID, error returned (used to stay IN_PROGRESS)', async () => {
        globalThis.fetch = vi.fn(async () => resp(401)) as any;
        const r = await telephonyService.dial({ toNumber: '+15550100', purpose: 'x' });
        expect(r.call.status).toBe('FAILED');
        expect(r.call.providerCallSid).toBeUndefined();
        expect(r.error).toMatch(/401/);
        expect(telephonyService.getCall(r.call.id)?.status).toBe('FAILED');
    });

    it('network error => FAILED', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as any;
        const r = await telephonyService.dial({ toNumber: '+15550100', purpose: 'x' });
        expect(r.call.status).toBe('FAILED');
        expect(r.error).toMatch(/ECONNREFUSED/);
    });

    it('2xx without SID => FAILED; with SID => QUEUED (not IN_PROGRESS) until provider callback', async () => {
        globalThis.fetch = vi.fn(async () => resp(201, {})) as any;
        expect((await telephonyService.dial({ toNumber: '+15550100', purpose: 'x' })).call.status).toBe('FAILED');
        globalThis.fetch = vi.fn(async () => resp(201, { sid: 'CA123' })) as any;
        const ok = await telephonyService.dial({ toNumber: '+15550100', purpose: 'x' });
        expect(ok.call.status).toBe('QUEUED');
        expect(ok.call.isSimulated).toBe(false);
        expect(telephonyService.applyProviderStatus('CA123', 'ringing')?.status).toBe('RINGING');
        expect(telephonyService.applyProviderStatus('CA123', 'in-progress')?.status).toBe('IN_PROGRESS');
        expect(telephonyService.applyProviderStatus('CA123', 'ringing')).toBeNull(); // no going backwards
    });

    it('missing webhook URL => FAILED (no localhost default)', async () => {
        delete process.env.SILHOUETTE_VOICE_WEBHOOK;
        globalThis.fetch = vi.fn() as any;
        const r = await telephonyService.dial({ toNumber: '+15550100', purpose: 'x' });
        expect(r.call.status).toBe('FAILED');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('no credentials and no demo mode => FAILED/UNAVAILABLE, never a fake live call', async () => {
        svc.accountSid = null; svc.authToken = null;
        const r = await telephonyService.dial({ toNumber: '+15550100', purpose: 'x' });
        expect(r.call.status).toBe('FAILED');
        expect(r.error).toMatch(/UNAVAILABLE/);
    });

    it('explicit demo mode => labelled simulation', async () => {
        svc.accountSid = null; svc.authToken = null; process.env.SILHOUETTE_DEMO_MODE = '1';
        const r = await telephonyService.dial({ toNumber: '+15550100', purpose: 'x' });
        expect(r.call.isSimulated).toBe(true);
    });

    let n = 0;
    const liveCall = async () => {
        const sid = `CAlive${++n}`;
        globalThis.fetch = vi.fn(async () => resp(201, { sid })) as any;
        const r = await telephonyService.dial({ toNumber: '+15550100', purpose: 'x' });
        telephonyService.applyProviderStatus(sid, 'in-progress');
        return r.call.id;
    };

    it('DTMF: failed HTTP => success:false and nothing recorded', async () => {
        const id = await liveCall();
        globalThis.fetch = vi.fn(async () => resp(500)) as any;
        const r = await telephonyService.sendDtmf(id, '1');
        expect(r.success).toBe(false);
        expect(telephonyService.getCall(id)?.transcript.some(t => t.dtmfDigits)).toBe(false);
    });

    it('hangup: provider failure => NOT completed, error says call may be live', async () => {
        const id = await liveCall();
        globalThis.fetch = vi.fn(async () => resp(503)) as any;
        const r = await telephonyService.hangup(id);
        expect(r.error).toMatch(/NOT confirmed/);
        expect(telephonyService.getCall(id)?.status).toBe('IN_PROGRESS');
    });

    it('hangup: provider confirms => COMPLETED', async () => {
        const id = await liveCall();
        globalThis.fetch = vi.fn(async () => resp(200, {})) as any;
        const r = await telephonyService.hangup(id);
        expect(r.error).toBeUndefined();
        expect(r.call?.status).toBe('COMPLETED');
    });

    it('barge-in on a real call without a media stream => UNAVAILABLE, not success', async () => {
        const id = await liveCall();
        const r = await telephonyService.triggerBargeIn(id);
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/UNAVAILABLE/);
    });

    it('barge-in is really sent to the media stream when connected', async () => {
        const id = await liveCall();
        const sent: any[] = [];
        telephonyService.setMediaStreamSender(async (cid, msg) => { sent.push([cid, msg]); return true; });
        const r = await telephonyService.triggerBargeIn(id);
        expect(r.success).toBe(true);
        expect(sent).toEqual([[id, { event: 'clear' }]]);
    });
});

describe('call state machine (pure)', () => {
    it('maps provider statuses and only moves forward', () => {
        expect(mapProviderStatus('no-answer')).toBe('FAILED');
        expect(mapProviderStatus('weird')).toBeNull();
        expect(canTransition('QUEUED', 'RINGING')).toBe(true);
        expect(canTransition('IN_PROGRESS', 'RINGING')).toBe(false);
        expect(canTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
        expect(canTransition('FAILED', 'COMPLETED')).toBe(false);
    });
});
