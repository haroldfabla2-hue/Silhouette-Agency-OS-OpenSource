import { createStartedResources, bindStartedResources, registerStarted } from './startedResources.js';
import { createProducerScope, bindProducerScope } from './producerScope.js';
import { createWorkSession } from './workSession.js';
import { bindDesktopWork } from '../../services/lifecycle/desktopWork.js';
import { readProducerSafetyReceipts } from '../../services/lifecycle/producerReceipts';
import { takeOwnedProducerPhases } from '../../services/lifecycle/ownedProducers';
// SOURCE-ONLY integration candidate. Not imported by CLI/Electron/build/entry.
// Do not execute against any real installation without separate adapter review
// and disposable target-stage authority. Native/runtime/root chooser not supplied.
import { Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { verifyExistingSelection } from './existingRoot.js';
import { bindPrivateDesktopToken, privateDesktopBearer, privateDesktopRecoveryUpgrade } from './privateSession';

export function prepareActualAppAdapter(selection: unknown, trustedSelectionDigest: string) {
    // Trusted chooser-owned source input, NOT part of desktop-init IPC payload.
    verifyExistingSelection(selection, trustedSelectionDigest);
    let claimed = false;
    return async ({ host, port, apiToken }: { host: string; port: number; apiToken: string }) => {
        if (claimed || host !== '127.0.0.1' || port !== 0) throw new Error('DESKTOP_ADAPTER_INVALID');
        claimed = true;
        verifyExistingSelection(selection, trustedSelectionDigest);
        bindPrivateDesktopToken(apiToken);
        const work = createWorkSession();
        bindDesktopWork(work);
        const producers = createProducerScope();
        bindProducerScope(producers);
        const resources = createStartedResources();
        bindStartedResources(resources);
        let producerReceipts: Record<string, unknown> | null = null;
        let stopTask: Promise<void> | null = null;
        let drainTask: Promise<void> | null = null;
        let accepting = false, inFlight = 0;
        const processStartedAt = Date.now();
        // Gate every HTTP request including otherwise-public/static routes.
        // This is stricter only in dedicated desktop adapter, not CLI policy.
        class OwnedTransport extends Server {
            emit(event: string, ...args: any[]): boolean {
                if (event === 'upgrade' && (!privateDesktopBearer(args[0]?.headers?.authorization)
                    || (!accepting && !privateDesktopRecoveryUpgrade(args[0])))) {
                    args[1].destroy(); return false;
                }
                return super.emit(event, ...args);
            }
        }
        const transport = new OwnedTransport();
        try {
            // ALL app/config/store/service imports occur AFTER existing-root
            // verification and IPC token binding. No cwd or env rewriting.
            // Preserve original entry's stream aggregation capability. Desktop
            // fatal policy is intentionally fail-closed rather than CLI's
            // log-and-continue rejection policy; logger imports during fatal
            // handling could start uninitialized product components.
            process.on('unhandledRejection', () => {
                accepting = false;
                process.stderr.write('[DESKTOP] UNHANDLED_REJECTION_UNRESOLVED\n');
                process.exit(1);
            });
            process.on('uncaughtException', () => {
                accepting = false;
                process.stderr.write('[DESKTOP] UNCAUGHT_EXCEPTION_UNRESOLVED\n');
                process.exit(1);
            });
            await import('../../services/narrativeService');
            const { app, appInitialization } = await import('../app');
            await appInitialization;
            transport.on('request', (req: IncomingMessage, res: ServerResponse) => {
                if (!accepting) { res.writeHead(503); res.end(); return; }
                if (!privateDesktopBearer(req.headers.authorization)) { res.writeHead(401); res.end(); return; }
                // HTTP response lifecycle is one root. Explicit bus dispatches
                // transfer separate tickets BEFORE calling their subscribers,
                // so response finish/close cannot orphan cognitive work.
                void work.root('http-response', () => new Promise<void>((resolve, reject) => {
                    inFlight++;
                    let counted = true;
                    const finished = () => { if (counted) { counted = false; inFlight--; resolve(); } };
                    res.once('finish', finished); res.once('close', finished);
                    try { app(req, res); }
                    catch (error) { if (counted) { counted = false; inFlight--; } reject(error); }
                })).catch(() => { work.fault('http-response', 'dispatch-failed'); });
            });
            await new Promise<void>((resolve, reject) => {
                transport.once('error', reject);
                transport.listen(0, '127.0.0.1', () => { transport.removeListener('error', reject); resolve(); });
            });
            const { initializeBackendServices } = await import('../backendServices');
            await initializeBackendServices(transport, app, processStartedAt);
            const { identityService } = await import('../../services/identityService');
            await identityService.init();
            const { sqliteService } = await import('../../services/sqliteService');
            registerStarted('core-sqlite', {closeAfter: ['plugins', 'messaging-channels', 'websocket-gateway', 'terminal-websocket', 'terminal-shells', 'redis', 'graph'], close: () => sqliteService.close()});
            accepting = true;
            transport.on('error', () => {
                accepting = false;
                process.stderr.write('[DESKTOP] BACKEND_TRANSPORT_FAILED\n');
                process.exit(1);
            });
            return {
                server: transport,
                authenticationReady: true, // Actual outer gate installed, identity initialized.
                stopAdmission: () => {
                    if (stopTask) return stopTask;
                    accepting = false;
                    work.closeRoots();
                    producers.stopAdmission(); // timers only; descendants use shared live tickets
                    // Do NOT stop narrative/arbiter admission here. Accepted
                    // roots still need tools, replies and final narrative writes.
                    stopTask = work.stopSources(() => resources.stopAdmission());
                    void stopTask.catch(() => {});
                    return stopTask;
                },
                drain: () => {
                    if (drainTask) return drainTask;
                    drainTask = (async () => {
                    if (!stopTask) throw new Error('DESKTOP_ADMISSION_NOT_STOPPED');
                    await stopTask;
                    await work.drain(4000); // global exhaustion, then atomic seal
                    // Control runs OUTSIDE all phase tickets. One cleanup or
                    // producer stop may emit separately-owned descendants; wait
                    // for them globally BEFORE invoking any dependent next phase.
                    for (const phase of resources.releasePhases()) {
                        await work.runFinalPhase(() => phase.release(), 4000);
                    }
                    producerReceipts = {};
                    for (const phase of takeOwnedProducerPhases()) {
                        producerReceipts[phase.name] = await work.runFinalPhase(() => Promise.resolve(phase.stop()), 4000);
                        const receipts = readProducerSafetyReceipts(producerReceipts);
                        const n = receipts.narrative;
                        const a = receipts.arbiter;
                        const p = receipts.power;
                        if (n?.stopFailed || (n && (n.error !== null || n.remainingItems > 0 || n.workStillOwned))
                            || a?.stopFailed || a?.boundExhausted || p?.stopFailed) {
                            work.fault('final-producers', 'preservation-failed');
                            throw new Error('DESKTOP_REGISTERED_PRODUCERS_UNRESOLVED');
                        }
                    }
                    work.producersPreserved();
                    await resources.finalize(async () => {
                        // Unknown writers block ALL store flush/close, not just
                        // a success label after stores were already closed.
                        throw new Error('DESKTOP_BACKGROUND_ADMISSION_UNRESOLVED');
                    });
                    work.storesClosed();
                    // Known writers still unresolved, no success by vertical slice.
                    throw new Error('DESKTOP_BACKGROUND_ADMISSION_UNRESOLVED');
                    })();
                    // Concurrent drain calls share ownership, not duplicate
                    // flush/close. Recovery/retry of already executed phases
                    // remains a separate open contract, not automatic replay.
                    void drainTask.then(() => { drainTask = null; }, () => { drainTask = null; });
                    return drainTask;
                }
            };
        } catch {
            accepting = false; work.closeRoots(); producers.stopAdmission();
            transport.close(); transport.closeAllConnections();
            // Product imports may be partially initialized. NEVER dynamically
            // import cleanup singletons that might start previously unused work.
            // Known transport only is closed; product resource rollback remains
            // unresolved and owned session stop deadline must bound termination.
            throw new Error('DESKTOP_PARTIAL_BOOT_UNRESOLVED');
        }
    };
}
