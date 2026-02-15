/**
 * ContextBudgetPanel.tsx - PA-041
 * ================================
 * Visual control panel for Context Priority System.
 * Displays token budget, priority allocations, and allows preset switching.
 * 
 * Follows Silhouette design patterns from CostSimulator and HealthMonitor.
 */

import React, { useState, useEffect } from 'react';
import { Layers, Gauge, Zap, Settings2, ChevronDown, CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '../utils/api';

// Types matching backend
interface TokenBudgetConfig {
    totalBudget: number;
    reservedForResponse: number;
    priorityAllocations: Record<number, number>;
}

interface ContextMetrics {
    totalTokensUsed: number;
    availableBudget: number;
    usagePercent: number;
    itemCount: number;
    truncatedItems: number;
    byPriority: Record<string, { items: number; tokens: number; truncated: number }>;
}

interface ContextItem {
    key: string;
    priority: string;
    tokens: number;
    truncated: boolean;
    originalLength: number;
}

// Priority labels and colors
const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
    IMMEDIATE: { label: 'User Input', color: 'text-red-400', icon: '🎯' },
    ATTACHED: { label: 'Attachments', color: 'text-orange-400', icon: '📎' },
    CONVERSATION: { label: 'Chat History', color: 'text-yellow-400', icon: '💬' },
    MEMORY: { label: 'Memory', color: 'text-green-400', icon: '🧠' },
    SYSTEM: { label: 'System', color: 'text-blue-400', icon: '⚙️' },
    GRAPH: { label: 'Graph', color: 'text-purple-400', icon: '🔗' },
    CODEBASE: { label: 'Codebase', color: 'text-pink-400', icon: '📁' }
};

const PRESETS = [
    { id: 'eco', label: 'ECO', budget: '16K', description: 'Conservar API limits', color: 'bg-green-500' },
    { id: 'balanced', label: 'BALANCED', budget: '32K', description: 'Uso diario normal', color: 'bg-cyan-500' },
    { id: 'high', label: 'HIGH', budget: '64K', description: 'Tareas complejas', color: 'bg-orange-500' },
    { id: 'ultra', label: 'ULTRA', budget: '128K', description: 'Análisis profundo', color: 'bg-red-500' }
];

