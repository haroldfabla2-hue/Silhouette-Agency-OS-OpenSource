import React, { useState } from 'react';
import { useHardwareSafety } from '../hooks/useHardwareSafety';
import { SystemMode } from '../types';
import { Zap } from 'lucide-react';

interface PowerSelectorProps {
    currentMode: SystemMode;
    setMode: (mode: SystemMode) => void;
}

export const PowerSelector: React.FC<PowerSelectorProps> = ({ currentMode, setMode }) => {
    const { safetyScore, recommendedMode, specs } = useHardwareSafety();

    const handleModeChange = (mode: string) => {
        if (mode === 'ULTRA' && safetyScore < 60) {
            alert(`⛔ SYSTEM WARNING: Your hardware (Cores: ${specs.cores}, RAM: ~${specs.memory}GB) cannot sustain ULTRA mode stability. Switching to HIGH to prevent crash.`);
            setMode(SystemMode.HIGH);
            return;
        }
        setMode(mode as SystemMode);
    };

    return (
        <div className="glass-panel rounded-xl p-6">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                    <Zap className={currentMode === SystemMode.ULTRA ? "text-purple-400 animate-pulse" : "text-yellow-400"} />
                    Bio-Safe Power Protocol
                </h2>
                <div className="text-xs font-mono text-slate-500">
                    Score: {safetyScore}/100
                </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
                {[SystemMode.ECO, SystemMode.BALANCED, SystemMode.HIGH, SystemMode.ULTRA].map((mode) => (
                    <button
                        key={mode}
                        onClick={() => handleModeChange(mode)}
                        className={`
              px-2 py-3 rounded font-bold uppercase text-xs transition-all relative overflow-hidden
              ${currentMode === mode
                                ? (mode === SystemMode.ULTRA ? 'bg-purple-900/50 border border-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]' : 'bg-cyan-900/30 border border-cyan-500 text-white')
                                : 'bg-slate-900/50 border border-slate-800 text-slate-400 hover:border-slate-600'}
              ${mode === SystemMode.ULTRA && safetyScore < 60 ? 'opacity-50 cursor-not-allowed border-red-900/50' : ''}
            `}
                    >
                        {currentMode === mode && <div className="absolute inset-0 bg-white/5 animate-pulse" />}
                        <div className="relative z-10">{mode}</div>
                        {mode.toLowerCase() === recommendedMode && <span className="block text-[8px] text-green-400 mt-1">RECOMMENDED</span>}
                    </button>
                ))}
            </div>
            <div className="mt-3 text-[10px] text-slate-500 flex justify-between">
                <span>Detected: {specs.cores} Cores / ~{specs.memory}GB RAM</span>
                {safetyScore < 60 && <span className="text-orange-400">Hardware Limitations Active</span>}
            </div>
        </div>
    );
};
