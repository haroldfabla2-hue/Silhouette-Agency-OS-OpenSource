
import React, { useEffect, useState } from 'react';
import { ProtocolEvent, SystemProtocol } from '../types';
import { systemBus } from '../services/systemBus';
import { Activity, Zap, Shield, RefreshCw, Box, Layers, ArrowRightLeft, AlertTriangle } from 'lucide-react';

const ProtocolOverlay: React.FC = () => {
    // Stack of active events
    const [events, setEvents] = useState<ProtocolEvent[]>([]);

    useEffect(() => {
        // [OPTIMIZATION] Only subscribe to IMPORTANT protocols, not all
        // This reduces UI lag by filtering at subscription level
        const importantProtocols = [
            SystemProtocol.SECURITY_LOCKDOWN,
            SystemProtocol.MISSING_CREDENTIAL,
            SystemProtocol.GENESIS_UPDATE  // Only show major state changes
        ];

        const unsubs = importantProtocols.map(p =>
            systemBus.subscribe(p, (event) => {
                // Skip events with no meaningful data
                if (!event.payload || Object.keys(event.payload).length === 0) return;
                if (event.payload.message === 'heartbeat') return;

                // Add unique ID for React keys if not present
                const newEvent = { ...event, id: event.id || Math.random().toString(36) };

                setEvents(prev => [newEvent, ...prev].slice(0, 5)); // Keep max 5

                // Auto-dismiss individual events
                setTimeout(() => {
                    setEvents(prev => prev.filter(e => e.id !== newEvent.id));
                }, 4000);
            })
        );

        return () => unsubs.forEach(u => u());
    }, []);

    const getConfig = (type: SystemProtocol) => {
        switch (type) {
            case SystemProtocol.UI_REFRESH:
                return { color: 'cyan', icon: RefreshCw, label: 'INTERFACE REFACTOR' };
            case SystemProtocol.SQUAD_EXPANSION:
                return { color: 'green', icon: Box, label: 'SQUAD DEPLOYMENT' };
            case SystemProtocol.CONFIG_MUTATION:
                return { color: 'purple', icon: Zap, label: 'SYSTEM MUTATION' };
            case SystemProtocol.SECURITY_LOCKDOWN:
                return { color: 'red', icon: Shield, label: 'DEFENSIVE LOCKDOWN' };
            case SystemProtocol.INTERFACE_MORPH:
                return { color: 'pink', icon: Layers, label: 'ADAPTIVE MORPH' };
            case SystemProtocol.RESOURCE_SHUNT:
                return { color: 'orange', icon: ArrowRightLeft, label: 'VRAM SHUNTING' };
            case SystemProtocol.MEMORY_FLUSH:
                return { color: 'blue', icon: Activity, label: 'MEMORY TRANSCENDENCE' };
            default:
                return { color: 'slate', icon: Activity, label: 'SYSTEM PROTOCOL' };
        }
    };

    return (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-full max-w-md pointer-events-none">
            {events.map((event) => {
                const cfg = getConfig(event.type);
                const Icon = cfg.icon;

                return (
                    <div
                        key={event.id}
                        className={`
                            mx-auto w-full animate-in slide-in-from-top-5 fade-in duration-300
                            bg-black/90 backdrop-blur-xl border border-${cfg.color}-500/50 
                            px-6 py-3 rounded-r-full rounded-l-md shadow-[0_0_30px_rgba(0,0,0,0.5)] 
                            flex items-center gap-4 relative overflow-hidden border-l-4 border-l-${cfg.color}-500
                        `}
                    >
                        {/* Scanline Effect */}
                        <div className={`absolute inset-0 bg-${cfg.color}-500/5 animate-pulse`}></div>

                        <div className={`p-2 rounded-full bg-${cfg.color}-500/20 text-${cfg.color}-400 shrink-0`}>
                            <Icon size={18} className="animate-spin-slow" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center">
                                <h3 className={`text-${cfg.color}-400 font-bold text-xs tracking-widest font-mono truncate`}>
                                    {cfg.label}
                                </h3>
                                <span className="text-[9px] text-slate-500 font-mono">
                                    {new Date(event.timestamp).toLocaleTimeString().split(' ')[0]}
                                </span>
                            </div>
                            <p className="text-white text-[10px] font-mono truncate mt-0.5">
                                {event.payload?.message || JSON.stringify(event.payload)}
                            </p>
                        </div>

                        {/* Status Light */}
                        <div className={`w-1.5 h-1.5 rounded-full bg-${cfg.color}-500 animate-ping`}></div>
                    </div>
                );
            })}


            {/* NEURAL LINK STATUS (SSE DEBUG) */}
            <div className="absolute top-0 right-[-140px] translate-x-1/2 mt-2 flex items-center gap-2 px-3 py-1 bg-black/60 backdrop-blur rounded-full border border-slate-800">
                <div className="flex flex-col items-end">
                    <span className="text-[9px] text-slate-400 font-mono uppercase tracking-wider">Neural Link</span>
                    <span className="text-[8px] text-emerald-500 font-mono">ACTIVE (SSE)</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]"></div>
            </div>
        </div>
    );
};

export default ProtocolOverlay;
