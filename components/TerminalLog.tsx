import React, { useEffect, useRef, useState } from 'react';
import { systemBus } from '../services/systemBus';
import { INFORMATIVE_PROTOCOLS } from '../constants';
import { InteractiveTerminal } from './Terminal/InteractiveTerminal';
import { Terminal, ScrollText } from 'lucide-react';

interface TerminalLogProps {
  logs?: string[];
}

const MAX_LOGS = 200;

const TerminalLog: React.FC<TerminalLogProps> = ({ logs: externalLogs = [] }) => {
  const endRef = useRef<HTMLDivElement>(null);
  const [internalLogs, setInternalLogs] = useState<string[]>([]);
  const [mode, setMode] = useState<'LOGS' | 'SHELL'>('SHELL'); // Default to Shell for visibility of new feature

  const allLogs = [...externalLogs, ...internalLogs].slice(-MAX_LOGS);

  useEffect(() => {
    const unsubscribers = INFORMATIVE_PROTOCOLS.map(protocol => {
      return systemBus.subscribe(protocol as any, (event) => {
        const logEntry = `[${protocol.replace('PROTOCOL_', '')}] ${JSON.stringify(event.payload || {}).substring(0, 100)}`;
        setInternalLogs(prev => [...prev.slice(-MAX_LOGS + 1), logEntry]);
      });
    });

    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  useEffect(() => {
    if (mode === 'LOGS') {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allLogs.length, mode]);

  return (
    <div className="h-[calc(100vh-2rem)] glass-panel rounded-xl flex flex-col font-mono text-sm overflow-hidden border border-slate-800">
      {/* Header / Tabs */}
      <div className="bg-slate-950 p-2 border-b border-slate-700 flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
          </div>

          <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
            <button
              onClick={() => setMode('SHELL')}
              className={`flex items-center gap-2 px-3 py-1 rounded text-xs transition-colors ${mode === 'SHELL' ? 'bg-slate-800 text-green-400 font-bold shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Terminal size={12} />
              INTERACTIVE SHELL
            </button>
            <button
              onClick={() => setMode('LOGS')}
              className={`flex items-center gap-2 px-3 py-1 rounded text-xs transition-colors ${mode === 'LOGS' ? 'bg-slate-800 text-cyan-400 font-bold shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <ScrollText size={12} />
              SYSTEM LOGS
            </button>
          </div>
        </div>
        <div className="text-xs text-slate-500">
          {mode === 'LOGS' ? `${allLogs.length} entries` : 'Connected via WebSocket'}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 bg-black overflow-hidden relative">
        {mode === 'LOGS' ? (
          <div className="h-full overflow-y-auto p-4 space-y-1 custom-scrollbar">
            {allLogs.map((log, i) => (
              <div key={i} className="break-all border-l-2 border-transparent hover:border-slate-800 pl-2">
                <span className="text-slate-600 select-none mr-2 text-[10px]">{new Date().toLocaleTimeString()}</span>
                <span className={
                  log.includes('[ERROR]') ? 'text-red-500' :
                    log.includes('[INTROSPECTION]') ? 'text-purple-400' :
                      log.includes('[SYSTEM]') ? 'text-cyan-400' :
                        log.includes('[WORKFLOW]') ? 'text-amber-400' :
                          'text-green-400'
                }>{log}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        ) : (
          <div className="h-full w-full p-2">
            <InteractiveTerminal />
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalLog;