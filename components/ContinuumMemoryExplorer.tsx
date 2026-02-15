
import React, { useState, useEffect } from 'react';
import { Zap, Clock, HardDrive, Archive, Database, Activity, RefreshCw, Lock, Trash2, Search, BrainCircuit, Library, Calendar } from 'lucide-react';
import { DEFAULT_API_CONFIG } from '../constants';
import { MemoryNode, MemoryTier, SystemProtocol } from '../types';
import { systemBus } from '../services/systemBus';

const TierColumn: React.FC<{ tier: MemoryTier, title: string, icon: any, color: string, nodes: MemoryNode[] }> = ({ tier, title, icon: Icon, color, nodes }) => (
    <div className={`flex-1 min-w-[200px] flex flex-col bg-slate-900/30 border-r border-slate-800 last:border-r-0`}>
        <div className={`p-4 border-b border-${color}-500/30 bg-${color}-900/10`}>
            <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className={`text-${color}-400`} />
                <h3 className={`text-xs font-bold text-${color}-100 uppercase`}>{title}</h3>
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>Count: {nodes.length}</span>
                <span>Size: ~{(JSON.stringify(nodes).length / 1024).toFixed(1)}KB</span>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-black/20">
            {nodes.length === 0 && (
                <div className="text-center mt-10 opacity-20">
                    <Icon size={32} className="mx-auto mb-2" />
                    <span className="text-[10px]">EMPTY</span>
                </div>
            )}
            {nodes.map((node, idx) => (
                <div key={node.id || `node-${idx}`} className="bg-slate-900 border border-slate-800 p-2 rounded relative group hover:border-cyan-500/50 transition-colors">
                    {/* Health Bar (Ebbinghaus Decay) */}
                    <div className="absolute bottom-0 left-0 h-1 bg-slate-800 w-full rounded-b overflow-hidden">
                        <div
                            className={`h-full transition-all duration-1000 ${(node.decayHealth || 100) < 30 ? 'bg-red-500' : 'bg-green-500'}`}
                            style={{ width: `${node.decayHealth || 100}%` }}
                        />
                    </div>

                    {/* Header */}
                    <div className="flex justify-between items-start mb-1">
                        <div className="flex gap-1 items-center">
                            {node.tags?.includes('SACRED') && <Lock size={10} className="text-yellow-500" />}
                            {node.tags?.includes('intuition') && <BrainCircuit size={10} className="text-pink-500" />}
                            <span className={`text-[9px] font-mono ${node.tags?.includes('intuition') ? 'text-pink-400 font-bold' : 'text-slate-500'}`}>
                                {node.tags?.includes('intuition') ? 'INTUITION' : `ID:${(node.id || '???').substring(0, 4)}`}
                            </span>
                        </div>
                        <span className="text-[9px] text-slate-600">{node.accessCount || 0} Hits</span>
                    </div>

                    {/* Content */}
                    <p className={`text-[10px] leading-tight font-mono mb-2 ${(node.compressionLevel || 0) > 0 ? 'text-slate-500 italic' : 'text-slate-300'}`}>
                        {node.content || 'No content available'}
                    </p>

                    {/* Footer Info */}
                    <div className="flex justify-between items-center border-t border-slate-800 pt-1 mt-1">
                        {/* RAPTOR Visualization */}
                        {node.raptorLevel !== undefined && node.raptorLevel > 0 && (
                            <div className="flex items-center gap-1 text-emerald-400">
                                <Library size={10} />
                                <span className="text-[8px] font-bold">RAPTOR L{node.raptorLevel}</span>
                            </div>
                        )}

                        {/* Fractal Index Visualization */}
                        {node.timeGrid && (
                            <div className="flex items-center gap-1 text-purple-400 ml-auto">
                                <Calendar size={10} />
                                <span className="text-[8px]">{node.timeGrid.year}-{node.timeGrid.month}-{node.timeGrid.day}</span>
                            </div>
                        )}
                    </div>

                    {/* Compression Indicator */}
                    {(node.compressionLevel || 0) > 0 && (
                        <div className="absolute top-2 right-2 px-1 py-0.5 bg-slate-800 rounded text-[8px] text-cyan-400 border border-cyan-900">
                            ZIP L{node.compressionLevel}
                        </div>
                    )}
                </div>
            ))}
        </div>
    </div>
);

