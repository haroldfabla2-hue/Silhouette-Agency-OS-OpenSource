import { createStandaloneFixtureHost } from './standalone-preparation';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

const mode = process.argv[2];
assert.ok(mode === 'voice' || mode === 'health-stop');
const failures: unknown[] = [];
const originalEnv = { ...process.env };
const fixtureHost = createStandaloneFixtureHost();
let server: http.Server | undefined;
let tts: typeof import('../../services/ttsService').ttsService | undefined;
let telephony: typeof import('../../services/telephony/telephonyService').telephonyService | undefined;
let sqlite: typeof import('../../services/sqliteService').sqliteService | undefined;
let callId: string | undefined;
let originalConfig: { value: string; updated_at: number } | undefined;
let configCaptured = false;
let acceptHealth!: () => void;
let closeHealth!: () => void;
const healthAccepted = new Promise<void>(resolve => { acceptHealth = resolve; });
const healthClosed = new Promise<void>(resolve => { closeHealth = resolve; });
const bodies: Record<string, unknown>[] = [];
let healthRequests = 0;
const sentinel = '/fixture-not-real-audio.wav';

// Local deadlines activate cleanup. They do NOT cancel production promises:
// a timed-out import/speak is contained by the parent's mandatory process kill.
async function bounded<T>(label: string, work: Promise<T>, ms = 1500): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([work, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Local deadline: ${label}`)), ms);
        })]);
    } finally { if (timer) clearTimeout(timer); }
}
async function cleanup(label: string, operation: () => void | Promise<void>): Promise<void> {
    try { await bounded(label, Promise.resolve().then(operation), 800); }
    catch (error) { failures.push(error); }
}

try {
    await bounded('policy import', import('../../server/config/configLoader'), 2500);
    // The OFF scrub is already complete; no allowlist changes.
    delete process.env.REDIS_URL;
    delete process.env.USE_REDIS;
    process.env.VOICE_PROVIDER = 'local';
    process.env.ENABLE_VOICE_ENGINE = 'true';
    process.env.SILHOUETTE_DEMO_MODE = '1';
    server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/') {
            healthRequests++;
            if (mode === 'health-stop') {
                res.once('close', closeHealth);
                acceptHealth();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        } else if (req.method === 'POST' && req.url === '/speak') {
            try {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(Buffer.from(chunk));
                bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, url: sentinel }));
            } catch (error) { failures.push(error); res.destroy(); }
        } else { res.writeHead(404); res.end(); }
    });
    const listener = server;
    await bounded('listen', new Promise<void>((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', () => { listener.off('error', reject); resolve(); });
    }));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    process.env.VOICE_ENGINE_URL = `http://127.0.0.1:${address.port}`;
    sqlite = (await bounded('SQLite import', import('../../services/sqliteService'), 2500)).sqliteService;
    originalConfig = sqlite.db.prepare('SELECT value, updated_at FROM system_config WHERE key = ?').get('voice_settings') as typeof originalConfig;
    configCaptured = true;
    sqlite.setConfig('voice_settings', { enabled: true, autoSpeak: false, volume: 1, provider: 'local', voiceId: 'GLOBAL_DIFFERENT' });
    // Retain the actual import promise. If its deadline expires, its settlement
    // handler still captures the owner for final drainage before process exit.
    const ttsImport = import('../../services/ttsService').then(module => { tts = module.ttsService; return tts; });
    await bounded('TTS import', ttsImport, 2500);
    if (mode === 'health-stop') {
        await bounded('health accepted', healthAccepted);
        const stopped = tts!.stopBackgroundWork();
        assert.equal(tts!.stopBackgroundWork(), stopped);
        await bounded('health stop', stopped);
        await bounded('health socket closed', healthClosed);
        await bounded('ready after stop', tts!.ready());
        assert.equal(tts!.isLocalEngineAvailable(), false);
        assert.equal(healthRequests, 1);
    } else {
        await bounded('ready', tts!.ready());
        assert.equal(tts!.isLocalEngineAvailable(), true);
        telephony = (await bounded('telephony import', import('../../services/telephony/telephonyService'), 2500)).telephonyService;
        const { call, error } = await bounded('dial', telephony.dial({ toNumber: '+15550100', purpose: 'protocol fixture only', voiceId: 'CALL_CHOSEN' }));
        callId = call?.id;
        assert.equal(error, undefined); assert.ok(callId);
        assert.equal(call.isSimulated, true); assert.equal(call.status, 'IN_PROGRESS');
        const result = await bounded('call turn', telephony.processCallTurn(callId, 'hello from caller'), 2500);
        const fallback = 'Understood. I am processing that request for you right now.';
        assert.equal(result.agentResponse, fallback); assert.equal(result.audioBase64, sentinel);
        assert.deepEqual(bodies, [{ text: fallback, language: 'es', voice_id: 'CALL_CHOSEN', auto_speak: false }]);
        const row = sqlite.db.prepare('SELECT transcript, voice_id, is_simulated FROM telephony_calls WHERE id = ?').get(callId) as { transcript: string; voice_id: string; is_simulated: number };
        assert.equal(row.voice_id, 'CALL_CHOSEN'); assert.equal(row.is_simulated, 1);
        const transcript = JSON.parse(row.transcript) as { speaker: string; text: string }[];
        assert.ok(transcript.some(turn => turn.speaker === 'caller' && turn.text === 'hello from caller'));
        assert.ok(transcript.some(turn => turn.speaker === 'agent' && turn.text === fallback));
        assert.match((await bounded('inactive turn', telephony.processCallTurn('not-active', 'hi'))).error || '', /not currently active/);
        assert.equal(bodies.length, 1);
    }
} catch (error) { failures.push(error); }
finally {
    await cleanup('original producer drain', () => fixtureHost.drainProducers());
    await cleanup('hangup', async () => {
        if (callId && telephony) {
            const result = await telephony.hangup(callId, 'Fixture finished');
            assert.equal(result.error, undefined); assert.equal(result.call?.status, 'COMPLETED');
        }
    });
    await cleanup('initial background stop', async () => { if (tts) await tts.stopBackgroundWork(); });
    // Close HTTP even if a stop timed out, before the last drainage attempt.
    await cleanup('HTTP close', async () => {
        if (server) {
            const listener = server;
            if (listener.listening) await new Promise<void>((resolve, reject) => {
                listener.close(error => error ? reject(error) : resolve()); listener.closeAllConnections();
            });
            else listener.closeAllConnections();
        }
    });
    await cleanup('final background drain', async () => { if (tts) await tts.stopBackgroundWork(); });
    await cleanup('fixture row delete', () => { if (sqlite && callId) sqlite.db.prepare('DELETE FROM telephony_calls WHERE id = ?').run(callId); });
    await cleanup('fixture config restore', () => {
        if (sqlite && configCaptured) {
            if (originalConfig) sqlite.db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)').run('voice_settings', originalConfig.value, originalConfig.updated_at);
            else sqlite.db.prepare('DELETE FROM system_config WHERE key = ?').run('voice_settings');
        }
    });
    // This child, unlike a reused Vitest worker, owns its SQLite instance.
    await cleanup('owned runtime storage and host close', () => fixtureHost.stop());
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
}
if (failures.length) {
    console.error(new AggregateError(failures, `Fixture ${mode} failed including cleanup`));
    process.exitCode = 1;
} else fs.writeFileSync('receipt.json', JSON.stringify({ mode, passed: true, cleanup: true }));
// No process.exit(0): lingering imports/timers must fail the parent deadline.
