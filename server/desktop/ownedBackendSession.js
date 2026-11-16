// Opt-in backend lifecycle. UNSELECTED by CLI/build/Electron until data/runtime
// adapter review. Importing this file does not open stores or start services.
import { timingSafeEqual } from 'node:crypto';
let sessionClaimed = false;
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => hex64(a) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

/** openBackend is a trusted, separately reviewed actual app adapter. It MUST
 * authenticate every protected transport using apiToken BEFORE returning,
 * preserve the owner's validated existing data paths, and clean partial boot
 * failures itself. stopAdmission must prevent new application work before
 * drain waits in-flight tasks and flushes stores; then this module closes HTTP. No such adapter is wired by this module. AuthenticationReady
 * is an adapter assertion, not independent proof of product auth/persistence.
 */
export async function ownDesktopBackend({ openBackend, handshakeMs = 5000, bootMs = 30000, shutdownMs = 10000, sendMs = 250 }) {
    if (typeof process.send !== 'function' || !process.connected) throw new Error('DESKTOP_IPC_REQUIRED');
    if (typeof openBackend !== 'function') throw new Error('DESKTOP_ADAPTER_REQUIRED');
    if (sessionClaimed) throw new Error('DESKTOP_SESSION_ALREADY_OWNED');
    for (const ms of [handshakeMs, bootMs, shutdownMs, sendMs]) {
        if (!Number.isSafeInteger(ms) || ms < 1 || ms > 300000) throw new Error('DESKTOP_DEADLINE_INVALID');
    }
    sessionClaimed = true;
    let state = 'handshake', credentials, backend, stopping, handshakeTimer, bootTimer;
    let terminalFailure = false;
    const failed = () => { terminalFailure = true; };
    const send = message => new Promise(resolve => {
        if (!process.connected) { resolve(false); return; }
        let done = false;
        const end = ok => { if (done) return; done = true; clearTimeout(timer); resolve(ok); };
        const timer = setTimeout(() => end(false), sendMs);
        try { process.send(message, error => end(!error)); } catch { end(false); }
    });
    const closeServer = server => new Promise((resolve, reject) => {
        try { server.close(error => error ? reject(new Error('DESKTOP_CLOSE_FAILED')) : resolve()); }
        catch { reject(new Error('DESKTOP_CLOSE_FAILED')); }
    });
    // Stops are sticky. A request during async boot is recorded and waits for
    // the adapter result; the deadline covers that wait too. No ready after stop.
    const stop = reason => {
        if (stopping) return stopping;
        state = 'stopping'; clearTimeout(handshakeTimer); clearTimeout(bootTimer);
        const deadline = setTimeout(() => {
            // Best-effort fixed diagnostic, never proof of parent receipt.
            // Forced exit cannot verify partial boot/drain or descendants.
            process.stderr.write('[DESKTOP] UNRESOLVED_PARTIAL_BOOT_OR_DRAIN\n');
            process.exit(1);
        }, shutdownMs);
        stopping = (async () => {
            let ok = !terminalFailure;
            try {
                if (bootPromise) await bootPromise;
                if (backend) { await backend.stopAdmission(); await backend.drain(); }
            } catch { ok = false; }
            try { if (backend?.server) await closeServer(backend.server); } catch { ok = false; }
            ok = ok && !terminalFailure;
            // clean describes resource drainage only, NOT receipt. Disconnected
            // owners cannot receive a receipt. Connected send failure exits1.
            const expectedReceipt = process.connected;
            const delivered = await send({ type: 'desktop-stopped', sessionId: credentials?.sessionId, reason, clean: ok });
            if (expectedReceipt && !delivered) failed();
            clearTimeout(deadline);
            process.exit(ok && !terminalFailure ? 0 : 1);
        })();
        return stopping;
    };
    let bootPromise;
    const boot = async () => {
        try {
            // No env, cwd, data-path or CLI-token precedence changes here.
            backend = await openBackend(Object.freeze({ host: '127.0.0.1', port: 0, apiToken: credentials.apiToken }));
            if (!backend || typeof backend.drain !== 'function' || typeof backend.stopAdmission !== 'function' || !backend.server || backend.authenticationReady !== true) throw new Error('invalid adapter');
            const address = backend.server.address();
            if (!address || typeof address === 'string' || address.address !== '127.0.0.1' || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535) throw new Error('invalid bind');
            clearTimeout(bootTimer);
            if (state !== 'booting') return;
            state = 'ready';
            if (!await send({ type: 'desktop-ready', sessionId: credentials.sessionId, host: '127.0.0.1', port: address.port, pid: process.pid })) { failed(); void stop('ipc-send-failed'); }
        } catch {
            failed(); clearTimeout(bootTimer);
            // Never forward adapter errors, stack, paths, token or provider data.
            await send({ type: 'desktop-failed', code: 'BOOT_FAILED', sessionId: credentials.sessionId });
            // Schedule outside bootPromise to avoid self-await deadlock.
            setImmediate(() => { void stop('boot-failed'); });
        }
    };
    const onMessage = message => {
        if (!message || typeof message !== 'object') return;
        if (state === 'handshake') {
            if (message.type !== 'desktop-init' || !hex64(message.sessionId) || !hex64(message.controlToken) || !hex64(message.apiToken)) return;
            if (new Set([message.sessionId, message.controlToken, message.apiToken]).size !== 3) return;
            credentials = { sessionId: message.sessionId, controlToken: message.controlToken, apiToken: message.apiToken };
            clearTimeout(handshakeTimer); state = 'booting';
            bootTimer = setTimeout(() => { failed(); void stop('boot-timeout-partial-unresolved'); }, bootMs);
            bootPromise = boot();
            return;
        }
        if (message.type === 'desktop-shutdown' && credentials && same(message.sessionId, credentials.sessionId) && same(message.controlToken, credentials.controlToken)) void stop('owner-request');
    };
    process.on('message', onMessage);
    process.once('disconnect', () => { void stop('owner-disconnected'); });
    // Catch send-channel errors immediately. Not an error-message disclosure path.
    process.on('error', () => { failed(); void stop('ipc-error'); });
    process.once('SIGTERM', () => { void stop('signal'); });
    process.once('SIGINT', () => { void stop('signal'); });
    handshakeTimer = setTimeout(() => { failed(); void stop('handshake-timeout'); }, handshakeMs);
    return Object.freeze({ state: () => state });
}
