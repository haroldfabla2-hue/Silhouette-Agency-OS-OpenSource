import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Sparkles, Zap, Brain, Cpu, Activity, Shield, Network,
    BookOpen, TrendingUp, AlertTriangle, Heart, Clock,
    Wrench, Target, Search, Filter, Trash2, Pause, Play,
    ChevronDown, Link2, Eye, ArrowUpRight
} from 'lucide-react';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

// ─── Event Category Definitions ──────────────────────────────────────────────
//
// Each category maps to one or more `eventType` values from the narrative stream
// (set in metadata by NarrativeService) or to specific `source` or `coherence` ranges.
//
export interface FeedEvent {
    id: string;
    timestamp: number;
    source: 'CONSCIOUS' | 'SUBCONSCIOUS' | 'UNCONSCIOUS' | 'AGENCY';
    content: string;
    coherence: number;
    metadata?: Record<string, any>;
    category: EventCategory;
    isHighlighted?: boolean;
}

export type EventCategory =
    | 'DISCOVERY'
    | 'EUREKA'
    | 'INTUITION'
    | 'SERENDIPITY'
    | 'EVOLUTION'
    | 'SKILL'
    | 'GOAL'
    | 'RESEARCH'
    | 'SYNTHESIS'
    | 'DELEGATION'
    | 'TOOL'
    | 'MEMORY'
    | 'MOOD'
    | 'CONNECTION'
    | 'SECURITY'
    | 'HEALING'
    | 'WORKFLOW'
    | 'THOUGHT';

interface CategoryDef {
    id: EventCategory;
    label: string;
    icon: React.ElementType;
    color: string;          // Tailwind text color
    bg: string;             // Tailwind background classes
    border: string;         // Tailwind border color
    glow?: string;          // Optional shadow glow
    /** Matches against metadata.eventType, metadata.discoveryType, metadata.evolutionType, etc. */
    keywords: string[];
    /** Extra matcher: matches substrings in content */
    contentKeywords?: string[];
    minCoherence?: number;
}

