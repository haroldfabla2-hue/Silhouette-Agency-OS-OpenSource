import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { ProviderState, VideoJob } from '../types';

interface HealthMonitorProps {
    providerHealth?: Record<string, ProviderState>;
    mediaQueue?: VideoJob[];
}

const HealthMonitor: React.FC<HealthMonitorProps> = ({ providerHealth, mediaQueue }) => {
    if (!providerHealth && !mediaQueue) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4">
            {/* PROVIDER HEALTH */}
            <div className="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-cyan-500 opacity-50" />
                <h3 className="text-xl font-bold flex items-center gap-2 mb-4 text-emerald-100">
                    <Activity className="w-5 h-5 text-emerald-400" />
                    Neural Circuit Status
                </h3>

                <div className="space-y-3">
                    {providerHealth && Object.values(providerHealth).map((provider) => (
                        <div key={provider.name} className="flex items-center justify-between bg-black/40 p-3 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full shadow-[0_0_10px_currentColor] ${provider.status === 'HEALTHY' ? 'bg-emerald-500 text-emerald-500' : 'bg-red-500 text-red-500'
                                    }`} />
                                <span className="font-mono text-sm uppercase tracking-wider text-white/80">{provider.name}</span>
                            </div>

                            {provider.status === 'SUSPENDED' && (
                                <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 px-2 py-1 rounded">
                                    <Clock className="w-3 h-3" />
                                    <span>{Math.max(0, Math.ceil((provider.suspendedUntil - Date.now()) / 60000))}m cool-down</span>
                                </div>
                            )}

                            {provider.status === 'HEALTHY' && (
                                <span className="text-xs text-emerald-500/50 font-mono">OPERATIONAL</span>
                            )}
                        </div>
                    ))}
                    {!providerHealth && <div className="text-white/30 italic">No telemetry signal...</div>}
                </div>
            </div>

            {/* RENDER QUEUE */}
            <div className="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-pink-500 opacity-50" />
                <h3 className="text-xl font-bold flex items-center gap-2 mb-4 text-purple-100">
                    <div className="relative">
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-purple-500 rounded-full animate-ping" />
                        <CheckCircle className="w-5 h-5 text-purple-400" />
                    </div>
                    Visual Cortex Queue
                </h3>

                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                    {mediaQueue && mediaQueue.length > 0 ? (
                        mediaQueue.map((job) => (
                            <div key={job.id} className="flex items-center justify-between bg-black/40 p-3 rounded-lg border border-white/5 hover:bg-white/5 transition-colors group">
                                <div className="flex flex-col gap-1 max-w-[70%]">
                                    <span className="text-xs font-mono text-purple-300/70 truncate ">{job.id.split('-')[0]}</span>
                                    <span className="text-sm text-white/90 truncate group-hover:text-purple-200 transition-colors">"{job.prompt}"</span>
                                </div>
                                <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${job.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-300' :
                                        job.status === 'PROCESSING' ? 'bg-blue-500/20 text-blue-300 animate-pulse' :
                                            job.status === 'FAILED' ? 'bg-red-500/20 text-red-300' :
                                                'bg-white/10 text-white/50'
                                    }`}>
                                    {job.status}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full py-8 text-white/20 gap-2">
                            <div className="w-12 h-12 rounded-full border-2 border-white/5 flex items-center justify-center">
                                <span className="text-2xl">💤</span>
                            </div>
                            <span className="text-sm">Queue Idle...</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default HealthMonitor;
