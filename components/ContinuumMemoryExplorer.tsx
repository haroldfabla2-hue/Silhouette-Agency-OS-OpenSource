import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Archive,
    BrainCircuit,
    Calendar,
    Database,
    HardDrive,
    Library,
    Lock,
    Search,
    Zap
} from 'lucide-react';
import { DEFAULT_API_CONFIG } from '../constants';
import { MemoryNode, MemoryTier, SystemProtocol } from '../types';
import { systemBus } from '../services/systemBus';

const MEMORY_DISPLAY_LIMIT = 40;
const SEARCH_RESULT_LIMIT = 60;
const REFRESH_INTERVAL_MS = 10000;

type TierMeta = {
    total: number;
    visible: number;
    approxSizeBytes: number;
};

type TierTone = {
    header: string;
    icon: string;
    title: string;
    accent: string;
};

const createEmptyData = (): Record<MemoryTier, MemoryNode[]> => ({
    [MemoryTier.WORKING]: [],
    [MemoryTier.MEDIUM]: [],
    [MemoryTier.LONG]: [],
    [MemoryTier.DEEP]: []
});

const createEmptyMeta = (): Record<MemoryTier, TierMeta> => ({
    [MemoryTier.WORKING]: { total: 0, visible: 0, approxSizeBytes: 0 },
    [MemoryTier.MEDIUM]: { total: 0, visible: 0, approxSizeBytes: 0 },
    [MemoryTier.LONG]: { total: 0, visible: 0, approxSizeBytes: 0 },
    [MemoryTier.DEEP]: { total: 0, visible: 0, approxSizeBytes: 0 }
});

const tierTones: Record<MemoryTier, TierTone> = {
    [MemoryTier.WORKING]: {
        header: 'border-cyan-500/30 bg-cyan-900/10',
        icon: 'text-cyan-400',
        title: 'text-cyan-100',
        accent: 'bg-cyan-500'
    },
    [MemoryTier.MEDIUM]: {
        header: 'border-purple-500/30 bg-purple-900/10',
        icon: 'text-purple-400',
        title: 'text-purple-100',
        accent: 'bg-purple-500'
    },
    [MemoryTier.LONG]: {
        header: 'border-amber-500/30 bg-amber-900/10',
        icon: 'text-amber-400',
        title: 'text-amber-100',
        accent: 'bg-amber-500'
    },
    [MemoryTier.DEEP]: {
        header: 'border-emerald-500/30 bg-emerald-900/10',
        icon: 'text-emerald-400',
        title: 'text-emerald-100',
        accent: 'bg-emerald-500'
    }
};

const formatBytes = (bytes: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleDateString();
};

