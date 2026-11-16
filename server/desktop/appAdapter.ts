import { createStartedResources, bindStartedResources, registerStarted } from './startedResources.js';
import { createProducerScope, bindProducerScope } from './producerScope.js';
// SOURCE-ONLY integration candidate. Not imported by CLI/Electron/build/entry.
// Do not execute against any real installation without separate adapter review
// and disposable target-stage authority. Native/runtime/root chooser not supplied.
import { Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { verifyExistingSelection } from './existingRoot.js';
import { bindPrivateDesktopToken, privateDesktopBearer } from './privateSession';

export function prepareActualAppAdapter(selection: unknown, trustedSelectionDigest: string) {
    // Trusted chooser-owned source input, NOT part of desktop-init IPC payload.
    verifyExistingSelection(selection, trustedSelectionDigest);
    let claimed = false;
    return async ({ host, port, apiToken }: { host: string; port: number; apiToken: string }) => {
        if (claimed || host !== '127.0.0.1' || port !== 0) throw new Error('DESKTOP_ADAPTER_INVALID');
        claimed = true;
        verifyExistingSelection(selection, trustedSelectionDigest);
        bindPrivateDesktopToken(apiToken);
        const producers = createProducerScope();
        bindProducerScope(producers);
        const resources = createStartedResources();
        bindStartedResources(resources);
        let accepting = false, inFlight = 0;
        const processStartedAt = Date.now();
        // Gate every HTTP request including otherwise-public/static routes.
        // This is stricter only in dedicated desktop adapter, not CLI policy.
        class OwnedTransport extends Server {
            emit(event: string, ...args: any[]): boolean {
                if (event === 'upgrade' && (!accepting || !privateDesktopBearer(args[0]?.headers?.authorization))) {
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
                inFlight++;
                let counted = true;
                const finished = () => { if (counted) { counted = false; inFlight--; } };
                res.once('finish', finished); res.once('close', finished);
                app(req, res);
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
            registerStarted('core-sqlite', {close: () => sqliteService.close()});
            accepting = true;
            transport.on('error', () => {
                accepting = false;
                process.stderr.write('[DESKTOP] BACKEND_TRANSPORT_FAILED\n');
                process.exit(1);
            });
            return {
                server: transport,
                authenticationReady: true, // Actual outer gate installed, identity initialized.
                stopAdmission: async () => { accepting = false; producers.stopAdmission(); await resources.stopAdmission(); },
                drain: async () => {
                    const until = Date.now() + 4000;
                    while (inFlight && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
                    if (inFlight) throw new Error('DESKTOP_HTTP_INFLIGHT_UNRESOLVED');
                    await resources.finalize(async () => {
                        await producers.drain(4000);
                        // Unknown writers block ALL store flush/close, not just
                        // a success label after stores were already closed.
                        throw new Error('DESKTOP_BACKGROUND_ADMISSION_UNRESOLVED');
                    });
                    // Only registered known-started handles touched. Missing
                    // channel/plugin inflight and nested producers remain.
                    throw new Error('DESKTOP_BACKGROUND_ADMISSION_UNRESOLVED');
                }
            };
        } catch {
            accepting = false; producers.stopAdmission();
            transport.close(); transport.closeAllConnections();
            // Product imports may be partially initialized. NEVER dynamically
            // import cleanup singletons that might start previously unused work.
            // Known transport only is closed; product resource rollback remains
            // unresolved and owned session stop deadline must bound termination.
            throw new Error('DESKTOP_PARTIAL_BOOT_UNRESOLVED');
        }
    };
}
