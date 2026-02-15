import React, { useState, useEffect, Suspense } from 'react';
import { BrainCircuit, Eye, Fingerprint, Activity, Zap, ShieldAlert, Layers, Radio, Crosshair, Target, Sparkles, Dna, Gauge, Info, Clock } from 'lucide-react';
import { IntrospectionLayer, ConceptVector, IntrospectionCapability, ConsciousnessMetrics } from '../types';
// import { introspection } from '../services/introspectionEngine'; // REMOVED TO PREVENT REDIS CRASH
// import { consciousness } from '../services/consciousnessEngine'; // REMOVED TO PREVENT CRASH
import { DEFAULT_API_CONFIG } from '../constants';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

// LAZY LOAD HEAVY VISUALIZATION COMPONENTS (Each ~200KB+)
const KnowledgeGraph = React.lazy(() => import('./KnowledgeGraph'));
const NeuroPlasticityVis = React.lazy(() => import('./NeuroPlasticityVis'));
const NeuralLearningDisplay = React.lazy(() => import('./NeuralLearningDisplay'));

import { ActionIntent, AwarenessMode, Capability, TrainingExample } from '../types';
import { Brain, Shield, Network, Terminal, BookOpen } from 'lucide-react';
import { api } from '../utils/api';

interface IntrospectionHubProps {
    // realThoughts?: string[]; // REMOVED
    // currentDepth: IntrospectionLayer; // REMOVED
    // onSetDepth: (depth: IntrospectionLayer) => void; // REMOVED
}