const ContinuumMemoryExplorer: React.FC = () => {
    // [REFACTOR 2026-01-07] Updated to 4-tier architecture (WORKING replaces ULTRA_SHORT + SHORT)
    const [data, setData] = useState<Record<MemoryTier, MemoryNode[]>>({
        [MemoryTier.WORKING]: [],
        [MemoryTier.MEDIUM]: [],
        [MemoryTier.LONG]: [],
        [MemoryTier.DEEP]: []
    });

    const [stats, setStats] = useState<any>({});

    // Search State
    const [searchResults, setSearchResults] = useState<MemoryNode[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        const handleSearch = async (e: Event) => {
            const query = (e as CustomEvent).detail;
            if (!query) return;

            setIsSearching(true);
            try {
                const res = await fetch(`/v1/memory/search?q=${encodeURIComponent(query)}`, {
                    headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
                });
                if (res.ok) {
                    const json = await res.json();
                    setSearchResults(json.results);
                }
            } catch (err) {
                console.error("Search failed", err);
            } finally {
                setIsSearching(false);
            }
        };

        window.addEventListener('MEMORY_SEARCH', handleSearch);
        return () => window.removeEventListener('MEMORY_SEARCH', handleSearch);
    }, []);

    // ... (rest of useEffect for polling)
    useEffect(() => {
        const refresh = async () => {
            try {
                const res = await fetch(`/v1/memory/state`, {
                    headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
                });
                if (res.ok) {
                    const json = await res.json();
                    setData(json.nodes || {
                        [MemoryTier.WORKING]: [],
                        [MemoryTier.MEDIUM]: [],
                        [MemoryTier.LONG]: [],
                        [MemoryTier.DEEP]: []
                    });
                    setStats(json.stats);
                }
            } catch (e) {
                console.error("Failed to fetch memory state", e);
            }
        };

        refresh();
        const interval = setInterval(refresh, 2000); // Poll every 2s

        // Subscribe to Real-time Memory Updates
        const unsubscribe = systemBus.subscribe(SystemProtocol.MEMORY_CREATED, () => {
            console.log("[MEMORY EXPLORER] Real-time memory update received");
            refresh();
        });

        return () => {
            clearInterval(interval);
            unsubscribe();
        };
    }, []);

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-4 relative">
            {/* SEARCH RESULTS MODAL */}
            {searchResults !== null && (
                <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-md rounded-xl p-6 flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-cyan-400 flex items-center gap-2">
                            <Search size={20} />
                            Search Results
                            <span className="text-sm text-slate-500 font-mono bg-slate-800 px-2 rounded-full">{searchResults.length} matches</span>
                        </h2>
                        <button
                            onClick={() => setSearchResults(null)}
                            className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"
                        >
                            CLOSE (ESC)
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 custom-scrollbar pb-10">
                        {searchResults.length === 0 && (
                            <div className="col-span-full text-center py-20 opacity-50">
                                <Search size={48} className="mx-auto mb-4 text-slate-600" />
                                <p>No universal memories found.</p>
                            </div>
                        )}
                        {searchResults.map((node, idx) => (
                            <div key={node.id + idx} className={`bg-slate-900 border ${node.tier === MemoryTier.DEEP ? 'border-green-900/50 bg-green-900/10' : 'border-slate-800'} p-4 rounded-lg relative hover:border-cyan-500/50 transition-all`}>
                                <div className="flex justify-between items-start mb-2">
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${node.tier === MemoryTier.DEEP ? 'bg-green-500/20 text-green-400' :
                                        node.tier === MemoryTier.MEDIUM ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-700 text-slate-300'
                                        }`}>
                                        {node.tier || 'UNKNOWN'}
                                    </span>
                                    <span className="text-[10px] text-slate-500 font-mono">{new Date(node.timestamp).toLocaleDateString()}</span>
                                </div>
                                <p className="text-xs text-slate-300 font-mono leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">
                                    {node.content}
                                </p>
                                <div className="mt-3 flex gap-2 flex-wrap">
                                    {node.tags?.map(t => (
                                        <span key={t} className="text-[9px] text-cyan-500 bg-cyan-900/20 px-1 rounded">#{t}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Header Stats */}
            <div className="glass-panel p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-cyan-500/10 rounded-lg text-cyan-400">
                        <Database size={24} />
                    </div>
                    <div>
                        <h2 className="text-white font-bold text-lg">Continuum Memory 4-Tier Architecture</h2>
                        <p className="text-xs text-slate-400">V5.0 - Unified WORKING Memory + Smart Compression</p>
                    </div>
                </div>

                {/* SEARCH BAR */}
                <div className="flex-1 max-w-lg mx-4">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Universal Search (RAM + LanceDB + Qdrant)..."
                            className="w-full bg-slate-900/50 border border-slate-700 rounded-full py-2 pl-10 pr-4 text-xs text-cyan-100 focus:border-cyan-500 outline-none transition-all"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const val = e.currentTarget.value;
                                    if (val) window.dispatchEvent(new CustomEvent('MEMORY_SEARCH', { detail: val }));
                                }
                            }}
                        />
                        <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
                    </div>
                </div>

                <div className="flex gap-6 text-center items-center">
                    {/* CONSOLIDATION TRIGGER */}
                    <button
                        onClick={async () => {
                            if (!confirm('FORCE CONSOLIDATION: Move all RAM memories to LanceDB?')) return;
                            try {
                                const res = await fetch('/v1/memory/consolidate', { method: 'POST', headers: { 'Authorization': `Bearer ${DEFAULT_API_CONFIG.apiKey}` } });
                                if (res.ok) {
                                    const data = await res.json();
                                    alert(`CONSOLIDATION COMPLETE: Promoted ${data.promoted} nodes.`);
                                }
                            } catch (e) { alert('Consolidation Failed'); }
                        }}
                        className="flex flex-col items-center group cursor-pointer hover:bg-white/5 p-2 rounded transition-colors"
                    >
                        <div className="text-pink-500 group-hover:scale-110 transition-transform">
                            <Archive size={18} />
                        </div>
                        <span className="text-[8px] text-pink-400 mt-1 uppercase font-bold">Consolidate</span>
                    </button>

                    <div className="w-px h-8 bg-slate-800 mx-2"></div>

                    <div>
                        <p className="text-[10px] text-slate-500 uppercase">Total Nodes</p>
                        <p className="text-xl font-mono text-white">{stats.total || 0}</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-slate-500 uppercase">Avg Health</p>
                        <p className={`text-xl font-mono ${(stats.avgHealth || 0) < 50 ? 'text-red-400' : 'text-green-400'}`}>
                            {(stats.avgHealth || 0).toFixed(1)}%
                        </p>
                    </div>
                </div>
            </div>

            {/* 5-Tier Columns */}
            <div className="flex-1 glass-panel rounded-xl overflow-hidden flex border-x border-slate-800">
                <TierColumn
                    tier={MemoryTier.WORKING}
                    title="Working (RAM)"
                    icon={Zap}
                    color="cyan"
                    nodes={data[MemoryTier.WORKING] || []}
                />
                <TierColumn
                    tier={MemoryTier.MEDIUM}
                    title="Medium (LanceDB)"
                    icon={HardDrive}
                    color="purple"
                    nodes={data[MemoryTier.MEDIUM] || []}
                />
                <TierColumn
                    tier={MemoryTier.LONG}
                    title="Long (Archive)"
                    icon={Archive}
                    color="orange"
                    nodes={data[MemoryTier.LONG] || []}
                />
                <TierColumn
                    tier={MemoryTier.DEEP}
                    title="Deep (Vector)"
                    icon={Database}
                    color="green"
                    nodes={data[MemoryTier.DEEP] || []}
                />
            </div>
        </div>
    );
};

export default ContinuumMemoryExplorer;
