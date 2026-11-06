import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { TerminalService } from '../../services/system/terminalService';
import { v4 as uuidv4 } from 'uuid';

export class TerminalGateway {
    private static wss: WebSocketServer;
    private static service = TerminalService.getInstance();
    private static readonly PATH = '/api/terminal/ws';

    public static initialize(_server?: Server, path: string = TerminalGateway.PATH) {
        this.wss = new WebSocketServer({
            noServer: true
        });

        console.log(`[Terminal] 🚀 WebSocket Endpoint initialized on ${path}`);

        this.wss.on('connection', (ws, req) => {
            // [SECURITY] Message Token Auth
            const url = new URL(req.url || '', 'http://localhost');
            const token = url.searchParams.get('token');
            const expectedToken = process.env.SILHOUETTE_API_KEY;

            if (expectedToken && token !== expectedToken) {
                console.warn(`[Terminal] 🛑 Auth failed: Invalid token from ${req.socket.remoteAddress}`);
                ws.close(3000, 'Unauthorized');
                return;
            }

            this.handleConnection(ws);
        });
    }

    public static canHandle(pathname: string): boolean {
        return pathname === this.PATH;
    }

    public static handleUpgrade(req: any, socket: any, head: any): boolean {
        if (!this.wss) {
            socket.destroy();
            return false;
        }

        const pathname = new URL(req.url || '', 'http://localhost').pathname;
        if (!this.canHandle(pathname)) {
            return false;
        }

        this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.wss.emit('connection', ws, req);
        });

        return true;
    }

    private static handleConnection(ws: WebSocket) {
        const sessionId = uuidv4();
        console.log(`[Terminal] New session: ${sessionId}`);

        // Create backend shell process
        this.service.createSession(sessionId);

        // Forward stdout/stderr to WebSocket
        const dataHandler = (id: string, data: string) => {
            if (id === sessionId && ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        };

        const closeHandler = (id: string) => {
            if (id === sessionId) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            }
        };

        this.service.on('data', dataHandler);
        this.service.on('close', closeHandler);

        // Handle messages from Client (xterm)
        ws.on('message', (message) => {
            try {
                const msgString = message.toString();
                this.service.write(sessionId, msgString);
            } catch (err) {
                console.error(`[Terminal] Error processing message:`, err);
            }
        });

        ws.on('close', () => {
            console.log(`[Terminal] Closed: ${sessionId}`);
            this.service.removeListener('data', dataHandler);
            this.service.removeListener('close', closeHandler);
            this.service.kill(sessionId);
        });
    }
}
