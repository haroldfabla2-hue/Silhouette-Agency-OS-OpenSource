import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { TerminalService } from '../../services/system/terminalService';
import { v4 as uuidv4 } from 'uuid';

interface AcceptedTerminalSocket {
    ws: WebSocket;
    closed: Promise<void>;
    settleClosed: () => void;
    sessionId?: string;
    shellClosed?: Promise<void>;
    detach?: () => void;
    stopFailures: unknown[];
}

export class TerminalGateway {
    private static wss?: WebSocketServer;
    private static service = TerminalService.getInstance();
    private static sealed = false;
    private static accepted = new Set<AcceptedTerminalSocket>();
    private static closing?: Promise<void>;

    public static initialize(server: Server, path: string = '/api/terminal/ws') {
        if (this.sealed || this.wss) throw new Error('Terminal gateway already initialized or sealed');
        const wss = new WebSocketServer({ server, path });
        this.wss = wss;
        wss.on('connection', (ws, req) => {
            // Own every accepted socket before auth, URL parsing or shell startup.
            let settleClosed!: () => void;
            const closed = new Promise<void>(resolve => { settleClosed = resolve; });
            const record: AcceptedTerminalSocket = { ws, closed, settleClosed, stopFailures: [] };
            this.accepted.add(record);
            ws.once('close', () => {
                // Keep error/data subscriptions until the exact shell closes.
                // This callback is not allowed to delete the shell obligation.
                record.settleClosed();
                try { if (record.sessionId) this.service.kill(record.sessionId); }
                catch (error) { record.stopFailures.push(error); }
                void this.releaseClosedRecord(record).catch(error => {
                    // Retained in accepted, never converted into successful close.
                    console.error('[Terminal] Direct-session closure incomplete:', error);
                });
            });
            // A socket error is not a close receipt. Request closure and keep ownership.
            ws.on('error', error => { console.error('[Terminal] Socket error:', error); ws.close(1011, 'Terminal transport error'); });
            if (this.sealed) { ws.close(1001, 'Terminal gateway stopping'); return; }
            try {
                const token = new URL(req.url || '', 'http://localhost').searchParams.get('token');
                const expectedToken = process.env.SILHOUETTE_API_KEY;
                if (expectedToken && token !== expectedToken) { ws.close(3000, 'Unauthorized'); return; }
                this.handleConnection(record);
            } catch (error) {
                console.error('[Terminal] Session startup failed:', error);
                ws.close(1011, 'Terminal startup error');
            }
        });
    }

    private static async releaseClosedRecord(record: AcceptedTerminalSocket): Promise<void> {
        await record.closed;
        await record.shellClosed;
        record.detach?.();
        if (record.stopFailures.length) throw new AggregateError(record.stopFailures, 'Terminal stop request failed');
        this.accepted.delete(record);
    }

    private static handleConnection(record: AcceptedTerminalSocket) {
        const { ws } = record;
        const sessionId = uuidv4();
        record.sessionId = sessionId;
        const dataHandler = (id: string, data: string) => {
            if (id === sessionId && !this.sealed && ws.readyState === WebSocket.OPEN) ws.send(data);
        };
        const closeHandler = (id: string) => {
            if (id === sessionId && ws.readyState === WebSocket.OPEN) ws.close();
        };
        const errorHandler = (id: string, error: unknown) => {
            if (id !== sessionId) return;
            console.error('[Terminal] Shell error:', error);
            if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Terminal process error');
        };
        this.service.on('data', dataHandler);
        this.service.on('close', closeHandler);
        this.service.on('error', errorHandler);
        record.detach = () => {
            this.service.off('data', dataHandler);
            this.service.off('close', closeHandler);
            this.service.off('error', errorHandler);
        };
        // Subscribe before actual spawn can emit its asynchronous error/close.
        this.service.createSession(sessionId);
        record.shellClosed = this.service.sessionClosed(sessionId);
        ws.on('message', message => {
            if (this.sealed || ws.readyState !== WebSocket.OPEN) return;
            try { this.service.write(sessionId, message.toString()); }
            catch (error) { console.error('[Terminal] Error processing message:', error); }
        });
    }

    /** Synchronously seals admission; joins accepted sockets and direct shells.
     * This is NOT descendant-tree/global quiescence or lifecycle root integration.
     * An external owner must bound the wait and retain failures.
     */
    public static sealAndCloseDirectSessions(): Promise<void> {
        this.sealed = true;
        if (this.closing) return this.closing;
        // Publish exact join before any original WSS/socket stop callback runs.
        this.closing = Promise.resolve().then(async () => {
            const serverClosed = this.wss ? new Promise<void>((resolve, reject) => {
                this.wss!.close(error => { if (error) reject(error); else resolve(); });
            }) : Promise.resolve();
            const stops: Promise<unknown>[] = [serverClosed];
            for (const record of this.accepted) {
                // Keep stopping independent records if one stop request throws.
                stops.push(Promise.resolve().then(() => {
                    try { if (record.sessionId) this.service.kill(record.sessionId); }
                    catch (error) { record.stopFailures.push(error); throw error; }
                    finally { record.ws.close(1001, 'Terminal gateway stopping'); }
                }));
            }
            const stopped = await Promise.allSettled(stops);
            // WSS close alone is not proof shells are gone. Retain original joins.
            const joined = await Promise.allSettled([...this.accepted].map(record => this.releaseClosedRecord(record)));
            const failures = [...stopped, ...joined].flatMap(result => result.status === 'rejected' ? [result.reason] : []);
            if (failures.length) throw new AggregateError(failures, 'Terminal direct-session closure incomplete');
        });
        return this.closing;
    }
}
