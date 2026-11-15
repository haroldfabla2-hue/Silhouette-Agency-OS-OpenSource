import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import voiceRoutes from '../../server/routes/v1/voice.routes';
import { computeTwilioSignature, verifyTwilioSignature } from '../../services/telephony/twilioSignature';

const TOKEN = 'test_auth_token';
const BASE = 'https://agency.example.test/v1/voices/twiml';
let server: http.Server; let port: number;

const post = async (path: string, params: Record<string, string>, sig?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(sig ? { 'X-Twilio-Signature': sig } : {}) },
        body: new URLSearchParams(params).toString()
    });
    return { status: res.status, text: await res.text() };
};
const sign = (path: string, params: Record<string, string>) => computeTwilioSignature(TOKEN, `https://agency.example.test${path}`, params);

describe('Twilio signature', () => {
    it('matches the documented algorithm and rejects tampering', () => {
        const p = { CallSid: 'CA1', From: '+1555' };
        const s = computeTwilioSignature(TOKEN, 'https://x.test/a', p);
        expect(verifyTwilioSignature(TOKEN, 'https://x.test/a', p, s)).toBe(true);
        expect(verifyTwilioSignature(TOKEN, 'https://x.test/a', { ...p, From: '+1666' }, s)).toBe(false);
        expect(verifyTwilioSignature(TOKEN, 'https://x.test/b', p, s)).toBe(false);
        expect(verifyTwilioSignature('other', 'https://x.test/a', p, s)).toBe(false);
        expect(verifyTwilioSignature(TOKEN, 'https://x.test/a', p, undefined)).toBe(false);
        expect(verifyTwilioSignature(TOKEN, 'https://x.test/a', p, 'short')).toBe(false);
    });
});

describe('voice webhooks (regression: were unsigned, mis-routed, no gather handler)', () => {
    beforeAll(async () => {
        const app = express();
        app.use('/v1/voices', voiceRoutes);
        server = app.listen(0);
        port = (server.address() as AddressInfo).port;
    });
    afterAll(() => { server.close(); });
    beforeEach(() => { process.env.TWILIO_AUTH_TOKEN = TOKEN; process.env.SILHOUETTE_VOICE_WEBHOOK = BASE; });

    it('unsigned request is rejected with 403', async () => {
        expect((await post('/v1/voices/twiml', { CallSid: 'CA1' })).status).toBe(403);
    });
    it('wrong signature is rejected with 403', async () => {
        expect((await post('/v1/voices/twiml', { CallSid: 'CA1' }, 'AAAA')).status).toBe(403);
    });
    it('valid signature returns TwiML pointing the gather at the REAL route', async () => {
        const p = { CallSid: 'CA1' };
        const r = await post('/v1/voices/twiml', p, sign('/v1/voices/twiml', p));
        expect(r.status).toBe(200);
        expect(r.text).toContain('/v1/voices/twiml-gather');
        expect(r.text).not.toContain('/v1/voice/twiml-gather');
    });
    it('twiml-gather exists and is signed (unsigned 403, signed unknown call answers politely)', async () => {
        const p = { CallSid: 'CA_unknown', SpeechResult: 'hello' };
        expect((await post('/v1/voices/twiml-gather', p)).status).toBe(403);
        const r = await post('/v1/voices/twiml-gather', p, sign('/v1/voices/twiml-gather', p));
        expect(r.status).toBe(200);
        expect(r.text).toContain('<Response>');
    });
    it('status callback is signed', async () => {
        const p = { CallSid: 'CA1', CallStatus: 'ringing' };
        expect((await post('/v1/voices/status', p)).status).toBe(403);
        expect((await post('/v1/voices/status', p, sign('/v1/voices/status', p))).status).toBe(200);
    });
    it('fails closed (503) when the token is not configured', async () => {
        delete process.env.TWILIO_AUTH_TOKEN;
        const p = { CallSid: 'CA1' };
        expect((await post('/v1/voices/twiml', p, sign('/v1/voices/twiml', p))).status).toBe(503);
    });
});
