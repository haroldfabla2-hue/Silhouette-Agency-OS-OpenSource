import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { TerminalService } from '../../services/system/terminalService';
import { v4 as uuidv4 } from 'uuid';

export class TerminalGateway {
    private static wss: WebSocketServer;
    private static service = TerminalService.getInstance();

    public static initialize(server: Server, path: string = '/api/terminal/ws') {
        this.wss = new WebSocketServer({
            server,
            path
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