export const ContextBudgetPanel: React.FC = () => {
    const [budget, setBudget] = useState<TokenBudgetConfig | null>(null);
    const [metrics, setMetrics] = useState<ContextMetrics | null>(null);
    const [items, setItems] = useState<ContextItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activePreset, setActivePreset] = useState<string>('balanced');
    const [showDetails, setShowDetails] = useState(false);
    const [applyingPreset, setApplyingPreset] = useState<string | null>(null);

    // Fetch initial data and poll for updates
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch budget config
                const budgetRes = await api.get<any>('/v1/context/budget');
                if (budgetRes.success) {
                    setBudget(budgetRes.budget);
                    // Detect active preset based on budget
                    const preset = PRESETS.find(p => {
                        const budgetK = budgetRes.budget.totalBudget / 1000;
                        return p.budget === `${budgetK}K`;
                    });
                    if (preset) setActivePreset(preset.id);
                }

                // Fetch metrics
                const metricsRes = await api.get<any>('/v1/context/metrics');
                if (metricsRes.success) {
                    setMetrics(metricsRes.metrics);
                    setItems(metricsRes.items || []);
                }

                setIsLoading(false);
            } catch (e) {
                console.error('[ContextBudgetPanel] Error fetching data:', e);
                setIsLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, []);

    const handleApplyPreset = async (presetId: string) => {
        setApplyingPreset(presetId);
        try {
            const res = await api.post<any>(`/v1/context/presets/${presetId}`, {});
            if (res.success) {
                setBudget(res.budget);
                setActivePreset(presetId);
            }
        } catch (e) {
            console.error('[ContextBudgetPanel] Error applying preset:', e);
        }
        setApplyingPreset(null);
    };

    if (isLoading) {
        return (
            <div className="glass-panel rounded-xl p-6 border border-cyan-500/30 bg-cyan-900/10 animate-pulse">
                <div className="h-4 bg-slate-700 rounded w-1/3 mb-4"></div>
                <div className="h-20 bg-slate-700 rounded"></div>
            </div>
        );
    }

    const usagePercent = metrics?.usagePercent || 0;
    const isHighUsage = usagePercent > 80;

    return (
        <div className="glass-panel rounded-xl p-6 border border-cyan-500/30 bg-cyan-900/10">
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                    <Layers className="text-cyan-400" />
                    Context Priority
                </h2>
                <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                    <Settings2 size={14} />
                    {showDetails ? 'Hide' : 'Details'}
                    <ChevronDown size={14} className={`transition-transform ${showDetails ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* Usage Gauge */}
            <div className="bg-black/40 p-4 rounded-lg border border-cyan-900/50 mb-4">
                <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                        <Gauge className="text-cyan-400" size={16} />
                        <span className="text-xs text-slate-400 uppercase">Token Budget Usage</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {isHighUsage ? (
                            <AlertCircle size={14} className="text-orange-400" />
                        ) : (
                            <CheckCircle size={14} className="text-emerald-400" />
                        )}
                        <span className={`text-sm font-mono font-bold ${isHighUsage ? 'text-orange-400' : 'text-emerald-400'}`}>
                            {usagePercent}%
                        </span>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-500 ${usagePercent > 90 ? 'bg-red-500' :
                                usagePercent > 70 ? 'bg-orange-500' :
                                    'bg-gradient-to-r from-cyan-500 to-emerald-500'
                            }`}
                        style={{ width: `${usagePercent}%` }}
                    />
                </div>

                {/* Stats */}
                <div className="flex justify-between mt-2 text-[10px] text-slate-500">
                    <span>{metrics?.totalTokensUsed?.toLocaleString() || 0} tokens used</span>
                    <span>{metrics?.availableBudget?.toLocaleString() || 0} available</span>
                </div>
                {metrics && metrics.truncatedItems > 0 && (
                    <div className="mt-2 text-[10px] text-orange-400 flex items-center gap-1">
                        <AlertCircle size={10} />
                        {metrics.truncatedItems} item(s) truncated to fit budget
                    </div>
                )}
            </div>

            {/* Preset Selector */}
            <div className="mb-4">
                <label className="text-[10px] text-slate-400 uppercase mb-2 block flex items-center gap-2">
                    <Zap size={10} className="text-yellow-400" />
                    Quick Presets
                </label>
                <div className="grid grid-cols-4 gap-2">
                    {PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => handleApplyPreset(preset.id)}
                            disabled={applyingPreset !== null}
                            className={`relative p-2 rounded-lg border transition-all ${activePreset === preset.id
                                    ? 'border-cyan-400 bg-cyan-500/20'
                                    : 'border-slate-700 bg-black/40 hover:border-slate-500'
                                } ${applyingPreset === preset.id ? 'animate-pulse' : ''}`}
                        >
                            {activePreset === preset.id && (
                                <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${preset.color}`} />
                            )}
                            <div className="text-xs font-bold text-white">{preset.label}</div>
                            <div className="text-[10px] text-cyan-400 font-mono">{preset.budget}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Details Panel (Expandable) */}
            {showDetails && (
                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800 animate-fadeIn">
                    <div className="text-[10px] text-slate-400 uppercase mb-3 flex items-center gap-2">
                        <Layers size={10} />
                        Priority Breakdown
                    </div>

                    <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                        {metrics?.byPriority && Object.entries(metrics.byPriority).map(([priority, data]) => {
                            const config = PRIORITY_CONFIG[priority] || { label: priority, color: 'text-slate-400', icon: '📌' };
                            const tokenPercent = metrics.availableBudget > 0
                                ? Math.round((data.tokens / metrics.availableBudget) * 100)
                                : 0;

                            return (
                                <div key={priority} className="flex items-center justify-between bg-black/40 p-2 rounded border border-white/5">
                                    <div className="flex items-center gap-2">
                                        <span>{config.icon}</span>
                                        <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                                        {data.truncated > 0 && (
                                            <span className="text-[9px] text-orange-400 bg-orange-500/20 px-1 rounded">
                                                {data.truncated} truncated
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${config.color.replace('text-', 'bg-')}`}
                                                style={{ width: `${Math.min(100, tokenPercent)}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] text-slate-400 font-mono w-16 text-right">
                                            {data.tokens.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}

                        {(!metrics?.byPriority || Object.keys(metrics.byPriority).length === 0) && (
                            <div className="text-[10px] text-slate-600 italic text-center py-4">
                                No context data yet. Send a message to see priority breakdown.
                            </div>
                        )}
                    </div>

                    {/* Current Budget Info */}
                    {budget && (
                        <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 gap-4">
                            <div className="text-center">
                                <div className="text-[10px] text-slate-500 uppercase">Total Budget</div>
                                <div className="text-lg font-mono font-bold text-white">
                                    {(budget.totalBudget / 1000).toFixed(0)}K
                                </div>
                            </div>
                            <div className="text-center">
                                <div className="text-[10px] text-slate-500 uppercase">Reserved for Response</div>
                                <div className="text-lg font-mono font-bold text-cyan-400">
                                    {(budget.reservedForResponse / 1000).toFixed(0)}K
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ContextBudgetPanel;
