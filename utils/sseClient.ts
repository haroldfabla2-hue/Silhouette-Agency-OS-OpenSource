/**
 * Fetch-based SSE client.
 *
 * Replaces EventSource so that SSE connections authenticate with the same
 * Authorization Bearer token / x-session-id headers as every other API call,
 * instead of placing the API key in the URL query string (which lands in
 * reverse-proxy access logs and browser history). The server never accepted
 * ?apiKey= anyway (verified: query-only requests get 401), so the old URLs
 * leaked a secret for zero benefit.
 */

import { API_BASE_URL, getAuthHeaders } from './api';

export interface SseEvent {
    data: string;
}

export interface SseHandlers {
    onMessage: (event: SseEvent) => void;
    onOpen?: () => void;
    onError?: (error: Error) => void;
}

export interface SseOptions {
    /** Auto-reconnect with exponential backoff (default: true). */
    reconnect?: boolean;
    initialDelayMs?: number;
    maxDelayMs?: number;
}

export interface SseConnection {
    close: () => void;
}

/**
 * Incremental SSE frame parser. Feed decoded text chunks; each complete
 * event's data payload is emitted via the callback. Exported for tests.
 */
export function createSseParser(onEvent: (data: string) => void): (chunk: string) => void {
    let buffer = '';
    return (chunk: string) => {
        buffer += chunk;
        // Frames are separated by a blank line (\n\n or \r\n\r\n)
        while (true) {
            const rn = buffer.indexOf('\r\n\r\n');
            const n = buffer.indexOf('\n\n');
            let sepIndex: number, sepLen: number;
            if (rn !== -1 && (n === -1 || rn <= n)) { sepIndex = rn; sepLen = 4; }
            else if (n !== -1) { sepIndex = n; sepLen = 2; }
            else break;
            const frame = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + sepLen);
            const dataLines: string[] = [];
            for (const line of frame.split(/\r?\n/)) {
                if (line.startsWith(':')) continue; // heartbeat / comment
                if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).replace(/^ /, ''));
                }
                // event:/id:/retry: fields are unused by current consumers
            }
            if (dataLines.length > 0) onEvent(dataLines.join('\n'));
        }
    };
}

/**
 * Connect to an SSE endpoint with authenticated fetch. Reconnects with
 * exponential backoff unless options.reconnect === false. Call close() to stop.
 */
export function connectSSE(path: string, handlers: SseHandlers, options: SseOptions = {}): SseConnection {
    const { reconnect = true, initialDelayMs = 1000, maxDelayMs = 30000 } = options;
    let closed = false;
    let abort: AbortController | null = null;
    let delay = initialDelayMs;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
        if (closed || !reconnect) return;
        timer = setTimeout(() => {
            delay = Math.min(delay * 2, maxDelayMs);
            void connect();
        }, delay);
    };

    const connect = async () => {
        if (closed) return;
        abort = new AbortController();
        try {
            const res = await fetch(`${API_BASE_URL}${path}`, {
                headers: { ...getAuthHeaders(), 'Accept': 'text/event-stream' },
                signal: abort.signal,
            });
            if (!res.ok || !res.body) {
                throw new Error(`SSE HTTP ${res.status}`);
            }
            delay = initialDelayMs; // reset backoff on successful connection
            handlers.onOpen?.();
            const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
            const push = createSseParser((data) => handlers.onMessage({ data }));
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) push(value);
            }
            if (!closed) {
                handlers.onError?.(new Error('SSE stream ended'));
                scheduleReconnect();
            }
        } catch (err: any) {
            if (closed || err?.name === 'AbortError') return;
            handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
            scheduleReconnect();
        }
    };

    void connect();

    return {
        close: () => {
            closed = true;
            if (timer) clearTimeout(timer);
            abort?.abort();
        },
    };
}
