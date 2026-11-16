import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { TerminalService } from '../../services/system/terminalService';
import { ResourceScope } from '../runtime/resourceScope';
import { ownWebSocket, ownWebSocketServer } from '../runtime/webSocketOwnership';
import { v4 as uuidv4 } from 'uuid';

export class TerminalGateway {
    private static wss?: WebSocketServer;
    private static readonly service = TerminalService.getInstance();
    private static readonly operations = new ResourceScope('terminal-gateway');
    public static getLifecycleStatus() { return { failures: this.operations.getFailures(), diagnostics: this.operations.getDiagnostics() }; }
    public static shutdown() { return this.operations.close(); }
    public static initialize(server: Server, path: string = '/api/terminal/ws'): void {
        this.operations.assertAccepting();
        if (this.wss) throw new Error('TerminalGateway already initialized');
        const wss = new WebSocketServer({ server, path });
        this.wss = wss;
        ownWebSocketServer(this.operations, wss, 'terminal-websocket-server');
        const onConnection = (ws: WebSocket, req: import('http').IncomingMessage) => {
            try { this.handleConnection(ws, req); }
            catch (error) { this.operations.recordFailure('terminal-connection-setup', error); ws.close(1011, 'Terminal unavailable'); }
        };
        wss.on('connection', onConnection);
        this.operations.own({ name: 'terminal-connection-hook', closeRank: -200, close: () => { wss.off('connection', onConnection); } });
    }
    private static handleConnection(ws: WebSocket, req: import('http').IncomingMessage): void {
        let sessionId: string | undefined;
        let releaseSession: () => Promise<void> = async () => undefined;
        let dataHandler: ((id: string, data: string) => void) | undefined;
        let closeHandler: ((id: string) => void) | undefined;
        const onMessage = (message: import('ws').RawData) => {
            if (!this.operations.accepting || !sessionId) return;
            void this.operations.run('terminal-input', () => this.service.write(sessionId!, message.toString())).catch(() => undefined);
        };
        const stopMessages = () => ws.off('message', onMessage);
        const cleanup = () => {
            stopMessages();
            if (dataHandler) this.service.off('data', dataHandler);
            if (closeHandler) this.service.off('close', closeHandler);
        };
        const onError = (error: Error) => this.operations.recordDiagnostic('terminal-websocket', error, 'OPERATION_REJECTED', 'UNAVAILABLE');
        ws.on('error', onError);
        ownWebSocket(this.operations, ws, 'terminal-client', stopMessages);
        ws.once('close', () => {
            cleanup();
            ws.off('error', onError);
            void releaseSession();
        });
        if (!this.operations.accepting) { ws.close(1001, 'Server shutting down'); return; }
        // Same source authentication rule, before any shell acquisition.
        const url = new URL(req.url || '', 'http://localhost');
        const token = url.searchParams.get('token');
        const expectedToken = process.env.SILHOUETTE_API_KEY;
        if (expectedToken && token !== expectedToken) { ws.close(3000, 'Unauthorized'); return; }
        sessionId = uuidv4();
        this.service.createSession(sessionId);
        const ownedSession = sessionId;
        let killTask: Promise<void> | undefined;
        const stopSession = () => { if (!killTask) killTask = this.service.kill(ownedSession); return killTask; };
        releaseSession = this.operations.own({
            name: `terminal-session:${ownedSession}`,
            stopIntake: () => {
                stopMessages();
                // Termination starts before drain so blocked stdin callbacks can settle.
                void stopSession().catch(error => this.operations.recordFailure('terminal-session-stop', error));
            },
            close: async () => { cleanup(); await stopSession(); },
        });
        dataHandler = (id, data) => {
            if (this.operations.accepting && id === ownedSession && ws.readyState === WebSocket.OPEN) {
                void this.operations.run('terminal-output', () => new Promise<void>((resolve, reject) => {
                    ws.send(data, error => error ? reject(error) : resolve());
                })).catch(() => undefined);
            }
        };
        closeHandler = id => { if (id === ownedSession && ws.readyState === WebSocket.OPEN) ws.close(); };
        this.service.on('data', dataHandler);
        this.service.on('close', closeHandler);
        ws.on('message', onMessage);
    }
}
