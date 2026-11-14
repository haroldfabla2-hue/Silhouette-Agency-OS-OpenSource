import { createStandaloneFixtureHost } from './standalone-preparation';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Existing simulated Twilio response classification, not a real provider.
// Summary-provider OFF must be captured before ANY application import.
const mode = process.argv[2];
assert.ok(mode, 'A single scenario selector is required');
assert.equal(process.env.SILHOUETTE_PROVIDERS, 'off');
const originalEnv = { ...process.env };
const fixtureHost = createStandaloneFixtureHost();
const originalFetch = globalThis.fetch;
const failures: unknown[] = [];
const fixtureCalls = new Set<string>();
let unexpectedRequests: string[] = [];
let expectedSid: string | undefined;
let fetchCount = 0;
let responseStatus = 200;
let responseBody: unknown = {};
let plannedNetworkError = false;
let sqlite: typeof import('../../services/sqliteService').sqliteService | undefined;
let tts: typeof import('../../services/ttsService').ttsService | undefined;
let telephony: typeof import('../../services/telephony/telephonyService').telephonyService | undefined;
let scenarios = 0;
async function bounded<T>(label: string, work: Promise<T>, ms = 1500): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Local deadline: ${label}`)), ms);
    })]); } finally { if (timer) clearTimeout(timer); }
}
async function cleanup(label: string, work: () => void | Promise<void>) {
    try { await bounded(label, Promise.resolve().then(work), 800); }
    catch (error) { failures.push(error); }
}
function respond(status: number, body: unknown = {}, networkError = false) {
    responseStatus = status; responseBody = body; plannedNetworkError = networkError;
}
const fixtureFetch: typeof fetch = async (input, init) => {
    fetchCount++;
    try {
        const url = String(input);
        const dialUrl = 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Calls.json';
        const updateUrl = expectedSid
            ? `https://api.twilio.com/2010-04-01/Accounts/ACtest/Calls/${expectedSid}.json` : undefined;
        assert.ok(url === dialUrl || url === updateUrl, `Unexpected URL ${url}`);
        assert.equal(init?.method, 'POST');
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('Authorization'), `Basic ${Buffer.from('ACtest:tok').toString('base64')}`);
        assert.equal(headers.get('Content-Type'), 'application/x-www-form-urlencoded');
        const body = new URLSearchParams(String(init?.body));
        const expected = url === dialUrl ? new URLSearchParams({
            To: '+15550100', From: '+15550199000', Url: 'https://example.test/v1/voices/twiml',
            StatusCallback: 'https://example.test/v1/voices/status',
            StatusCallbackEvent: 'initiated ringing answered completed'
        }) : body.has('Twiml') ? new URLSearchParams({ Twiml: '<Response><Play digits="1"/></Response>' })
            : new URLSearchParams({ Status: 'completed' });
        assert.deepEqual([...body.entries()].sort(), [...expected.entries()].sort());
    } catch (error) { unexpectedRequests.push(String(error)); throw error; }
    if (plannedNetworkError) throw new Error('ECONNREFUSED');
    return new Response(JSON.stringify(responseBody), { status: responseStatus, headers: { 'Content-Type': 'application/json' } });
};
try {
    await bounded('policy scrub', import('../../server/config/configLoader'), 2500);
    delete process.env.REDIS_URL; delete process.env.USE_REDIS;
    process.env.SILHOUETTE_INFERENCE_MODE = 'cloud-only';
    sqlite = (await bounded('SQLite import', import('../../services/sqliteService'), 2500)).sqliteService;
    // Deny speech at config level. No inference or audio operation in these cases.
    sqlite.setConfig('voice_settings', { enabled: false, autoSpeak: false, volume: 1, provider: 'local' });
    const ttsImport = import('../../services/ttsService').then(module => { tts = module.ttsService; return tts; });
    await bounded('TTS import', ttsImport, 2500);
    const telephonyImport = import('../../services/telephony/telephonyService').then(module => {
        telephony = module.telephonyService; return module;
    });
    const { mapProviderStatus, canTransition } = await bounded('telephony import', telephonyImport, 2500);
    const service = telephony!;
    globalThis.fetch = fixtureFetch;
    const reset = () => {
        unexpectedRequests = []; expectedSid = undefined; fetchCount = 0;
        delete process.env.SILHOUETTE_DEMO_MODE;
        // Only synthetic fixture credentials, after the OFF scrub. Summary LLM
        // remains OFF; this does not claim a provider-ON process.
        process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok';
        process.env.TWILIO_PHONE_NUMBER = '+15550199000';
        process.env.SILHOUETTE_VOICE_WEBHOOK = 'https://example.test/v1/voices/twiml';
        service.reloadCredentials(); service.setMediaStreamSender(null);
        respond(200);
    };
    const dial = async () => {
        const result = await bounded('dial', service.dial({ toNumber: '+15550100', purpose: 'x' }));
        if (result.call) fixtureCalls.add(result.call.id);
        return result;
    };
    let counter = 0;
    const active = async () => {
        expectedSid = `CAlive${++counter}`; respond(201, { sid: expectedSid });
        const result = await dial();
        service.applyProviderStatus(expectedSid, 'in-progress');
        return result.call.id;
    };
    const scenario = async (name: string, operation: () => Promise<void> | void) => {
        if (name !== mode) return;
        reset();
        try { await bounded(name, Promise.resolve().then(operation)); }
        finally { assert.deepEqual(unexpectedRequests, [], 'Unexpected requests cannot be hidden by product catch'); }
        scenarios++;
    };
    await scenario('401 fails', async () => {
        respond(401); const result = await dial();
        assert.equal(result.call.status, 'FAILED'); assert.equal(result.call.providerCallSid, undefined);
        assert.match(result.error || '', /401/); assert.equal(service.getCall(result.call.id)?.status, 'FAILED');
    });
    await scenario('network error fails', async () => {
        respond(200, {}, true); const result = await dial();
        assert.equal(result.call.status, 'FAILED'); assert.match(result.error || '', /ECONNREFUSED/);
    });
    await scenario('SID and callbacks', async () => {
        respond(201, {}); assert.equal((await dial()).call.status, 'FAILED');
        respond(201, { sid: 'CA123' }); const result = await dial();
        assert.equal(result.call.status, 'QUEUED'); assert.equal(result.call.isSimulated, false);
        assert.equal(service.applyProviderStatus('CA123', 'ringing')?.status, 'RINGING');
        assert.equal(service.applyProviderStatus('CA123', 'in-progress')?.status, 'IN_PROGRESS');
        assert.equal(service.applyProviderStatus('CA123', 'ringing'), null);
    });
    await scenario('missing webhook', async () => {
        delete process.env.SILHOUETTE_VOICE_WEBHOOK;
        assert.equal((await dial()).call.status, 'FAILED'); assert.equal(fetchCount, 0);
    });
    await scenario('no credentials unavailable', async () => {
        delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; service.reloadCredentials();
        const result = await dial(); assert.equal(result.call.status, 'FAILED'); assert.match(result.error || '', /UNAVAILABLE/);
    });
    await scenario('demo labelled', async () => {
        delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN;
        process.env.SILHOUETTE_DEMO_MODE = '1'; service.reloadCredentials();
        assert.equal((await dial()).call.isSimulated, true); assert.equal(fetchCount, 0);
    });
    await scenario('DTMF rejection', async () => {
        const id = await active(); respond(500);
        assert.equal((await bounded('DTMF', service.sendDtmf(id, '1'))).success, false);
        assert.equal(service.getCall(id)?.transcript.some(turn => turn.dtmfDigits), false);
    });
    await scenario('hangup rejected remains active', async () => {
        const id = await active(); respond(503);
        const result = await bounded('rejected hangup', service.hangup(id));
        assert.match(result.error || '', /NOT confirmed/); assert.equal(service.getCall(id)?.status, 'IN_PROGRESS');
        const row = sqlite!.db.prepare('SELECT status FROM telephony_calls WHERE id = ?').get(id) as { status: string };
        assert.equal(row.status, 'IN_PROGRESS');
    });
    await scenario('hangup confirmed and OFF summary', async () => {
        const id = await active(); respond(200);
        const result = await bounded('confirmed hangup', service.hangup(id));
        assert.equal(result.error, undefined); assert.equal(result.call?.status, 'COMPLETED');
        const summary = 'Phone call to +15550100 regarding x. Result: Completed normally';
        assert.equal(result.call?.summary, summary);
        const row = sqlite!.db.prepare('SELECT status, summary FROM telephony_calls WHERE id = ?').get(id) as { status: string; summary: string };
        assert.deepEqual(row, { status: 'COMPLETED', summary }); assert.equal(fetchCount, 2);
    });
    await scenario('barge-in without stream', async () => {
        const id = await active(); const result = await bounded('barge-in', service.triggerBargeIn(id));
        assert.equal(result.success, false); assert.match(result.error || '', /UNAVAILABLE/);
    });
    await scenario('barge-in stream clear', async () => {
        const id = await active(); const sent: unknown[] = [];
        service.setMediaStreamSender(async (callId, message) => { sent.push([callId, message]); return true; });
        assert.equal((await bounded('barge-in', service.triggerBargeIn(id))).success, true);
        assert.deepEqual(sent, [[id, { event: 'clear' }]]);
    });
    await scenario('pure state transitions', () => {
        assert.equal(mapProviderStatus('no-answer'), 'FAILED'); assert.equal(mapProviderStatus('weird'), null);
        assert.equal(canTransition('QUEUED', 'RINGING'), true); assert.equal(canTransition('IN_PROGRESS', 'RINGING'), false);
        assert.equal(canTransition('COMPLETED', 'IN_PROGRESS'), false); assert.equal(canTransition('FAILED', 'COMPLETED'), false);
    });
    assert.equal(scenarios, 1, 'Exactly one selected scenario must execute');
} catch (error) { failures.push(error); }
finally {
    await cleanup('original producer drain', () => fixtureHost.drainProducers());
    // No real provider calls in cleanup. Removing fixture credentials makes
    // hangup of leftover synthetic calls local; summary policy remains OFF.
    await cleanup('active call cleanup', async () => {
        if (telephony) {
            delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN;
            telephony.reloadCredentials(); telephony.setMediaStreamSender(null);
            for (const id of fixtureCalls) {
                const call = telephony.getCall(id);
                if (call && !['COMPLETED', 'FAILED', 'BUSY'].includes(call.status)) {
                    const result = await telephony.hangup(id, 'Fixture cleanup');
                    assert.equal(result.error, undefined);
                }
            }
        }
    });
    await cleanup('TTS stop', async () => { if (tts) await tts.stopBackgroundWork(); });
    await cleanup('fixture row deletion', () => {
        if (sqlite) {
            for (const id of fixtureCalls) sqlite.db.prepare('DELETE FROM telephony_calls WHERE id = ?').run(id);
            sqlite.db.prepare('DELETE FROM system_config WHERE key = ?').run('voice_settings');
        }
    });
    await cleanup('owned runtime storage and host close', () => fixtureHost.stop());
    await cleanup('unexpected requests through cleanup', () => {
        assert.deepEqual(unexpectedRequests, [], 'Cleanup cannot hide unexpected transport requests');
    });
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
}
if (failures.length) { console.error(new AggregateError(failures, 'Legacy classification failed including cleanup')); process.exitCode = 1; }
else fs.writeFileSync('receipt.json', JSON.stringify({ mode, passed: true, cleanup: true }));
// No force-exit success. Parent requires natural exit and group disappearance.
