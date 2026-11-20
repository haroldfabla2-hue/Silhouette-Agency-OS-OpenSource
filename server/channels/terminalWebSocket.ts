import { privateDesktopToken, privateDesktopBearer, bindPrivateDesktopRecoveryUpgrade } from '../desktop/privateSession';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { TerminalService } from '../../services/system/terminalService';
import { v4 as uuidv4 } from 'uuid';
import { desktopRootsOpen, desktopFault } from '../../services/lifecycle/desktopWork.js';
import { registerStarted } from '../desktop/startedResources.js';

export class TerminalGateway {
    private static wss: WebSocketServer | null = null;
    private static service = TerminalService.getInstance();
    private static accepting = true;
    private static resumeCapabilities = new Map<string, string>();
    private static connectedSessions = new Set<string>();
    private static recoveryObservers = new Set<string>();
    private static closeTask: Promise<void> | null = null;

    public static initialize(server: Server, path: string = '/api/terminal/ws') {
        if (this.wss || !this.accepting || !desktopRootsOpen()) throw new Error('TERMINAL_GATEWAY_NOT_STARTABLE');
        this.wss = new WebSocketServer({ server, path, maxPayload: 131072 });
        if (privateDesktopToken()) bindPrivateDesktopRecoveryUpgrade((request: any) => {
            const url = new URL(request.url || '', 'http://localhost');
            if (url.pathname !== path || url.searchParams.get('protocol') !== 'v2') return false;
            const offered = String(request.headers?.['sec-websocket-protocol'] || '').split(',').map(value => value.trim());
            const capability = offered.find(value => value.startsWith('resume.'))?.slice(7);
            return !!capability && this.resumeCapabilities.has(capability)
                && this.service.hasSession(this.resumeCapabilities.get(capability)!);
        });
        // Register the actual acquired WSS before any client is admitted.
        registerStarted('terminal-websocket', {
            stopAdmission: () => this.stopAdmission(),
            close: () => this.closeDesktop()
        });
        this.wss.on('connection', (ws, req) => {
            const url = new URL(req.url || '', 'http://localhost');
            const token = privateDesktopToken() ? undefined : url.searchParams.get('token');
            const expectedToken = privateDesktopToken() || process.env.SILHOUETTE_API_KEY;
            if (privateDesktopToken() ? !privateDesktopBearer(req.headers.authorization) : expectedToken && token !== expectedToken) {
                ws.close(3000, 'Unauthorized'); return;
            }
            const framed = url.searchParams.get('protocol') === 'v2';
            // Capability is not in URLs/access logs. Browser supplies a private
            // subprotocol token; it still requires normal gateway authentication.
            const offered = String(req.headers['sec-websocket-protocol'] || '').split(',').map(value => value.trim());
            const requestedControlOnly = offered.includes('control-only');
            const resume = framed ? offered.find(value => value.startsWith('resume.'))?.slice(7) || null : null;
            // An explicit no-input/no-new-shell offer must fail closed. Never
            // downgrade malformed control-only to a normal terminal session.
            if (requestedControlOnly && (!framed || !resume || !this.resumeCapabilities.has(resume)
                || !this.service.hasSession(this.resumeCapabilities.get(resume)!))) {
                ws.close(1008, 'Control-only requires v2 and an owned resume capability'); return;
            }
            if (resume && !this.resumeCapabilities.has(resume)) { ws.close(3000, 'Invalid resume capability'); return; }
            if ((!this.accepting || !desktopRootsOpen()) && !resume) { ws.close(1001, 'Server stopping'); return; }
            const controlOnly = requestedControlOnly;
            this.handleConnection(ws, framed, resume, controlOnly);
        });
    }