const CATEGORIES: CategoryDef[] = [
    {
        id: 'EUREKA',
        label: 'Eureka',
        icon: Sparkles,
        color: 'text-yellow-300',
        bg: 'bg-yellow-900/30',
        border: 'border-yellow-500/40',
        glow: 'shadow-[0_0_12px_rgba(234,179,8,0.3)]',
        keywords: ['eureka', 'breakthrough'],
        contentKeywords: ['eureka', 'breakthrough', 'aha', 'revelation'],
        minCoherence: 0.9,
    },
    {
        id: 'DISCOVERY',
        label: 'Discovery',
        icon: Eye,
        color: 'text-cyan-300',
        bg: 'bg-cyan-900/20',
        border: 'border-cyan-500/40',
        keywords: ['synthesis', 'paper', 'NARRATIVE_DISCOVERY'],
        contentKeywords: ['discovered', 'realized', 'understand now', 'makes sense', 'connection between', 'crystallized'],
    },
    {
        id: 'SERENDIPITY',
        label: 'Serendipity',
        icon: Zap,
        color: 'text-indigo-300',
        bg: 'bg-indigo-900/20',
        border: 'border-indigo-500/40',
        keywords: ['serendipity'],
        contentKeywords: ['serendipitous', 'unexpectedly', 'surprising pattern', 'stumbled'],
    },
    {
        id: 'INTUITION',
        label: 'Intuition',
        icon: Brain,
        color: 'text-pink-300',
        bg: 'bg-pink-900/20',
        border: 'border-pink-500/40',
        keywords: ['INTUITION_CONSOLIDATED', 'knowledge'],
        contentKeywords: ['insight crystallizes', 'an insight', 'sense a void', 'instinct', 'gap detected'],
    },
    {
        id: 'EVOLUTION',
        label: 'Evolution',
        icon: TrendingUp,
        color: 'text-emerald-300',
        bg: 'bg-emerald-900/20',
        border: 'border-emerald-500/40',
        keywords: ['agent', 'evolutionEvent', 'IMPROVEMENT', 'AGENT_EVOLVED'],
        contentKeywords: ['evolved', 'growing stronger', 'self-improvement', 'optimized', 'improved'],
    },
    {
        id: 'SKILL',
        label: 'Skill Acquired',
        icon: BookOpen,
        color: 'text-lime-300',
        bg: 'bg-lime-900/20',
        border: 'border-lime-500/40',
        keywords: ['SKILL_LEARNED'],
        contentKeywords: ['new skill', 'i can now', 'capability'],
    },
    {
        id: 'GOAL',
        label: 'Goal Progress',
        icon: Target,
        color: 'text-orange-300',
        bg: 'bg-orange-900/20',
        border: 'border-orange-500/40',
        keywords: ['GOAL_UPDATED'],
        contentKeywords: ['goal', 'progress', '% complete', 'milestone'],
    },
    {
        id: 'RESEARCH',
        label: 'Research',
        icon: Search,
        color: 'text-violet-300',
        bg: 'bg-violet-900/20',
        border: 'border-violet-500/40',
        keywords: ['investigation', 'RESEARCH_REQUEST'],
        contentKeywords: ['investigating', 'curiosity stirs', 'research initiated'],
    },
    {
        id: 'SYNTHESIS',
        label: 'Synthesis',
        icon: Link2,
        color: 'text-blue-300',
        bg: 'bg-blue-900/20',
        border: 'border-blue-500/40',
        keywords: ['synthesis', 'paper'],
        contentKeywords: ['synthesized', 'paper generated', 'synthesizing'],
    },
    {
        id: 'DELEGATION',
        label: 'Delegation',
        icon: Network,
        color: 'text-teal-300',
        bg: 'bg-teal-900/20',
        border: 'border-teal-500/40',
        keywords: ['AGENT_DELEGATION', 'agentId'],
        contentKeywords: ['delegating', 'sending part', 'coordinating'],
    },
    {
        id: 'TOOL',
        label: 'Tool Use',
        icon: Wrench,
        color: 'text-slate-300',
        bg: 'bg-slate-800/50',
        border: 'border-slate-600/40',
        keywords: ['TOOL_EXECUTION', 'toolName'],
        contentKeywords: ['tool used', 'tool', 'succeeded', 'failed'],
    },
    {
        id: 'MEMORY',
        label: 'Memory',
        icon: Cpu,
        color: 'text-purple-300',
        bg: 'bg-purple-900/20',
        border: 'border-purple-500/40',
        keywords: ['archive', 'memoryType'],
        contentKeywords: ['committing to memory', "archiving", "memory archive", "long-term"],
    },
    {
        id: 'MOOD',
        label: 'Mood Shift',
        icon: Heart,
        color: 'text-rose-300',
        bg: 'bg-rose-900/20',
        border: 'border-rose-500/40',
        keywords: ['MOOD_CHANGE', 'emotionalTransition'],
        contentKeywords: ['mood shift', "feeling", "was neutral", "emotional"],
    },
    {
        id: 'CONNECTION',
        label: 'Connection',
        icon: Activity,
        color: 'text-green-300',
        bg: 'bg-green-900/20',
        border: 'border-green-500/40',
        keywords: ['CONNECTION_LOST', 'CONNECTION_RESTORED'],
        contentKeywords: ['connection', 'back online', 'lost contact', 'restored'],
    },
    {
        id: 'SECURITY',
        label: 'Security',
        icon: Shield,
        color: 'text-red-300',
        bg: 'bg-red-900/20',
        border: 'border-red-500/40',
        keywords: ['SECURITY_ALERT'],
        contentKeywords: ['security', 'alert', 'anomaly', 'intrusion'],
    },
    {
        id: 'HEALING',
        label: 'Self-Healing',
        icon: AlertTriangle,
        color: 'text-amber-300',
        bg: 'bg-amber-900/20',
        border: 'border-amber-500/40',
        keywords: ['ERROR_RECOVERED', 'resilience'],
        contentKeywords: ['self-healing', 'recovered from', 'self-corrected'],
    },
    {
        id: 'WORKFLOW',
        label: 'Workflow',
        icon: Clock,
        color: 'text-sky-300',
        bg: 'bg-sky-900/20',
        border: 'border-sky-500/40',
        keywords: ['WORKFLOW_UPDATE'],
        contentKeywords: ['workflow', 'task', 'status'],
    },
    {
        id: 'THOUGHT',
        label: 'Thought',
        icon: Brain,
        color: 'text-slate-400',
        bg: 'bg-slate-900/30',
        border: 'border-slate-700/40',
        keywords: [],
        contentKeywords: [], // Catch-all for unmatched events
    },
];

const ALL_CATEGORY_IDS = CATEGORIES.map(c => c.id);

