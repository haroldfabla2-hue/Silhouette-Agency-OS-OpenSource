import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

interface TerminalViewProps {
    height?: string;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ height = '200px' }) => {
    const [logs, setLogs] = useState<string[]>(['> Genesis Factory Terminal Initialized...', '> Waiting for commands...']);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const unsubscribe = systemBus.subscribe(SystemProtocol.GENESIS_UPDATE, (event) => {
            if (event.payload.log) {
                setLogs(prev => [...prev, `> ${event.payload.log}`]);
            }
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="bg-black border border-slate-800 rounded-lg p-4 font-mono text-xs text-green-400 overflow-hidden flex flex-col" style={{ height }}>
            <div className="flex items-center gap-2 text-slate-500 mb-2 border-b border-slate-900 pb-2">
                <Terminal size={12} />
                <span>GENESIS_LOG_STREAM</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                {logs.map((log, i) => (
                    <div key={i} className="break-all opacity-90 hover:opacity-100 transition-opacity">
                        {log}
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
};