const TierColumn: React.FC<{
    title: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    tone: TierTone;
    nodes: MemoryNode[];
    meta: TierMeta;
}> = ({ title, icon: Icon, tone, nodes, meta }) => (
    <div className="flex min-h-0 w-[18.5rem] flex-col border-r border-slate-800 last:border-r-0 sm:w-[21rem] lg:flex-1 lg:min-w-[240px]">
        <div className={`p-4 border-b ${tone.header}`}>
            <div className="mb-1 flex items-center gap-2">
                <Icon size={16} className={tone.icon} />
                <h3 className={`text-xs font-bold uppercase ${tone.title}`}>{title}</h3>
            </div>
            <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500 font-mono">
                <span>Showing {meta.visible}/{meta.total}</span>
                <span>{formatBytes(meta.approxSizeBytes)}</span>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-black/20">
            {nodes.length === 0 && (
                <div className="mt-10 text-center opacity-20">
                    <Icon size={32} className="mx-auto mb-2" />
                    <span className="text-[10px]">EMPTY</span>
                </div>
            )}

            {nodes.map((node, idx) => (
                <div
                    key={node.id || `node-${idx}`}
                    className="bg-slate-900 border border-slate-800 p-2 rounded relative group hover:border-cyan-500/50 transition-colors"
                >
                    <div className="absolute bottom-0 left-0 h-1 bg-slate-800 w-full rounded-b overflow-hidden">
                        <div
                            className={`h-full transition-all duration-1000 ${(node.decayHealth || 100) < 30 ? 'bg-red-500' : tone.accent}`}
                            style={{ width: `${node.decayHealth || 100}%` }}
                        />
                    </div>

                    <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="flex min-w-0 gap-1 items-center">
                            {node.tags?.includes('SACRED') && <Lock size={10} className="text-yellow-500 shrink-0" />}
                            {node.tags?.includes('intuition') && <BrainCircuit size={10} className="text-pink-500 shrink-0" />}
                            <span className={`truncate text-[9px] font-mono ${node.tags?.includes('intuition') ? 'text-pink-400 font-bold' : 'text-slate-500'}`}>
                                {node.tags?.includes('intuition') ? 'INTUITION' : `ID:${(node.id || '???').substring(0, 4)}`}
                            </span>
                        </div>
                        <span className="shrink-0 text-[9px] text-slate-600">{node.accessCount || 0} Hits</span>
                    </div>

                    <p className={`mb-2 text-[10px] leading-tight font-mono break-words ${(node.compressionLevel || 0) > 0 ? 'text-slate-500 italic' : 'text-slate-300'}`}>
                        {node.content || 'No content available'}
                    </p>

                    <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-800 pt-1">
                        {node.raptorLevel !== undefined && node.raptorLevel > 0 ? (
                            <div className="flex items-center gap-1 text-emerald-400 min-w-0">
                                <Library size={10} className="shrink-0" />
                                <span className="text-[8px] font-bold truncate">RAPTOR L{node.raptorLevel}</span>
                            </div>
                        ) : (
                            <div />
                        )}

                        {node.timeGrid && (
                            <div className="ml-auto flex items-center gap-1 text-purple-400 shrink-0">
                                <Calendar size={10} />
                                <span className="text-[8px]">
                                    {node.timeGrid.year}-{node.timeGrid.month}-{node.timeGrid.day}
                                </span>
                            </div>
                        )}
                    </div>

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

interface ContinuumMemoryExplorerProps {
    isActive?: boolean;
}

const ContinuumMemoryExplorer: React.FC<ContinuumMemoryExplorerProps> = ({ isActive = true }) => {
    const [data, setData] = useState<Record<MemoryTier, MemoryNode[]>>(createEmptyData);
    const [tierMeta, setTierMeta] = useState<Record<MemoryTier, TierMeta>>(createEmptyMeta);
    const [stats, setStats] = useState<any>({});
    const [searchResults, setSearchResults] = useState<MemoryNode[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isRefreshingRef = useRef(false);
    const pendingRefreshRef = useRef(false);

    const visibleSearchResults = useMemo(
        () => (searchResults || []).slice(0, SEARCH_RESULT_LIMIT),
        [searchResults]
    );

    useEffect(() => {
        const handleSearch = async (e: Event) => {
            const query = (e as CustomEvent).detail;
            if (!query) return;

            setIsSearching(true);
            try {
                const res = await fetch(`/v1/memory/search?q=${encodeURIComponent(query)}`, {
                    headers: { Authorization: `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
                });
                if (res.ok) {
                    const json = await res.json();
                    setSearchResults(Array.isArray(json.results) ? json.results : []);
                }
            } catch (err) {
                console.error("Search failed", err);
            } finally {
                setIsSearching(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSearchResults(null);
            }
        };

        window.addEventListener('MEMORY_SEARCH', handleSearch);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('MEMORY_SEARCH', handleSearch);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    useEffect(() => {
        if (!isActive) return;

        let cancelled = false;

        const runRefresh = async () => {
            if (cancelled) return;
            if (isRefreshingRef.current) {
                pendingRefreshRef.current = true;
                return;
            }

            isRefreshingRef.current = true;
            try {
                const res = await fetch(`/v1/memory/state?limit=${MEMORY_DISPLAY_LIMIT}`, {
                    headers: { Authorization: `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
                });

                if (!res.ok || cancelled) return;

                const json = await res.json();
                if (cancelled) return;

                setData(json.nodes || createEmptyData());
                setTierMeta(json.meta || createEmptyMeta());
                setStats(json.stats || {});
            } catch (e) {
                console.error("Failed to fetch memory state", e);
            } finally {
                isRefreshingRef.current = false;
                if (pendingRefreshRef.current && !cancelled) {
                    pendingRefreshRef.current = false;
                    scheduleRefresh(250);
                }
            }
        };

        const scheduleRefresh = (delay: number = 0) => {
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }

            refreshTimeoutRef.current = setTimeout(() => {
                void runRefresh();
            }, delay);
        };

        scheduleRefresh(0);
        const interval = setInterval(() => scheduleRefresh(0), REFRESH_INTERVAL_MS);

        const unsubscribe = systemBus.subscribe(SystemProtocol.MEMORY_CREATED, () => {
            scheduleRefresh(750);
        });

        return () => {
            cancelled = true;
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
                refreshTimeoutRef.current = null;
            }
            clearInterval(interval);
            unsubscribe();
        };
    }, [isActive]);

    return (
        <div className="min-h-[calc(100dvh-11rem)] flex flex-col gap-4 relative">
            {searchResults !== null && (
                <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-md rounded-xl p-4 sm:p-6 flex flex-col">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="min-w-0 text-lg sm:text-xl font-bold text-cyan-400 flex items-center gap-2">
                            <Search size={20} />
                            <span className="truncate">Search Results</span>
                            <span className="shrink-0 text-xs sm:text-sm text-slate-500 font-mono bg-slate-800 px-2 rounded-full">
                                {visibleSearchResults.length}{searchResults.length > SEARCH_RESULT_LIMIT ? ` / ${searchResults.length}` : ''} matches
                            </span>
                        </h2>
                        <button
                            onClick={() => setSearchResults(null)}
                            className="w-full sm:w-auto p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"
                        >
                            CLOSE (ESC)
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 custom-scrollbar pb-10">
                        {visibleSearchResults.length === 0 && (
                            <div className="col-span-full text-center py-20 opacity-50">
                                <Search size={48} className="mx-auto mb-4 text-slate-600" />
                                <p>No universal memories found.</p>
                            </div>
                        )}

                        {visibleSearchResults.map((node) => (
                            <div
                                key={`${node.id}-${node.timestamp}`}
                                className={`bg-slate-900 border ${node.tier === MemoryTier.DEEP ? 'border-green-900/50 bg-green-900/10' : 'border-slate-800'} p-4 rounded-lg relative hover:border-cyan-500/50 transition-all`}
                            >
                                <div className="mb-2 flex items-start justify-between gap-2">
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${node.tier === MemoryTier.DEEP
                                        ? 'bg-green-500/20 text-green-400'
                                        : node.tier === MemoryTier.MEDIUM
                                            ? 'bg-purple-500/20 text-purple-400'
                                            : 'bg-slate-700 text-slate-300'
                                        }`}>
                                        {node.tier || 'UNKNOWN'}
                                    </span>
                                    <span className="text-[10px] text-slate-500 font-mono shrink-0">{formatDate(node.timestamp)}</span>
                                </div>
                                <p className="text-xs text-slate-300 font-mono leading-relaxed max-h-32 overflow-y-auto custom-scrollbar break-words">
                                    {node.content}
                                </p>
                                <div className="mt-3 flex gap-2 flex-wrap">
                                    {node.tags?.map(tag => (
                                        <span key={tag} className="text-[9px] text-cyan-500 bg-cyan-900/20 px-1 rounded">#{tag}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="glass-panel rounded-xl p-4 sm:p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                        <div className="p-3 bg-cyan-500/10 rounded-lg text-cyan-400 shrink-0">
                            <Database size={24} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-white font-bold text-base sm:text-lg">Continuum Memory 4-Tier Architecture</h2>
                            <p className="text-xs text-slate-400">Explorer mode with capped rendering and queued refresh.</p>
                        </div>
                    </div>

                    <div className="w-full xl:max-w-xl">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Universal Search (RAM + LanceDB + pgvector)..."
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-full py-2.5 pl-10 pr-4 text-xs text-cyan-100 focus:border-cyan-500 outline-none transition-all"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const val = e.currentTarget.value.trim();
                                        if (val) {
                                            window.dispatchEvent(new CustomEvent('MEMORY_SEARCH', { detail: val }));
                                        }
                                    }
                                }}
                            />
                            <Search size={14} className="absolute left-3 top-3 text-slate-500" />
                        </div>
                        <div className="mt-2 text-[10px] text-slate-500 font-mono">
                            {isSearching ? 'Searching...' : `Showing up to ${MEMORY_DISPLAY_LIMIT} nodes per tier.`}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-6 overflow-x-auto custom-scrollbar">
                        <button
                            onClick={async () => {
                                if (!confirm('FORCE CONSOLIDATION: Move all RAM memories to LanceDB?')) return;
                                try {
                                    const res = await fetch('/v1/memory/consolidate', {
                                        method: 'POST',
                                        headers: { Authorization: `Bearer ${DEFAULT_API_CONFIG.apiKey}` }
                                    });
                                    if (res.ok) {
                                        const result = await res.json();
                                        alert(`CONSOLIDATION COMPLETE: Promoted ${result.promoted} nodes.`);
                                    }
                                } catch {
                                    alert('Consolidation Failed');
                                }
                            }}
                            className="flex shrink-0 flex-col items-center group cursor-pointer hover:bg-white/5 p-2 rounded transition-colors"
                        >
                            <div className="text-pink-500 group-hover:scale-110 transition-transform">
                                <Archive size={18} />
                            </div>
                            <span className="text-[8px] text-pink-400 mt-1 uppercase font-bold">Consolidate</span>
                        </button>

                        <div className="h-8 w-px shrink-0 bg-slate-800" />

                        <div className="shrink-0 text-center">
                            <p className="text-[10px] text-slate-500 uppercase">Total Nodes</p>
                            <p className="text-xl font-mono text-white">{stats.total || 0}</p>
                        </div>

                        <div className="shrink-0 text-center">
                            <p className="text-[10px] text-slate-500 uppercase">Avg Health</p>
                            <p className={`text-xl font-mono ${(stats.avgHealth || 0) < 50 ? 'text-red-400' : 'text-green-400'}`}>
                                {(stats.avgHealth || 0).toFixed(1)}%
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1 glass-panel rounded-xl overflow-hidden border border-slate-800">
                <div className="flex h-full min-w-max overflow-x-auto custom-scrollbar">
                    <TierColumn
                        title="Working (RAM)"
                        icon={Zap}
                        tone={tierTones[MemoryTier.WORKING]}
                        nodes={data[MemoryTier.WORKING] || []}
                        meta={tierMeta[MemoryTier.WORKING]}
                    />
                    <TierColumn
                        title="Medium (LanceDB)"
                        icon={HardDrive}
                        tone={tierTones[MemoryTier.MEDIUM]}
                        nodes={data[MemoryTier.MEDIUM] || []}
                        meta={tierMeta[MemoryTier.MEDIUM]}
                    />
                    <TierColumn
                        title="Long (Archive)"
                        icon={Archive}
                        tone={tierTones[MemoryTier.LONG]}
                        nodes={data[MemoryTier.LONG] || []}
                        meta={tierMeta[MemoryTier.LONG]}
                    />
                    <TierColumn
                        title="Deep (Vector)"
                        icon={Database}
                        tone={tierTones[MemoryTier.DEEP]}
                        nodes={data[MemoryTier.DEEP] || []}
                        meta={tierMeta[MemoryTier.DEEP]}
                    />
                </div>
            </div>
        </div>
    );
};

export default ContinuumMemoryExplorer;
