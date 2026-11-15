import React, { useState, useEffect } from 'react';
import { CloudLightning, AlertTriangle, DollarSign, Activity } from 'lucide-react';
import { CostMetrics } from '../types';
import { api } from '../utils/api';

const PRICING_2025 = {
    'gemini-3-pro': { input: 2.00, output: 12.00 }, // per 1M tokens
    'gpt-4o': { input: 2.50, output: 10.00 },
    'claude-3-7-sonnet': { input: 3.00, output: 15.00 }
};

interface CostSimulatorProps {
    metrics?: CostMetrics;
}

export const CostSimulator: React.FC<CostSimulatorProps> = ({ metrics: initialMetrics }) => {
    const [metrics, setMetrics] = useState<any>(initialMetrics);
    const [mode, setMode] = useState<'SIMULATOR' | 'MONITOR'>('MONITOR');

    // Fetch real metrics from server
    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                const data = await api.get<any>('/v1/system/costs');
                setMetrics(data);
            } catch (e) {
                console.error("Failed to fetch costs", e);
            }
        };

        fetchMetrics();
        const interval = setInterval(fetchMetrics, 5000); // Poll every 5s
        return () => clearInterval(interval);
    }, []);
    const [budgetLimit, setBudgetLimit] = useState<number>(50.00); // Default $50 limit

    // Simulator State
    const [autonomyLevel, setAutonomyLevel] = useState('24/7');
    const [tasksPerHour, setTasksPerHour] = useState(10);
    const [selectedModel, setSelectedModel] = useState<'gemini-3-pro' | 'gpt-4o' | 'claude-3-7-sonnet'>('gemini-3-pro');

    const calculateMonthlyCost = () => {
        const hoursPerMonth = autonomyLevel === '24/7' ? 720 : 160;
        const totalTasks = hoursPerMonth * tasksPerHour;
        const inputTokens = totalTasks * 2000;
        const outputTokens = totalTasks * 500;
        const costInput = (inputTokens / 1000000) * PRICING_2025[selectedModel].input;
        const costOutput = (outputTokens / 1000000) * PRICING_2025[selectedModel].output;
        return (costInput + costOutput).toFixed(2);
    };

    const currentCost = metrics?.totalCost || 0;
    const isOverBudget = currentCost >= budgetLimit;
    const usagePercent = Math.min(100, (currentCost / budgetLimit) * 100);

    // Sort models by cost for the breakdown
    const modelBreakdown = metrics?.modelBreakdown || {};
    const sortedModels = Object.entries(modelBreakdown as any).sort(([, a]: any, [, b]: any) => b.cost - a.cost);

    return (
        <div className="glass-panel rounded-xl p-6 border border-emerald-500/30 bg-emerald-900/10">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                    <CloudLightning className="text-emerald-400" />
                    {mode === 'MONITOR' ? 'Real-Time Cost Monitor' : 'Cost Simulator'}
                </h2>
                <div className="flex bg-slate-900 rounded p-1 border border-slate-700">
                    <button
                        onClick={() => setMode('MONITOR')}
                        className={`px-3 py-1 text-[10px] font-bold rounded ${mode === 'MONITOR' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        MONITOR
                    </button>
                    <button
                        onClick={() => setMode('SIMULATOR')}
                        className={`px-3 py-1 text-[10px] font-bold rounded ${mode === 'SIMULATOR' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        SIMULATOR
                    </button>
                </div>
            </div>

            {mode === 'MONITOR' ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-black/40 p-3 rounded border border-emerald-900/50">
                            <div className="text-[10px] text-slate-400 uppercase mb-1">Total Spend (Real)</div>
                            <div className="text-2xl font-mono font-bold text-white flex items-center gap-1">
                                <span className="text-emerald-500">$</span>{currentCost.toFixed(5)}
                            </div>
                            <div className="text-[9px] text-slate-500 mt-1">Session: ${metrics?.sessionCost?.toFixed(5) || '0.00000'}</div>
                        </div>
                        <div className="bg-black/40 p-3 rounded border border-emerald-900/50">
                            <div className="text-[10px] text-slate-400 uppercase mb-1">Total Tokens</div>
                            <div className="text-xl font-mono font-bold text-white">
                                {(metrics?.totalTokens || 0).toLocaleString()} <span className="text-xs text-slate-500">TKS</span>
                            </div>
                            <div className="flex gap-2 mt-1 text-[9px]">
                                <span className="text-blue-400">IN: {(metrics?.inputTokens || 0).toLocaleString()}</span>
                                <span className="text-purple-400">OUT: {(metrics?.outputTokens || 0).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    {/* Model Breakdown */}
                    <div className="bg-slate-900/50 p-3 rounded border border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase mb-2 flex items-center gap-2">
                            <Activity size={10} /> Model Breakdown
                        </div>
                        <div className="space-y-2 max-h-[100px] overflow-y-auto pr-1 custom-scrollbar">
                            {sortedModels.length > 0 ? sortedModels.map(([modelId, usageRaw]) => {
                                const usage = usageRaw as any;
                                let usageDisplay = "";
                                if (usage.images > 0) usageDisplay = `${usage.images} imgs`;
                                else if (usage.seconds > 0) usageDisplay = `${usage.seconds}s video`;
                                else if (usage.requests > 0) usageDisplay = `${usage.requests} reqs`;
                                else usageDisplay = `${(usage.inputTokens + usage.outputTokens).toLocaleString()} tks`;

                                return (
                                    <div key={modelId} className="flex justify-between items-center text-xs border-b border-slate-800 pb-1 last:border-0">
                                        <div>
                                            <span className="text-cyan-400 font-mono">{modelId}</span>
                                            <div className="text-[9px] text-slate-500">
                                                {usageDisplay}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-emerald-400 font-mono">${usage.cost.toFixed(5)}</span>
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div className="text-[10px] text-slate-600 italic text-center py-2">No usage data yet.</div>
                            )}
                        </div>
                    </div>

                    {/* Budget Control */}
                    <div className="bg-slate-900/50 p-3 rounded border border-slate-800">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs text-slate-300 font-bold flex items-center gap-2">
                                <DollarSign size={12} className="text-yellow-500" /> Budget Limit
                            </label>
                            <input
                                type="number"
                                value={budgetLimit}
                                onChange={(e) => setBudgetLimit(parseFloat(e.target.value))}
                                className="w-20 bg-black border border-slate-700 rounded px-2 py-1 text-right text-xs text-white"
                            />
                        </div>
                        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-500 ${isOverBudget ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`}
                                style={{ width: `${usagePercent}%` }}
                            />
                        </div>
                        <div className="flex justify-between mt-1">
                            <span className="text-[9px] text-slate-500">0%</span>
                            {isOverBudget && <span className="text-[9px] text-red-400 font-bold flex items-center gap-1"><AlertTriangle size={8} /> LIMIT REACHED</span>}
                            <span className="text-[9px] text-slate-500">100%</span>
                        </div>
                    </div>
                </div>
            ) : (
                // SIMULATOR MODE
                <>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-[10px] text-slate-400 mb-1 uppercase">AI Model</label>
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value as any)}
                                className="w-full bg-black border border-slate-700 rounded p-2 text-xs text-white"
                            >
                                <option value="gemini-3-pro">Gemini 3 Pro (High Cost)</option>
                                <option value="gpt-4o">GPT-4o (Benchmark)</option>
                                <option value="claude-3-7-sonnet">Claude 3.7 Sonnet</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] text-slate-400 mb-1 uppercase">Autonomy Level</label>
                            <select
                                value={autonomyLevel}
                                onChange={(e) => setAutonomyLevel(e.target.value)}
                                className="w-full bg-black border border-slate-700 rounded p-2 text-xs text-white"
                            >
                                <option value="24/7">God Mode (24/7)</option>
                                <option value="business-hours">Office Mode (8h M-F)</option>
                            </select>
                        </div>
                    </div>

                    <div className="bg-black/50 p-4 rounded border border-emerald-900 flex justify-between items-center">
                        <div>
                            <p className="text-sm text-slate-400">Est. Monthly Cost</p>
                            <p className="text-[10px] text-slate-600">Based on {tasksPerHour} tasks/hr</p>
                        </div>
                        <div className="text-2xl font-mono font-bold text-emerald-400">
                            ${calculateMonthlyCost()} <span className="text-xs text-slate-500">USD</span>
                        </div>
                    </div>

                    <p className="mt-4 text-[10px] text-slate-500 italic">
                        *Includes automated context cleaning (The Janitor) to minimize token waste.
                    </p>
                </>
            )}
        </div>
    );
};