// ─── Classifier ───────────────────────────────────────────────────────────────
function classifyEvent(payload: any): EventCategory {
    const meta = payload.metadata || {};
    const content = (payload.content || '').toLowerCase();
    const eventType = (meta.eventType || '').toLowerCase();
    const discoveryType = (meta.discoveryType || '').toLowerCase();
    const evolutionType = (meta.evolutionType || '').toLowerCase();

    for (const cat of CATEGORIES) {
        if (cat.id === 'THOUGHT') continue; // Skip catch-all

        // Check metadata keywords
        const metaMatch = cat.keywords.some(kw =>
            eventType.includes(kw.toLowerCase()) ||
            discoveryType.includes(kw.toLowerCase()) ||
            evolutionType.includes(kw.toLowerCase()) ||
            Object.keys(meta).some(k => k.toLowerCase() === kw.toLowerCase())
        );

        // Check content keywords
        const contentMatch = cat.contentKeywords?.some(kw => content.includes(kw.toLowerCase()));

        // Check minCoherence if specified
        const coOk = cat.minCoherence == null || payload.coherence >= cat.minCoherence;

        if ((metaMatch || contentMatch) && coOk) return cat.id;
    }

    return 'THOUGHT';
}

// ─── Source Colors ────────────────────────────────────────────────────────────
const SOURCE_STYLES: Record<string, { dot: string; label: string }> = {
    CONSCIOUS: { dot: 'bg-cyan-400', label: 'CONSCIOUS' },
    SUBCONSCIOUS: { dot: 'bg-pink-400', label: 'SUBCONSC' },
    AGENCY: { dot: 'bg-orange-400', label: 'AGENCY' },
    UNCONSCIOUS: { dot: 'bg-slate-500', label: 'UNCON' },
};

// ─── Coherence Bar ────────────────────────────────────────────────────────────
const CoherenceBar: React.FC<{ value: number }> = ({ value }) => {
    const pct = Math.round(value * 100);
    const color = pct >= 90 ? 'bg-yellow-400' : pct >= 70 ? 'bg-cyan-400' : pct >= 50 ? 'bg-blue-400' : 'bg-slate-600';
    return (
        <div className="flex items-center gap-1 shrink-0" title={`Coherence: ${pct}%`}>
            <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[9px] text-slate-500 font-mono">{pct}%</span>
        </div>
    );
};

