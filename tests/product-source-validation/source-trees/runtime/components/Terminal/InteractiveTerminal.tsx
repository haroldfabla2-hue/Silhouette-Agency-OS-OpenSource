import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface InteractiveTerminalProps {
    sessionId?: string;
    onClose?: () => void;
}

export const InteractiveTerminal: React.FC<InteractiveTerminalProps> = ({ sessionId, onClose }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const termRef = useRef<Terminal | null>(null);

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

        let wsUrl = `${wsProtocol}//${wsHost}/api/terminal/ws?token=${apiKey}`;

        // Fallback for same-origin if no env var
        if (!backendUrl && window.location.port !== '5173') {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${proto}//${window.location.host}/api/terminal/ws?token=${apiKey}`;
        }

        console.log(`[TerminalUI] Connecting to ${wsUrl}`);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            term.writeln('\x1b[1;32m> Connected to Silhouette Terminal Gateway\x1b[0m');
            term.writeln('\x1b[1;30m> Session: ' + (sessionId || 'New') + '\x1b[0m');
            term.write('\r\n');
        };

        ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                term.write(event.data);
            }
        };

        ws.onclose = () => {
            term.writeln('\r\n\x1b[1;31m> Connection Closed\x1b[0m');
        };

        ws.onerror = (err) => {
            console.error('[TerminalUI] WebSocket Error:', err);
            term.writeln('\r\n\x1b[1;31m> Connection Error\x1b[0m');
        };

        // Send input to backend
        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });

        return () => {
            window.removeEventListener('resize', handleResize);
            ws.close();
            term.dispose();
        };
    }, [sessionId]);

    return (
        <div
            className="w-full h-full bg-slate-950 rounded-lg overflow-hidden border border-slate-800 shadow-xl"
            style={{ minHeight: '300px' }}
        >
            <div className="h-full w-full p-2" ref={terminalRef} />
        </div>
    );
};
