
import React, { useState, useEffect } from 'react';
import { installer } from '../services/installationService';
import { InstallationState } from '../types';
import { Shield, Scan, Database, Server, Key, CheckCircle, Terminal, X, Network } from 'lucide-react';

// Modified props to support closing the modal
const InstallationWizard: React.FC<{ onComplete: () => void, onClose: () => void }> = ({ onComplete, onClose }) => {
    // We use a separate local instance state for this UI to allow multiple "installs" (external targets)
    const [state, setState] = useState<InstallationState>(installer.getState());
    const [targetUrl, setTargetUrl] = useState('');
    const [apiKey, setApiKey] = useState('');

    // Initial reset when opening for a new target
    useEffect(() => {
        installer.hardReset(); // Reset the service logic for a new run
        const current = installer.getState();
        setState({...current});
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            const current = installer.getState();
            setState({...current});
            if (current.isInstalled && current.currentStep === 'COMPLETE') {
                setTimeout(onComplete, 2000); // Small delay to show success
            }
        }, 500);
        return () => clearInterval(interval);
    }, [onComplete]);

    const handleStart = async () => {
        if (!apiKey) return;
        // For external integration, we might want the Target URL too
        installer.updateKeys({ gemini: apiKey });
        await installer.startScan();
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="max-w-2xl w-full bg-slate-900 border border-cyan-900/50 rounded-2xl shadow-2xl overflow-hidden relative">
                {/* Close Button */}
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white z-50">
                    <X size={24} />
                </button>

                {/* Background Effects */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500 animate-pulse"></div>
                <div className="absolute -right-20 -top-20 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl"></div>
                
                <div className="p-8 relative z-10">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/30">
                            <Network className="text-green-400" size={32} />
                        </div>
                        <h1 className="text-2xl font-bold text-white tracking-wider">EXTERNAL APP INTEGRATION</h1>
                        <p className="text-sm text-slate-400 mt-2">Deploy Installation Squad to Remote Target</p>
                    </div>

                    {state.currentStep === 'KEYS' && (
                        <div className="space-y-6">
                            <div className="bg-black/30 p-4 rounded-lg border border-slate-800 space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                                        Target Application URL
                                    </label>
                                    <input 
                                        type="text" 
                                        value={targetUrl}
                                        onChange={(e) => setTargetUrl(e.target.value)}
                                        placeholder="https://my-app.com"
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-white focus:border-cyan-500 focus:outline-none font-mono text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                                        <Key size={14} /> Access Key (For Verification)
                                    </label>
                                    <input 
                                        type="password" 
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="sk-..."
                                        className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-white focus:border-cyan-500 focus:outline-none font-mono text-sm"
                                    />
                                </div>
                                <p className="text-[10px] text-slate-500">
                                    The squad will scan the public structure and endpoints of the target to build a custom API bridge.
                                </p>
                            </div>
                            <button 
                                onClick={handleStart}
                                disabled={!apiKey || !targetUrl}
                                className={`w-full py-4 rounded-lg font-bold text-sm tracking-widest transition-all ${
                                    apiKey && targetUrl
                                    ? 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_20px_rgba(34,197,94,0.4)]' 
                                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                }`}
                            >
                                INITIATE REMOTE SCAN
                            </button>
                        </div>
                    )}

                    {(state.currentStep === 'SCANNING' || state.currentStep === 'MAPPING' || state.currentStep === 'HANDOVER') && (
                        <div className="space-y-6">
                            {/* Progress Bar */}
                            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-green-500 transition-all duration-500 relative"
                                    style={{ width: `${state.progress}%` }}
                                >
                                    <div className="absolute inset-0 bg-white/30 animate-pulse"></div>
                                </div>
                            </div>
                            
                            {/* Active Agents Visualization */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className={`p-3 rounded border flex flex-col items-center gap-2 transition-all ${state.progress > 0 ? 'bg-green-900/20 border-green-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-600'}`}>
                                    <Scan size={20} className={state.progress > 0 && state.progress < 100 ? 'animate-spin-slow' : ''} />
                                    <span className="text-[10px] font-mono">REMOTE SCAN</span>
                                </div>
                                <div className={`p-3 rounded border flex flex-col items-center gap-2 transition-all ${state.progress > 50 ? 'bg-purple-900/20 border-purple-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-600'}`}>
                                    <Database size={20} className={state.progress > 50 && state.progress < 100 ? 'animate-bounce' : ''} />
                                    <span className="text-[10px] font-mono">ENDPOINT MAP</span>
                                </div>
                                <div className={`p-3 rounded border flex flex-col items-center gap-2 transition-all ${state.progress > 80 ? 'bg-cyan-900/20 border-cyan-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-600'}`}>
                                    <Server size={20} />
                                    <span className="text-[10px] font-mono">INTEGRATING</span>
                                </div>
                            </div>

                            {/* Terminal Logs */}
                            <div className="bg-black p-4 rounded-lg font-mono text-xs h-32 overflow-y-auto custom-scrollbar border border-slate-800">
                                {state.logs.map((log, i) => (
                                    <div key={i} className="text-green-400 opacity-80 mb-1">
                                        {log}
                                    </div>
                                ))}
                                <div className="animate-pulse text-cyan-500">_</div>
                            </div>
                        </div>
                    )}
                    
                    {state.currentStep === 'COMPLETE' && (
                        <div className="text-center py-8 animate-pulse">
                            <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
                            <h2 className="text-xl font-bold text-white">INTEGRATION SUCCESSFUL</h2>
                            <p className="text-sm text-slate-400">The external app has been mapped. Agents are ready.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InstallationWizard;
