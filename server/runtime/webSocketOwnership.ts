import { WebSocketServer, WebSocket } from 'ws';
import type { ResourceScope } from './resourceScope';

/** ws8.19.0 pinned close callback waits for its clients. Never closes borrowed HTTP. */
export function ownWebSocketServer(scope: ResourceScope, server: WebSocketServer, name: string): void {
    let closing: Promise<void> | undefined;
    const beginClose = () => {
        if (!closing) {
            closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            // stopIntake initiates but does not wait for live clients before drain.
            void closing.catch(() => undefined);
        }
        return closing;
    };
    const onError = (error: Error) => scope.recordFailure(`${name}:server`, error);
    server.on('error', onError);
    scope.own({
        name,
        closeRank: -100,
        stopIntake: () => { void beginClose(); },
        close: async () => { await beginClose(); server.off('error', onError); },
    });
}

/** Retains pre-auth sockets too. Graceful close completion is the actual close
 * event. A root timeout is FAIL/UNVERIFIED, not a fabricated close receipt. */
export function ownWebSocket(scope: ResourceScope, socket: WebSocket, name: string, stopMessages: () => void): () => Promise<void> {
    let resolveClosed!: () => void;
    const closed = socket.readyState === WebSocket.CLOSED ? Promise.resolve() : new Promise<void>(resolve => { resolveClosed = resolve; });
    let release: () => Promise<void> = async () => undefined;
    if (socket.readyState !== WebSocket.CLOSED) socket.once('close', () => { resolveClosed(); void release(); });
    release = scope.own({
        name,
        stopIntake: stopMessages,
        close: async () => {
            stopMessages();
            if (socket.readyState !== WebSocket.CLOSED) socket.close(1001, 'Server shutting down');
            await closed;
        },
    });
    return release;
}
