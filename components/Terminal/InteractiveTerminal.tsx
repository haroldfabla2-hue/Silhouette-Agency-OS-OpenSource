import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export interface TerminalVolatileState {
    resume: string | null;
    unsent: string;
    pending: {id: string; text: string; result: 'pending' | 'unknown' | 'stdin-callback'} | null;
    sequence: number;
    prefix: string;
}

interface InteractiveTerminalProps {
    volatileOwner?: React.MutableRefObject<TerminalVolatileState>;
    sessionId?: string;
    onClose?: () => void;
}

export const InteractiveTerminal: React.FC<InteractiveTerminalProps> = ({ sessionId, onClose, volatileOwner }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const termRef = useRef<Terminal | null>(null);
    // Volatile capability only. Never persisted, logged, or shown as terminal text.
    const fallbackOwner = useRef<TerminalVolatileState>({resume: null, unsent: '', pending: null, sequence: 0, prefix: crypto.randomUUID()});
    const owner = volatileOwner ?? fallbackOwner;
    const [showUnsent, setShowUnsent] = useState(false);
    const [draftVersion, setDraftVersion] = useState(0);
    const sendReviewedRef = useRef<() => void>(() => {});
    const observerRef = useRef<WebSocket | null>(null);
    const observeRef = useRef<(type: 'status' | 'cancel' | 'preserve-disconnect') => void>(() => {});
    const exportRef = useRef<{chunks: ArrayBuffer[]; offset: number; limit: number} | null>(null);
    const sendControlRef = useRef<(frame: object) => boolean>(() => false);
    const [connectionAttempt, setConnectionAttempt] = useState(0);
    const [status, setStatus] = useState('Connecting');
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (!terminalRef.current) return;

        // Initialize xterm.js
        const term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#0f172a', // matches slate-900/black mix
                foreground: '#22c55e', // green-500
            },
            fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: 14,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(terminalRef.current);
        fitAddon.fit();
        termRef.current = term;

        // Adjust fit on resize
        const handleResize = () => fitAddon.fit();
        window.addEventListener('resize', handleResize);

        // Connect to WebSocket
        const apiKey = import.meta.env.VITE_SILHOUETTE_API_KEY || '';
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3005';

        // Derive WS URL from backend URL
        const wsProtocol = backendUrl.startsWith('https') ? 'wss:' : 'ws:';
        const wsHost = backendUrl.replace(/^https?:\/\//, '');

        let wsUrl = `${wsProtocol}//${wsHost}/api/terminal/ws?protocol=v2&token=${apiKey}`;

        // Fallback for same-origin if no env var
        if (!backendUrl && window.location.port !== '5173') {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${proto}//${window.location.host}/api/terminal/ws?protocol=v2&token=${apiKey}`;
        }

        // Never log authenticated URLs or terminal contents.
        const decoder = new TextDecoder();
        let nextOutput = 0;
        let inputDisabled = false;
        // The owner lives above the SHELL/LOGS conditional. Unsent suffix and
        // uncertain prefix survive effect cleanup/remount, not app reload/crash.
        const state = owner.current;
        let inputAllowed = !state.pending && !state.unsent;
        let controlPending = false;
        const ws = new WebSocket(wsUrl, state.resume ? ['silhouette-v2', `resume.${state.resume}`] : ['silhouette-v2']);
        wsRef.current = ws;
        const pumpInput = () => {
            if (!inputAllowed || inputDisabled || state.pending || !state.unsent || ws.readyState !== WebSocket.OPEN) return;
            let end = Math.min(8192, state.unsent.length);
            if (end < state.unsent.length && /[\uD800-\uDBFF]/.test(state.unsent[end - 1])) end--;
            const input: NonNullable<TerminalVolatileState['pending']> = {id: `${state.prefix}:${++state.sequence}`, text: state.unsent.slice(0, end), result: 'pending'};
            state.pending = input;
            state.unsent = state.unsent.slice(end);
            try { ws.send(JSON.stringify({type: 'input', clientInputId: input.id, data: input.text})); }
            catch { inputDisabled = true; input.result = 'unknown'; setStatus('Input send uncertain. Prefix retained separately; no replay.'); }
        };
        sendReviewedRef.current = () => {
            if (state.pending) { setStatus('Uncertain sent prefix must not be replayed. Query status or cancel; unsent suffix retained.'); return; }
            inputDisabled = false; term.options.disableStdin = false;
            inputAllowed = true; pumpInput();
        };
        sendControlRef.current = frame => {
            const requestType = (frame as {type?: string}).type;
            if ((controlPending && requestType !== 'status' && requestType !== 'cancel' && requestType !== 'preserve-disconnect') || ws.readyState !== WebSocket.OPEN) {
                setStatus('Control not sent: another control is pending or connection is closed.'); return false;
            }
            controlPending = true;
            try { ws.send(JSON.stringify(frame)); return true; }
            catch { controlPending = false; setStatus('Control send failed. Query state on reconnect; no automatic action retry.'); return false; }
        };

        const receiveStatus = (frame: any) => {
            if (state.pending && frame.lastInput?.clientInputId === state.pending.id) {
                state.pending.result = frame.lastInput.result === 'stdin-callback' ? 'stdin-callback' : 'unknown';
            }
            setDraftVersion(value => value + 1);
            setStatus(`Private output: ${frame.retainedBytes}/${frame.quotaBytes} bytes${frame.outputPaused ? ', quota full, child output backpressured' : ''}. Disconnect: ${frame.disconnectPolicy}. Cancellation: ${frame.cancellation}, attempts: ${frame.cancelAttempts}, pending: ${frame.cancelInFlight}, last: ${frame.lastCancel?.kind || 'none'} (${frame.lastCancel?.scope || 'none'}). Input sequence: ${frame.lastInput?.sequence ?? 'none'}, receipt: ${frame.lastInput?.result ?? 'none'}.`);
        };
        observeRef.current = type => {
            const existing = observerRef.current;
            if (existing?.readyState === WebSocket.OPEN) {
                // Only this explicit click can send cancel or preservation.
                existing.send(JSON.stringify({type})); return;
            }
            if (type !== 'status') { setStatus('Open recovery status channel first. No action sent.'); return; }
            if (!state.resume || existing?.readyState === WebSocket.CONNECTING) return;
            const observer = new WebSocket(wsUrl, ['silhouette-v2', `resume.${state.resume}`, 'control-only']);
            observerRef.current = observer;
            observer.onopen = () => observer.send(JSON.stringify({type: 'status'}));
            observer.onmessage = event => {
                try {
                    const frame = JSON.parse(event.data);
                    if (frame.type === 'status' || frame.type === 'ready' || frame.type === 'cancel-registered' || frame.type === 'preserve-ready') receiveStatus(frame);
                } catch { setStatus('Recovery status protocol error. No action retried.'); }
            };
            observer.onclose = () => { if (observerRef.current === observer) observerRef.current = null; };
            observer.onerror = () => setStatus('Recovery channel unavailable. Prior effects remain owned; no result inferred.');
        };

        ws.onopen = () => {
            setConnected(true);
            term.writeln('\x1b[1;32m> Connected to Silhouette Terminal Gateway\x1b[0m');
            term.writeln('\x1b[1;30m> Session: ' + (sessionId || 'New') + '\x1b[0m');
            term.write('\r\n');
        };

        ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const frame = JSON.parse(event.data);
                    if (['status', 'preserve-ready', 'cancel-registered', 'retained', 'control-error'].includes(frame.type)) controlPending = false;
                    if (frame.type === 'input-result') {
                        if (state.pending?.id === frame.clientInputId) {
                            state.pending = null;
                            pumpInput();
                        }
                    } else if (frame.type === 'request-unknown') {
                        if (frame.lane === 'input') { inputDisabled = true; term.options.disableStdin = true; }
                        else { controlPending = false; exportRef.current = null; }
                        setStatus('Request or response uncertain. Query status, do not replay input or cancellation by silence.');
                    } else if (frame.type === 'ready') {
                        state.resume = frame.resume;
                        setStatus(`Private output: ${frame.retainedBytes}/${frame.quotaBytes} bytes. Disconnect policy: ${frame.disconnectPolicy}.`);
                        nextOutput = frame.retainedBytes; // older output stays private, explicit export below
                    } else if (frame.type === 'output') {
                        const bytes = Uint8Array.from(atob(frame.base64), c => c.charCodeAt(0));
                        if (frame.offset !== nextOutput) term.writeln('\r\nOutput gap. Export retained output for original bytes.');
                        term.write(decoder.decode(bytes, {stream: true}));
                        nextOutput = frame.offset + bytes.length;
                    } else if (frame.type === 'preserve-ready') {
                        setStatus('Preserved in server memory. Keep this panel to reconnect. No crash persistence.');
                        ws.close();
                    } else if (frame.type === 'cancel-registered') {
                        setStatus(`Cancellation registered, not completed. Pending: ${frame.cancelInFlight}. Query status for outcome. Descendants not verified.`);
                    } else if (frame.type === 'shell-closed') {
                        setStatus('Shell closed. Output retained. Descendants not verified.');
                    } else if (frame.type === 'status') {
                        receiveStatus(frame);
                    } else if (frame.type === 'retained' && exportRef.current) {
                        const task = exportRef.current;
                        if (frame.offset !== task.offset) throw new Error('Export offset mismatch');
                        if (task.limit < 0) task.limit = frame.retainedBytes; // snapshot, not endless follow
                        const bytes = Uint8Array.from(atob(frame.base64), c => c.charCodeAt(0)).slice(0, task.limit - task.offset);
                        task.chunks.push(new Uint8Array(bytes).buffer); task.offset += bytes.length;
                        if (task.offset < task.limit && bytes.length) {
                            sendControlRef.current({type: 'read-retained', offset: task.offset});
                        } else {
                            const blob = new Blob(task.chunks, {type: 'application/octet-stream'});
                            const link = document.createElement('a');
                            const objectUrl = URL.createObjectURL(blob);
                            link.href = objectUrl; link.download = 'terminal-private-output.bin';
                            link.click(); URL.revokeObjectURL(objectUrl);
                            exportRef.current = null;
                            setStatus('Private export requested. Original bytes remain in server memory. Browser save not verified.');
                        }
                    } else if (frame.type === 'input-rejected') {
                        if (state.pending?.id === frame.clientInputId) {
                            if (frame.admitted === false) {
                                // Positively not admitted, restore for review,
                                // not automatic retry. Unknown stays separate.
                                state.unsent = state.pending.text + state.unsent;
                                state.pending = null;
                            } else state.pending.result = 'unknown';
                        }
                        inputDisabled = true; term.options.disableStdin = true;
                        setDraftVersion(value => value + 1);
                        setStatus('Input not admitted or result uncertain. Input paused to avoid joining incomplete fragments. No automatic retry. Export/cancel remain available.');
                    } else if (frame.type === 'control-error') {
                        exportRef.current = null; setStatus('Control request failed. Retained output unchanged.');
                    }
                } catch { exportRef.current = null; setStatus('Protocol error. Retained output unchanged.'); }
            }
        };

        ws.onclose = () => {
            setConnected(false); exportRef.current = null;
            if (state.pending?.result === 'pending') state.pending.result = 'unknown';
            setDraftVersion(value => value + 1);
            term.writeln('\r\n\x1b[1;31m> Connection Closed\x1b[0m');
        };

        ws.onerror = (err) => {
            setStatus('Connection error. Cancellation/preservation receipt may be unknown.');
            term.writeln('\r\n\x1b[1;31m> Connection Error\x1b[0m');
        };

        // Send input to backend
        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN && !inputDisabled) {
                state.unsent += data;
                setDraftVersion(value => value + 1);
                pumpInput();
            }
        });

        return () => {
            window.removeEventListener('resize', handleResize);
            // Server keeps native disconnect-cancel unless Preserve was
            // explicitly acknowledged. No automatic EOF or replayed input.
            sendControlRef.current = () => false;
            sendReviewedRef.current = () => {};
            observeRef.current = () => {};
            observerRef.current?.close(); observerRef.current = null;
            if (state.pending?.result === 'pending') state.pending.result = 'unknown';
            // Leave unsent suffix and uncertain prefix with the parent owner.
            // They are never moved to a different session or replayed on mount.
            ws.close();
            term.dispose();
        };
    }, [sessionId, connectionAttempt]);

    return (
        <div
            className="w-full h-full flex flex-col bg-slate-950 rounded-lg overflow-hidden border border-slate-800 shadow-xl"
            style={{ minHeight: '300px' }}
        >
            <div className="p-2 text-xs text-slate-300">
                <p>{status}</p>
                <p>Private memory quota: 4 MiB per session, 4 sessions. Full quota pauses output. Export does not free it. No crash persistence. SHELL/LOGS remount keeps local draft while its owner is mounted. Reload/crash loses it. No automatic replay.</p>
                <button disabled={!connected} onClick={() => sendControlRef.current({type: 'cancel'})}>Cancel work</button>{' '}
                <button disabled={!connected} onClick={() => sendControlRef.current({type: 'preserve-disconnect'})}>Preserve and disconnect</button>{' '}
                <button disabled={connected || !owner.current.resume} onClick={() => setConnectionAttempt(value => value + 1)}>Reconnect preserved session</button>{' '}
                <button disabled={!connected} onClick={() => {
                    if (exportRef.current) return;
                    exportRef.current = {chunks: [], offset: 0, limit: -1};
                    if (!sendControlRef.current({type: 'read-retained', offset: 0})) exportRef.current = null;
                }}>Export private output</button>{' '}
                <button disabled={!connected} onClick={() => sendControlRef.current({type: 'status'})}>Session status</button>{' '}
                <button disabled={!owner.current.resume} onClick={() => observeRef.current('status')}>Recovery status channel</button>{' '}
                <button disabled={!owner.current.resume} onClick={() => observeRef.current('cancel')}>Cancel through recovery channel</button>{' '}
                <button onClick={() => setShowUnsent(value => !value)}>Review local unsent input</button>
                <p>{owner.current.unsent.length} UTF16 units not sent; prefix: {owner.current.pending ? `${owner.current.pending.id}, ${owner.current.pending.text.length} units, ${owner.current.pending.result}` : 'none pending'}. Callback means stdin only, not command success.</p>
                {showUnsent && <div>
                    <textarea readOnly aria-label="Local input not sent to the shell" value={owner.current.unsent} className="w-full bg-slate-900 text-slate-200" />
                    <button disabled={!connected || !!owner.current.pending} onClick={() => sendReviewedRef.current()}>Send reviewed unsent suffix</button>
                    {owner.current.pending?.result === 'stdin-callback' && <button onClick={() => {
                        // Only reconcile a positively matched callback receipt.
                        // Do not send the prefix or automatically send suffix.
                        owner.current.pending = null; setDraftVersion(value => value + 1);
                    }}>Acknowledge matched stdin receipt, keep suffix unsent</button>}
                </div>}
            </div>
            <div className="flex-1 min-h-0 w-full p-2" ref={terminalRef} />
        </div>
    );
};