// ─── Single Event Card ────────────────────────────────────────────────────────
const EventCard: React.FC<{ event: FeedEvent; catDef: CategoryDef }> = React.memo(({ event, catDef }) => {
    const [expanded, setExpanded] = useState(false);
    const Icon = catDef.icon;
    const src = SOURCE_STYLES[event.source] || SOURCE_STYLES.UNCONSCIOUS;

    return (
        <div
            className={`
                group relative rounded-lg border px-3 py-2 cursor-pointer transition-all duration-200
                ${catDef.bg} ${catDef.border}
                ${event.isHighlighted ? catDef.glow || '' : ''}
                hover:brightness-110
            `}
            onClick={() => setExpanded(e => !e)}
        >
            {/* Top row */}
            <div className="flex items-start gap-2">
                {/* Category icon */}
                <div className={`mt-0.5 shrink-0 ${catDef.color}`}>
                    <Icon size={12} />
                </div>

                {/* Content */}
                <p className={`flex-1 text-[11px] leading-snug font-mono text-slate-200 ${expanded ? '' : 'line-clamp-2'}`}>
                    {event.content}
                </p>

                {/* Expand indicator */}
                <ChevronDown
                    size={12}
                    className={`shrink-0 text-slate-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
            </div>

            {/* Bottom row */}
            <div className="flex items-center justify-between mt-1.5 gap-2">
                <div className="flex items-center gap-2">
                    {/* Category badge */}
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${catDef.bg} ${catDef.color} border ${catDef.border}`}>
                        {catDef.label.toUpperCase()}
                    </span>
                    {/* Source dot */}
                    <div className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${src.dot}`} />
                        <span className="text-[9px] text-slate-500 font-mono">{src.label}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <CoherenceBar value={event.coherence} />
                    <span className="text-[9px] text-slate-600 font-mono shrink-0">
                        {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                </div>
            </div>

            {/* Expanded metadata */}
            {expanded && event.metadata && Object.keys(event.metadata).length > 0 && (
                <div className="mt-2 border-t border-white/5 pt-2 text-[9px] font-mono text-slate-500 space-y-0.5">
                    {Object.entries(event.metadata)
                        .filter(([k]) => !['narratedBy'].includes(k))
                        .slice(0, 5)
                        .map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                                <span className="text-slate-600 shrink-0">{k}:</span>
                                <span className="text-slate-400 truncate">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                            </div>
                        ))
                    }
                </div>
            )}
        </div>
    );
});

// ─── Main Component ───────────────────────────────────────────────────────────
interface DiscoveriesFeedProps {
    maxEvents?: number;
    className?: string;
}

const DiscoveriesFeed: React.FC<DiscoveriesFeedProps> = ({
    maxEvents = 200,
    className = '',
}) => {
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [activeFilters, setActiveFilters] = useState<Set<EventCategory>>(new Set(ALL_CATEGORY_IDS));
    const [sourceFilters, setSourceFilters] = useState<Set<string>>(new Set(['CONSCIOUS', 'SUBCONSCIOUS', 'AGENCY', 'UNCONSCIOUS']));
    const [minCoherence, setMinCoherence] = useState(0);
    const [search, setSearch] = useState('');
    const [paused, setPaused] = useState(false);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const pausedRef = useRef(false);
    const pendingRef = useRef<FeedEvent[]>([]);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Keep paused ref in sync
    useEffect(() => { pausedRef.current = paused; }, [paused]);

    // Flush pending events when unpausing
    useEffect(() => {
        if (!paused && pendingRef.current.length > 0) {
            setEvents(prev => {
                const merged = [...pendingRef.current, ...prev];
                pendingRef.current = [];
                return merged.slice(0, maxEvents);
            });
        }
    }, [paused, maxEvents]);

    // Subscribe to narrative stream
    useEffect(() => {
        const unsub = systemBus.subscribe(SystemProtocol.NARRATIVE_UPDATE, (event) => {
            if (!event.payload) return;
            const p = event.payload;

            const category = classifyEvent(p);
            const catDef = CATEGORIES.find(c => c.id === category)!;

            const feedEvent: FeedEvent = {
                id: p.id || crypto.randomUUID(),
                timestamp: p.timestamp || Date.now(),
                source: p.source || 'CONSCIOUS',
                content: p.content || '',
                coherence: p.coherence ?? 0.5,
                metadata: p.metadata,
                category,
                isHighlighted: category !== 'THOUGHT' && (p.coherence ?? 0) >= 0.8,
            };

            if (pausedRef.current) {
                pendingRef.current = [feedEvent, ...pendingRef.current].slice(0, 50);
            } else {
                setEvents(prev => [feedEvent, ...prev].slice(0, maxEvents));
            }
        });

        return () => unsub();
    }, [maxEvents]);

    // Filter + search logic
    const filtered = events.filter(e => {
        if (!activeFilters.has(e.category)) return false;
        if (!sourceFilters.has(e.source)) return false;
        if (e.coherence < minCoherence) return false;
        if (search.trim()) {
            const s = search.toLowerCase();
            if (!e.content.toLowerCase().includes(s)) return false;
        }
        return true;
    });

    // Category toggle
    const toggleCategory = useCallback((id: EventCategory) => {
        setActiveFilters(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const toggleSource = useCallback((src: string) => {
        setSourceFilters(prev => {
            const next = new Set(prev);
            if (next.has(src)) next.delete(src); else next.add(src);
            return next;
        });
    }, []);

    const selectAll = () => setActiveFilters(new Set(ALL_CATEGORY_IDS));
    const clearAll = () => setActiveFilters(new Set());

    // High-priority categories (top of filter panel)
    const priorityCategories = CATEGORIES.filter(c => ['EUREKA', 'DISCOVERY', 'SERENDIPITY', 'INTUITION', 'EVOLUTION', 'SKILL'].includes(c.id));
    const systemCategories = CATEGORIES.filter(c => !['EUREKA', 'DISCOVERY', 'SERENDIPITY', 'INTUITION', 'EVOLUTION', 'SKILL'].includes(c.id));

    return (
        <div className={`flex flex-col h-full bg-slate-950 rounded-xl border border-slate-800/60 overflow-hidden ${className}`}>
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-black/20 shrink-0">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                        <Sparkles size={14} className="text-yellow-400" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-white tracking-tight">Event Stream</h2>
                        <p className="text-[9px] text-slate-500 font-mono">
                            {filtered.length} / {events.length} events
                            {paused && <span className="ml-2 text-amber-400 animate-pulse">● PAUSED</span>}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Search bar */}
                    <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1">
                        <Search size={10} className="text-slate-500" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search..."
                            className="bg-transparent outline-none text-[10px] text-slate-300 placeholder-slate-600 w-24"
                        />
                    </div>

                    {/* Pause / Resume */}
                    <button
                        onClick={() => setPaused(p => !p)}
                        className={`p-1.5 rounded-lg border transition-colors ${paused
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                            : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-white'}`}
                        title={paused ? 'Resume' : 'Pause'}
                    >
                        {paused ? <Play size={12} /> : <Pause size={12} />}
                    </button>

                    {/* Filter toggle */}
                    <button
                        onClick={() => setShowFilterPanel(p => !p)}
                        className={`p-1.5 rounded-lg border transition-colors ${showFilterPanel
                            ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                            : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-white'}`}
                        title="Filters"
                    >
                        <Filter size={12} />
                    </button>

                    {/* Clear all */}
                    <button
                        onClick={() => setEvents([])}
                        className="p-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-500 hover:text-red-400 transition-colors"
                        title="Clear all events"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            {/* ── Filter Panel ── */}
            {showFilterPanel && (
                <div className="px-4 py-3 border-b border-white/5 bg-black/30 space-y-3 shrink-0">
                    {/* Category filters */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">Discoveries & Insights</span>
                            <div className="flex gap-2">
                                <button onClick={selectAll} className="text-[9px] text-cyan-400 hover:underline">All</button>
                                <button onClick={clearAll} className="text-[9px] text-slate-500 hover:underline">None</button>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {priorityCategories.map(cat => {
                                const Icon = cat.icon;
                                const active = activeFilters.has(cat.id);
                                return (
                                    <button
                                        key={cat.id}
                                        onClick={() => toggleCategory(cat.id)}
                                        className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-all ${active
                                            ? `${cat.bg} ${cat.border} ${cat.color}`
                                            : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}
                                    >
                                        <Icon size={10} />
                                        {cat.label}
                                    </button>
                                );
                            })}
                        </div>

                        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest block pt-1">System Events</span>
                        <div className="flex flex-wrap gap-1">
                            {systemCategories.map(cat => {
                                const Icon = cat.icon;
                                const active = activeFilters.has(cat.id);
                                return (
                                    <button
                                        key={cat.id}
                                        onClick={() => toggleCategory(cat.id)}
                                        className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-all ${active
                                            ? `${cat.bg} ${cat.border} ${cat.color}`
                                            : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}
                                    >
                                        <Icon size={10} />
                                        {cat.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Source filters */}
                    <div>
                        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest block mb-1">Source</span>
                        <div className="flex gap-2">
                            {Object.entries(SOURCE_STYLES).map(([src, s]) => (
                                <button
                                    key={src}
                                    onClick={() => toggleSource(src)}
                                    className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-all ${sourceFilters.has(src)
                                        ? 'bg-slate-800 border-slate-600 text-slate-200'
                                        : 'bg-slate-900/40 border-slate-800 text-slate-600'}`}
                                >
                                    <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                                    {src}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Coherence slider */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">Min Coherence</span>
                            <span className="text-[10px] text-cyan-400 font-mono">{Math.round(minCoherence * 100)}%</span>
                        </div>
                        <input
                            type="range" min={0} max={1} step={0.05}
                            value={minCoherence}
                            onChange={e => setMinCoherence(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>
                </div>
            )}

            {/* ── Category pill summary (always visible) ── */}
            <div className="flex gap-1.5 px-4 py-2 overflow-x-auto shrink-0 border-b border-white/5 bg-black/10 custom-scrollbar">
                {CATEGORIES.filter(c => activeFilters.has(c.id)).map(cat => {
                    const count = filtered.filter(e => e.category === cat.id).length;
                    if (count === 0) return null;
                    const Icon = cat.icon;
                    return (
                        <button
                            key={cat.id}
                            onClick={() => toggleCategory(cat.id)}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] shrink-0 ${cat.bg} ${cat.border} ${cat.color} hover:brightness-125 transition-all`}
                        >
                            <Icon size={9} />
                            {cat.label} <span className="opacity-60">({count})</span>
                        </button>
                    );
                })}
                {filtered.length === 0 && (
                    <span className="text-[10px] text-slate-600 font-mono italic">No events match current filters</span>
                )}
            </div>

            {/* ── Events List ── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 p-3">
                {filtered.length === 0 && events.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center opacity-40 py-16">
                        <Sparkles size={32} className="text-yellow-400 mb-3" />
                        <p className="text-sm text-slate-400 font-mono">EVENT STREAM IDLE</p>
                        <p className="text-[10px] text-slate-600 mt-1">Waiting for neural events...</p>
                    </div>
                )}
                {filtered.map(event => {
                    const catDef = CATEGORIES.find(c => c.id === event.category) || CATEGORIES[CATEGORIES.length - 1];
                    return <EventCard key={event.id} event={event} catDef={catDef} />;
                })}
                <div ref={bottomRef} />
            </div>
        </div>
    );
};

export default DiscoveriesFeed;