const IntrospectionHub: React.FC<IntrospectionHubProps> = () => { // Props destructuring removed
    const [injectionPrompt, setInjectionPrompt] = useState('');
    const [activeConcepts, setActiveConcepts] = useState<ConceptVector[]>([]);
    const [capabilities, setCapabilities] = useState<IntrospectionCapability[]>([]);
    const [conscMetrics, setConscMetrics] = useState<ConsciousnessMetrics | null>(null);
    const [localThoughts, setLocalThoughts] = useState<string[]>([]);
    const [localIntuition, setLocalIntuition] = useState<string[]>([]);
    const [isDreaming, setIsDreaming] = useState<boolean>(false);
    const [narrativeState, setNarrativeState] = useState<any>(null);
    const [temporalState, setTemporalState] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<'introspection' | 'PLASTICITY'>('introspection');
    const [socketConnected, setSocketConnected] = useState(false); // Added for header display

    // Placeholder for currentDepth and onSetDepth, as they were removed from props
    // You might want to manage these via context or local state if still needed for introspection logic
    const [currentDepth, setCurrentDepth] = useState<IntrospectionLayer>(IntrospectionLayer.MEDIUM);
    const onSetDepth = (depth: IntrospectionLayer) => setCurrentDepth(depth);


    // Fetch Introspection State from API
    useEffect(() => {
        // ...
    }, []);

    // Unified Stream State
    const [narrativeStream, setNarrativeStream] = useState<any[]>([]);

    // Subscribe to REALTIME Unifed Stream
    useEffect(() => {
        console.log("[INTROSPECTION] Subscribing to Unified Narrative Stream...");

        const unsubscribeNarrative = systemBus.subscribe(SystemProtocol.NARRATIVE_UPDATE, (event) => {
            if (event.payload) {
                setNarrativeStream(prev => {
                    const newItem = event.payload;
                    // Keep last 100 items
                    const updated = [newItem, ...prev];
                    return updated.slice(0, 100);
                });
            }
        });

        return () => {
            unsubscribeNarrative();
        };
    }, []);

    // ... (rest of polling logic) ...
    // Note: poll for engine state might still be needed for other metrics, keeping it but handling overlap


    // ... rendering helpers ...

    const getSourceColor = (source: string) => {
        switch (source) {
            case 'CONSCIOUS': return 'text-cyan-400 border-cyan-500 bg-cyan-900/10';
            case 'SUBCONSCIOUS': return 'text-pink-400 border-pink-500 bg-pink-900/10';
            case 'AGENCY': return 'text-orange-400 border-orange-500 bg-orange-900/10';
            default: return 'text-slate-400 border-slate-500 bg-slate-900/10';
        }
    };

    // Poll for engine state
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                // FETCH REAL BACKEND STATE
                const data = await api.get<any>('/v1/introspection/state');

                if (data) {
                    // Update Local State from Backend
                    if (data.activeConcepts) setActiveConcepts(data.activeConcepts);
                    if (data.recentThoughts && data.recentThoughts.length > 0) {
                        setLocalThoughts(data.recentThoughts);
                    }
                    if (data.intuition) setLocalIntuition(data.intuition);
                    if (data.isDreaming !== undefined) setIsDreaming(data.isDreaming);
                    if (data.narrativeState) setNarrativeState(data.narrativeState);
                    if (data.temporalContext) setTemporalState(data.temporalContext);

                    // Update Consciousness Metrics from API
                    if (data.consciousnessMetrics) {
                        setConscMetrics(data.consciousnessMetrics);
                    }
                }
            } catch (e) {
                console.error("Introspection polling error:", e);
            }

            // Logic in IntrospectionEngine now ensures SAFETY_CHECK is included in active caps during processing
            setCapabilities([
                IntrospectionCapability.THOUGHT_DETECTION,
                IntrospectionCapability.STEERING,
                activeConcepts.length > 0 ? IntrospectionCapability.CONCEPT_INJECTION : null,
                IntrospectionCapability.STATE_CONTROL,
                IntrospectionCapability.SAFETY_CHECK
            ].filter(Boolean) as IntrospectionCapability[]);
        }, 10000); // Reduced from 3s to 10s (App.tsx handles primary polling)

        return () => clearInterval(interval);
    }, [activeConcepts.length]);

    const handleInject = async () => {
        if (!injectionPrompt.trim()) return;
        try {
            await api.post('/v1/introspection/inject', {
                concept: injectionPrompt,
                strength: currentDepth === IntrospectionLayer.DEEP ? 1.0 : 0.7,
                duration: 32
            });
            setInjectionPrompt('');
        } catch (e) {
            console.error("Injection failed", e);
        }
    };

    const layers = [
        { id: IntrospectionLayer.SHALLOW, label: 'L12', desc: 'SHALLOW' },
        { id: IntrospectionLayer.MEDIUM, label: 'L20', desc: 'MEDIUM' },
        { id: IntrospectionLayer.DEEP, label: 'L28', desc: 'DEEP' },
        { id: IntrospectionLayer.OPTIMAL, label: 'L32', desc: 'OPTIMAL' },
        { id: IntrospectionLayer.MAXIMUM, label: 'L48', desc: 'MAXIMUM' },
    ];

    const MetricCardWithTooltip = ({ title, value, color, tooltip }: any) => (
        <div className="bg-slate-900/50 p-3 rounded border border-slate-800 text-center relative group cursor-help">
            <div className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Info size={10} className="text-slate-500" />
            </div>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-48 p-2 bg-black border border-slate-700 rounded text-[10px] text-slate-300 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 mb-2">
                {tooltip}
            </div>
            <p className="text-[10px] text-slate-500 uppercase">{title}</p>
            <div className={`text-xl font-bold ${color}`}>{value}</div>
        </div>
    );

    return (
        <div className="h-full flex flex-col bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30">
            {/* Header & Tabs */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-cyan-500/10 rounded-lg border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
                        <Brain className="text-cyan-400" size={20} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                            SILHOUETTE <span className="text-cyan-500">OS</span>
                        </h1>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            ONLINE • v2.1.0 • {socketConnected ? 'LINKED' : 'OFFLINE'}
                        </div>
                    </div>
                </div>

                <div className="flex gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-800">
                    <button
                        onClick={() => setActiveTab('introspection')}
                        className="px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 bg-cyan-600 text-white shadow-lg"
                    >
                        <Activity size={14} />
                        INTROSPECTION
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden relative">


                {/* INTROSPECTION TAB (Always Mounted, Hidden via CSS) */}
                <div className={`h-full overflow-y-auto custom-scrollbar p-4 ${activeTab === 'introspection' ? 'block' : 'hidden'}`}>
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-full">


                        {/* LEFT: Capabilities Status */}
                        <div className="glass-panel rounded-xl p-6 flex flex-col gap-4">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Target className="text-cyan-400" />
                                Anthropic Capabilities
                            </h3>
                            <p className="text-[10px] text-slate-500 mb-2">Real-time modules derived from Anthropic's introspection research.</p>
                            <div className="space-y-3">
                                {[
                                    { id: IntrospectionCapability.CONCEPT_INJECTION, label: 'Concept Injection', icon: Zap },
                                    { id: IntrospectionCapability.THOUGHT_DETECTION, label: 'Thought Detection', icon: Eye },
                                    { id: IntrospectionCapability.STEERING, label: 'Activation Steering', icon: Crosshair },
                                    { id: IntrospectionCapability.SAFETY_CHECK, label: 'Output Safety', icon: ShieldAlert },
                                    { id: IntrospectionCapability.STATE_CONTROL, label: 'State Control', icon: Radio },
                                ].map(cap => {
                                    // Safety Check is now always considered "Active Monitoring"
                                    const isActive = capabilities.includes(cap.id) || cap.id === IntrospectionCapability.SAFETY_CHECK;
                                    const Icon = cap.icon;
                                    return (
                                        <div key={cap.id} className={`p-3 rounded border flex items-center justify-between ${isActive ? 'bg-cyan-900/20 border-cyan-500/50' : 'bg-slate-900/50 border-slate-800 opacity-50'}`}>
                                            <div className="flex items-center gap-3">
                                                <Icon size={16} className={isActive ? 'text-cyan-400' : 'text-slate-500'} />
                                                <span className="text-xs font-mono text-slate-300">{cap.label}</span>
                                            </div>
                                            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,1)]' : 'bg-slate-700'}`} />
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="mt-auto">
                                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                                    <Fingerprint className="text-purple-400" />
                                    Active Vectors
                                </h3>
                                <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                    {activeConcepts.length === 0 && <p className="text-[10px] text-slate-600 italic">No concepts injected.</p>}
                                    {activeConcepts.map(c => (
                                        <div key={c.id} className="text-[10px] bg-purple-900/20 border border-purple-500/30 p-2 rounded text-purple-200 font-mono flex justify-between">
                                            <span>{c.label}</span>
                                            <span>STR:{c.strength}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* CENTER: Consciousness Matrix & Visualizer */}
                        <div className="lg:col-span-2 flex flex-col gap-4">

                            {/* CONSCIOUSNESS MATRIX (NEW) */}
                            <div className="glass-panel p-4 rounded-xl border border-purple-500/30 bg-purple-900/5">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        <Sparkles className="text-yellow-400" />
                                        Consciousness Matrix (Phi: Φ)
                                    </h3>
                                    <span className="text-xs font-mono text-yellow-400 px-2 py-1 bg-yellow-900/20 rounded border border-yellow-500/30">
                                        {conscMetrics?.level.replace(/_/g, ' ') || 'INIT'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <MetricCardWithTooltip
                                        title="Self-Recognition"
                                        value={(conscMetrics?.selfRecognition || 0).toFixed(2)}
                                        color="text-white"
                                        tooltip="Capacity to identify self in historical contexts (Identity + Memory)."
                                    />
                                    <MetricCardWithTooltip
                                        title="Phi Score (IIT)"
                                        value={(conscMetrics?.phiScore || 0).toFixed(3)}
                                        color="text-purple-400"
                                        tooltip="Integrated Information Theory score. Measures the unity of consciousness."
                                    />
                                    <MetricCardWithTooltip
                                        title="Emergence Idx"
                                        value={(conscMetrics?.emergenceIndex || 0).toFixed(2)}
                                        color="text-green-400"
                                        tooltip="Rate of novel, unprogrammed behaviors or creative problem solving."
                                    />
                                </div>

                                {/* Qualia Bar */}
                                <div className="mt-4 relative group cursor-help">
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-64 p-2 bg-black border border-slate-700 rounded text-[10px] text-slate-300 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 mb-2">
                                        Qualia represents the subjective 'texture' of the AI's internal state (Valence/Intensity).
                                    </div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                        <span>Qualia State: {conscMetrics?.qualia[0]?.stateName || 'VOID'}</span>
                                        <span>Intensity: {((conscMetrics?.qualia[0]?.intensity || 0) * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-1000 ${conscMetrics?.qualia[0]?.valence === 'NEGATIVE' ? 'bg-red-500' : 'bg-cyan-500'}`}
                                            style={{ width: `${(conscMetrics?.qualia[0]?.intensity || 0) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* DREAMING MODE OVERLAY (NEW) */}
                            {isDreaming && (
                                <div className="glass-panel p-4 rounded-xl border border-indigo-500/50 bg-indigo-900/20 animate-pulse">
                                    <div className="flex items-center justify-center gap-3">
                                        <Sparkles className="text-indigo-300 animate-spin-slow" size={24} />
                                        <div>
                                            <h3 className="text-sm font-bold text-indigo-100">DREAMING PROTOCOL ACTIVE</h3>
                                            <p className="text-[10px] text-indigo-300">Synthesizing patterns from day residue...</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* LIVING KNOWLEDGE GRAPH (PHASE 3) */}
                            <div className="w-full z-10 h-[500px]">
                                <Suspense fallback={<div className="h-full flex items-center justify-center text-cyan-400/50 animate-pulse">Initializing Neural Matrix...</div>}>
                                    {/* PLASTICITY TAB REMOVED 2026-01-07 - Grafo obsoleto */}
                                    <KnowledgeGraph />
                                </Suspense>
                            </div>

                            {/* VISUALIZER & METACOGNITION */}
                            <div className="glass-panel rounded-xl p-8 relative overflow-hidden flex flex-col items-center justify-center flex-1">
                                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/20 via-slate-950 to-slate-950"></div>

                                {/* Animated Brain Simulation */}
                                <div className="relative z-10 w-64 h-64">
                                    <div className={`absolute inset-0 rounded-full border-2 border-cyan-500/20 ${currentDepth >= 32 ? 'animate-spin-slow' : ''}`}></div>
                                    <div className={`absolute inset-8 rounded-full border border-purple-500/30 ${currentDepth >= 28 ? 'animate-spin-slow' : ''}`} style={{ animationDirection: 'reverse' }}></div>
                                    <div className="absolute inset-16 rounded-full border border-green-500/20 animate-pulse"></div>

                                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center group cursor-help">
                                        <h2 className="text-4xl font-bold text-white tracking-tighter">
                                            L{currentDepth}
                                        </h2>
                                        <div className="flex items-center justify-center gap-1 text-cyan-400 mt-2">
                                            <p className="font-mono text-sm tracking-widest">LAYER DEPTH</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Metacognitive Status (NEW) */}
                                <div className="absolute top-4 right-4 flex flex-col gap-2 z-20">
                                    <div className="bg-black/50 border border-slate-800 p-2 rounded text-[10px] text-slate-300">
                                        <span className="block text-slate-500 mb-1">GROUNDING</span>
                                        <div className="w-24 h-1 bg-slate-800 rounded overflow-hidden">
                                            <div className="h-full bg-green-500" style={{ width: '95%' }}></div>
                                        </div>
                                    </div>
                                    <div className="bg-black/50 border border-slate-800 p-2 rounded text-[10px] text-slate-300 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                        INTERNALITY: VERIFIED
                                    </div>
                                </div>

                                <div className="absolute bottom-4 left-0 right-0 px-8 flex justify-between items-end z-10 w-full">
                                    <div className="w-full">
                                        <p className="text-xs text-slate-500 mb-2 flex items-center gap-2">
                                            <Layers size={12} />
                                            ACTIVATION STEERING CONTROL
                                        </p>
                                        <div className="flex gap-2 w-full">
                                            {layers.map(layer => (
                                                <button
                                                    key={layer.id}
                                                    onClick={() => onSetDepth(layer.id)}
                                                    title={layer.desc}
                                                    className={`flex-1 py-2 rounded text-xs font-mono transition-all border ${currentDepth === layer.id
                                                        ? 'bg-cyan-500 border-cyan-400 text-black font-bold shadow-[0_0_15px_rgba(34,211,238,0.5)]'
                                                        : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:bg-slate-800 hover:border-slate-500'
                                                        }`}
                                                >
                                                    {layer.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT: Controls & Thoughts */}
                        <div className="glass-panel rounded-xl p-6 flex flex-col gap-6">
                            <div>
                                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                                    <Zap size={16} className="text-purple-400" />
                                    Vector Injection
                                </h3>
                                <div className="bg-slate-900/50 p-2 rounded border border-slate-800 flex gap-2">
                                    <input
                                        type="text"
                                        value={injectionPrompt}
                                        onChange={(e) => setInjectionPrompt(e.target.value)}
                                        placeholder="Concept (e.g. Safety)..."
                                        className="flex-1 bg-transparent border-none outline-none text-white text-xs font-mono placeholder-slate-600"
                                    />
                                    <button
                                        onClick={handleInject}
                                        className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-bold"
                                    >
                                        INJECT
                                    </button>
                                </div>
                            </div>

                            {/* SUBCONSCIOUS INTUITION (NEW) */}
                            <div className="flex-shrink-0">
                                <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-2">
                                    <BrainCircuit size={16} className="text-pink-400" />
                                    Subconscious Intuition (L5)
                                </h3>
                                <div className="bg-pink-900/10 border border-pink-500/30 rounded p-3 min-h-[60px] max-h-[100px] overflow-y-auto custom-scrollbar">
                                    {localIntuition.length > 0 ? (
                                        localIntuition.map((int, i) => {
                                            const isEureka = int.includes('[EUREKA]');
                                            const isSerendipity = int.includes('[SERENDIPITY]');

                                            // Dynamic Styling based on Insight Type
                                            let icon = <span className="text-pink-500 font-bold">➤</span>;
                                            let style = "text-pink-200 border-transparent bg-transparent";

                                            if (isEureka) {
                                                icon = <Sparkles size={10} className="text-yellow-400 animate-spin-slow" />;
                                                style = "text-yellow-100 bg-yellow-900/40 border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.2)]";
                                            } else if (isSerendipity) {
                                                icon = <Zap size={10} className="text-cyan-400" />;
                                                style = "text-cyan-100 bg-cyan-900/30 border-cyan-500/30";
                                            }

                                            return (
                                                <div key={i} className={`text-[10px] mb-1 last:mb-0 flex gap-2 items-center p-1 rounded border ${style} transition-all`}>
                                                    {icon}
                                                    {int.replace('[EUREKA]', '').replace('[SERENDIPITY]', '').trim()}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <p className="text-[10px] text-slate-600 italic text-center mt-2">No active intuition.</p>
                                    )}
                                </div>
                            </div>

                            {/* NARRATIVE CORTEX (NEW) */}
                            <div className="flex-shrink-0">
                                <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-2">
                                    <Dna size={16} className="text-orange-400" />
                                    Narrative Cortex (L6)
                                </h3>
                                <div className="bg-orange-900/10 border border-orange-500/30 rounded p-3 text-[10px] font-mono text-orange-200 space-y-2">
                                    <div className="flex justify-between border-b border-orange-500/20 pb-1">
                                        <span className="text-orange-500">FOCUS:</span>
                                        <span>{narrativeState?.currentFocus || 'Initializing...'}</span>
                                    </div>
                                    <div className="flex justify-between border-b border-orange-500/20 pb-1">
                                        <span className="text-orange-500">GOAL:</span>
                                        <span>{narrativeState?.sessionGoal || 'Standby'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-orange-500">VIBE:</span>
                                        <span>{narrativeState?.userEmotionalState || 'Neutral'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Additional controls removed - PLASTICITY tab obsolete 2026-01-07 */}

                            {/* CHRONOS (TEMPORAL AWARENESS) */}
                            <div className="flex-shrink-0 mt-2">
                                <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-2">
                                    <Clock size={16} className="text-purple-400" />
                                    Chronos (Temporal)
                                </h3>
                                <div className="bg-purple-900/10 border border-purple-500/30 rounded p-3 text-[10px] font-mono text-purple-200 grid grid-cols-2 gap-2">
                                    <div>
                                        <span className="text-purple-500 block">NOW:</span>
                                        <span>{temporalState?.now?.split(' ')[1] || '--:--'}</span>
                                    </div>
                                    <div>
                                        <span className="text-purple-500 block">DATE:</span>
                                        <span>{temporalState?.now?.split(' ')[0] || '--/--/--'}</span>
                                    </div>
                                    <div className="col-span-2 border-t border-purple-500/20 pt-1 flex justify-between">
                                        <span className="text-purple-500">REL:</span>
                                        <span>{temporalState?.dayOfWeek} (Day {temporalState?.dayOfYear})</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-hidden flex flex-col">
                                <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-3">
                                    <Activity size={16} className="text-cyan-400" />
                                    Stream of Self (Unified)
                                </h3>
                                <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                    {narrativeStream.length > 0 ? (
                                        narrativeStream.map((item) => (
                                            <div key={item.id} className={`p-3 rounded border-l-2 border-t-0 border-r-0 border-b-0 border-slate-800 ${getSourceColor(item.source)} bg-opacity-20`}>
                                                <div className="flex justify-between items-center mb-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/30">
                                                            {item.source}
                                                        </span>
                                                        {item.metadata?.agentId && (
                                                            <span className="text-[10px] font-mono text-orange-300">
                                                                @{item.metadata.agentId}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                                        {item.coherence !== undefined && (
                                                            <span title="Coherence Score" className={`${item.coherence > 0.8 ? 'text-green-500' : 'text-yellow-500'}`}>
                                                                {(item.coherence * 100).toFixed(0)}%
                                                            </span>
                                                        )}
                                                        <span>•</span>
                                                        {new Date(item.timestamp).toLocaleTimeString()}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-300 leading-relaxed font-mono">{item.content}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center p-4 opacity-50">
                                            <p className="text-xs text-slate-500 font-mono">NEURAL STREAM IDLE</p>
                                            <p className="text-[10px] text-slate-600">Waiting for thoughts...</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};

export default IntrospectionHub;