    private static handleConnection(ws: WebSocket, framed: boolean, resume: string | null, controlOnly: boolean) {
        const sessionId = resume ? this.resumeCapabilities.get(resume)! : uuidv4();
        const capability = resume ?? uuidv4();
        const connections = controlOnly ? this.recoveryObservers : this.connectedSessions;
        if (connections.has(sessionId)) { ws.close(1008, 'Session already attached'); return; }
        if (!resume && this.resumeCapabilities.size >= 4) { ws.close(1008, 'Retained session limit'); return; }
        if (!resume) this.resumeCapabilities.set(capability, sessionId);
        connections.add(sessionId);
        let inputInFlight = false;
        let controlQueued = 0, statusQueued = false;
        // No queue chained to a previous callback or effect. Keep a reserved
        // status slot and an independently authenticated control-only observer
        // if this socket's transport cannot progress. Never clear a stuck send
        // or helper by timeout; every submitted callback retains its owner.
        const control = (frame: object, statusLane = false): Promise<void> => {
            if ((statusLane ? statusQueued : controlQueued >= 4) || !this.service.controlAvailable(sessionId, statusLane)) {
                desktopFault('terminal-control', 'reply-capacity-state-query-required');
                return Promise.reject(new Error('TERMINAL_CONTROL_CAPACITY'));
            }
            if (statusLane) statusQueued = true; else controlQueued++;
            const pending = this.service.trackControl(sessionId, () => new Promise<void>((resolve, reject) => {
                if (ws.readyState !== WebSocket.OPEN) { reject(new Error('TERMINAL_CONTROL_DISCONNECTED')); return; }
                ws.send(JSON.stringify(frame), error => error ? reject(error) : resolve());
            }), statusLane);
            const settled = () => { if (statusLane) statusQueued = false; else controlQueued--; };
            void pending.then(settled, () => {
                settled(); desktopFault('terminal-control', 'reply-undelivered-state-query-required');
            });
            return pending;
        };
        const notify = (frame: object, statusLane = false) => { void control(frame, statusLane).catch(() => {}); };
        const dataHandler = (id: string, data: Buffer, offset: number) => {
            if (!controlOnly && id === sessionId && ws.readyState === WebSocket.OPEN && ws.bufferedAmount <= 262144 && this.service.canDeliver(sessionId)) {
                void this.service.trackOutput(sessionId, () => new Promise<void>((resolve, reject) => {
                    ws.send(framed ? JSON.stringify({type: 'output', base64: data.toString('base64'), offset}) : data, error => error ? reject(error) : resolve());
                })).catch(error => {
                    desktopFault('terminal-output', 'socket-write-uncertain');
                    console.error('[Terminal] Output delivery failed:', {sessionId});
                });
            }
        };
        const closeHandler = (id: string) => {
            if (id === sessionId) {
                // Closed shells still expose retained output through this bound
                // control channel. A shell-close notice is not a tree receipt.
                if (framed) notify({type: 'shell-closed'}); else ws.close();
            }
        };
        const errorHandler = (id: string) => {
            if (id === sessionId) ws.close(1011, 'Shell unavailable');
        };
        // Install consumers before spawn so early process events are not lost.
        this.service.on('data', dataHandler);
        this.service.on('close', closeHandler);
        this.service.on('sessionError', errorHandler);
        const detach = () => {
            this.service.removeListener('data', dataHandler);
            this.service.removeListener('close', closeHandler);
            this.service.removeListener('sessionError', errorHandler);
        };
        ws.on('error', error => {
            console.error('[Terminal] WebSocket error:', {sessionId});
        });
        ws.on('message', message => {
            // Register/inspect synchronously. A helper, stdin callback or prior
            // send never blocks reading status or a distinct explicit action.
            if (!framed) {
                if (this.accepting && desktopRootsOpen()) void this.service.write(sessionId, message.toString()).catch(() => desktopFault('terminal-input', 'legacy-input-result-uncertain'));
                return;
            }
            let frame;
            try { frame = JSON.parse(message.toString()); } catch { ws.close(1003, 'Invalid terminal frame'); return; }
            if (!this.service.hasSession(sessionId)) { ws.close(1011, 'Session unavailable'); return; }
            if (frame?.type === 'status') {
                notify({type: 'status', ...this.service.outputStatus(sessionId)}, true); return;
            }
            // Check current reply capacity before registering a new action.
            // This is NOT a reservation across an awaited stdin callback and
            // cannot guarantee a future receipt. Known saturation has no effect.
            if (controlQueued >= 4 || !this.service.controlAvailable(sessionId)) {
                // This branch returns before registering ANY effect. Correlate only
                // a bounded, syntactically valid ID, never reflect input text.
                const clientInputId = frame?.type === 'input' && typeof frame.clientInputId === 'string'
                    && /^[a-f0-9-]{36}:[0-9]{1,12}$/.test(frame.clientInputId) ? frame.clientInputId : undefined;
                if (clientInputId) notify({type: 'input-rejected', clientInputId, admitted: false, reason: 'response-capacity'}, true);
                else notify({type: 'status', requestNotRegistered: true, requestType: ['cancel', 'preserve-disconnect', 'read-retained'].includes(frame?.type) ? frame.type : 'unsupported', ...this.service.outputStatus(sessionId)}, true);
                return;
            }
            if (frame?.type === 'preserve-disconnect') {
                this.service.setPreserveDisconnect(sessionId, true);
                notify({type: 'preserve-ready', ...this.service.outputStatus(sessionId)}); return;
            }
            if (frame?.type === 'cancel') {
                // Deduplicated in-flight effect owned by service. Reply with
                // registration state now, not after helper completion. Query
                // status for result; no retry due to silence or reconnect.
                const effect = this.service.cancelSession(sessionId);
                void effect.catch(() => desktopFault('terminal-shell', 'cancel-owner-unresolved'));
                notify({type: 'cancel-registered', ...this.service.outputStatus(sessionId)}); return;
            }
            if (frame?.type === 'read-retained') {
                try {
                    const bytes = this.service.readRetainedOutput(sessionId, frame.offset);
                    notify({type: 'retained', offset: frame.offset, base64: bytes.toString('base64'), ...this.service.outputStatus(sessionId)});
                } catch { notify({type: 'control-error', reason: 'read-invalid'}); }
                return;
            }
            if (frame?.type !== 'input' || typeof frame.data !== 'string') { notify({type: 'control-error', reason: 'unsupported'}); return; }
            if (controlOnly || !this.accepting || !desktopRootsOpen() || inputInFlight) {
                notify({type: 'input-rejected', clientInputId: frame.clientInputId, admitted: false}); return;
            }
            inputInFlight = true;
            const effect = this.service.write(sessionId, frame.data, frame.clientInputId);
            void effect.then(() => {
                notify({type: 'input-result', clientInputId: frame.clientInputId, kind: 'stdin-callback', commandCompleted: false});
            }, () => {
                notify({type: 'input-rejected', clientInputId: frame.clientInputId, admitted: 'unverified', retry: false});
            }).finally(() => {inputInFlight = false;});
        });
        ws.once('close', () => {
            detach();
            connections.delete(sessionId);
            // Preserve native disconnect-cancel unless the connected user sent
            // a distinct preservation action. Network loss alone grants nothing.
            if (!controlOnly && this.service.hasSession(sessionId) && this.service.outputStatus(sessionId).disconnectPolicy !== 'preserve') void this.service.cancelSession(sessionId).catch(() => desktopFault('terminal-shell', 'legacy-disconnect-cancel-unknown'));
        });
        try {
            if (!resume) this.service.createSession(sessionId);
            if (framed) notify({type: 'ready', resume: capability, controlOnly, ...this.service.outputStatus(sessionId)});
        } catch {
            detach();
            connections.delete(sessionId);
            if (!this.service.hasSession(sessionId)) this.resumeCapabilities.delete(capability);
            // Retain any partial handle; no EOF/kill masquerading as rollback.
            ws.close(1011, 'Shell unavailable');
            desktopFault('terminal-shell', 'partial-acquisition-unresolved');
            console.error('[Terminal] Session acquisition unresolved:', {sessionId});
        }
    }

    public static stopAdmission(): void {
        this.accepting = false;
        this.service.stopAdmission();
        // Keep sockets open for accepted command output until real shell close.
    }

    public static closeDesktop(): Promise<void> {
        if (this.closeTask) return this.closeTask;
        this.closeTask = (async () => {
            if (this.accepting) throw new Error('TERMINAL_GATEWAY_ADMISSION_OPEN');
            await this.service.settleDesktop(); // unknown tree blocks, never hidden
            const server = this.wss;
            if (!server) return;
            for (const ws of server.clients) ws.close(1001, 'Server stopping');
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            this.wss = null;
        })();
        const current = this.closeTask;
        void current.catch(() => { if (this.closeTask === current) this.closeTask = null; });
        return current;
    }
}
