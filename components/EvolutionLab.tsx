import React, { useState, useEffect } from 'react';
import { Agent, AgentCategory } from '../types';
import { api } from '../utils/api';
import { Dna, RefreshCw, Zap, CheckCircle2, AlertTriangle, TrendingUp } from 'lucide-react';

interface EvolutionLabProps {
    agents: Agent[];
}

interface AgentHealth {
    agentId: string;
    agentName: string;
    score: number;
    lastEvolved?: number;
    improvements?: string[];
}

export const EvolutionLab: React.FC<EvolutionLabProps> = ({ agents }) => {
    const [healthData, setHealthData] = useState<AgentHealth[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [evolutionLog, setEvolutionLog] = useState<string[]>([]);
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

    // Fetch health scores for agents
    const fetchHealthScores = async () => {
        setIsLoading(true);
        try {
            // In production, this would call an API endpoint
            // For now, we simulate with placeholder data
            const mockData: AgentHealth[] = agents.slice(0, 10).map(a => ({
                agentId: a.id,
                agentName: a.name,
                score: Math.floor(Math.random() * 40) + 60, // 60-100 simulated
            }));
            setHealthData(mockData);
        } catch (error) {
            console.error('[EvolutionLab] Failed to fetch health:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchHealthScores();
    }, [agents]);

    const handleEvolve = async (agentId: string) => {
        setSelectedAgent(agentId);
        setEvolutionLog(prev => [...prev, `🧬 Requesting evolution for ${agentId}...`]);

        try {
            const result = await api.post<{ success: boolean; previousScore?: number; newScore?: number }>(
                `/v1/orchestrator/evolve/${agentId}`, {}
            );

            if (result.success) {
                setEvolutionLog(prev => [
                    ...prev,
                    `✅ ${agentId} evolved! Score: ${result.previousScore} → ${result.newScore}`
                ]);
                // Refresh health data
                await fetchHealthScores();
            } else {
                setEvolutionLog(prev => [...prev, `ℹ️ ${agentId}: Evolution not needed or already optimized.`]);
            }
        } catch (error: any) {
            setEvolutionLog(prev => [...prev, `❌ Failed to evolve ${agentId}: ${error.message}`]);
        } finally {
            setSelectedAgent(null);
        }
    };

    const handleEvolveAll = async () => {
        const underperformers = healthData.filter(h => h.score < 70);
        setEvolutionLog(prev => [...prev, `🔬 Starting batch evolution for ${underperformers.length} underperformers...`]);

        for (const agent of underperformers) {
            await handleEvolve(agent.agentId);
        }

        setEvolutionLog(prev => [...prev, `✅ Batch evolution complete.`]);
    };

    const getScoreColor = (score: number): string => {
        if (score >= 90) return 'text-green-400';
        if (score >= 70) return 'text-yellow-400';
        return 'text-red-400';
    };

    const getScoreBg = (score: number): string => {
        if (score >= 90) return 'bg-green-900/20 border-green-500/30';
        if (score >= 70) return 'bg-yellow-900/20 border-yellow-500/30';
        return 'bg-red-900/20 border-red-500/30';
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-900/30 rounded-lg">
                        <Dna className="text-purple-400" size={24} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white">Evolution Lab</h2>
                        <p className="text-xs text-slate-400">Autonomous Agent Improvement System</p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={fetchHealthScores}
                        disabled={isLoading}
                        className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs flex items-center gap-2 hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                    <button
                        onClick={handleEvolveAll}
                        className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs flex items-center gap-2 hover:bg-purple-500 transition-colors"
                    >
                        <Zap size={12} />
                        Evolve All Underperformers
                    </button>
                </div>
            </div>

            {/* Agent Health Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {healthData.map(agent => (
                    <div
                        key={agent.agentId}
                        className={`p-3 rounded-lg border ${getScoreBg(agent.score)} cursor-pointer hover:scale-105 transition-transform`}
                        onClick={() => handleEvolve(agent.agentId)}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-white font-medium truncate max-w-[100px]">
                                {agent.agentName}
                            </span>
                            {selectedAgent === agent.agentId ? (
                                <RefreshCw size={12} className="text-purple-400 animate-spin" />
                            ) : agent.score >= 90 ? (
                                <CheckCircle2 size={12} className="text-green-400" />
                            ) : agent.score < 70 ? (
                                <AlertTriangle size={12} className="text-red-400" />
                            ) : (
                                <TrendingUp size={12} className="text-yellow-400" />
                            )}
                        </div>
                        <div className={`text-2xl font-mono font-bold ${getScoreColor(agent.score)}`}>
                            {agent.score}
                        </div>
                        <div className="text-[9px] text-slate-500 mt-1">HEALTH SCORE</div>
                    </div>
                ))}
            </div>

            {/* Evolution Log */}
            <div className="glass-panel p-4 rounded-xl">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <Dna size={14} className="text-purple-400" />
                    Evolution Log
                </h3>
                <div className="bg-black/50 rounded-lg p-3 h-48 overflow-y-auto custom-scrollbar font-mono text-xs">
                    {evolutionLog.length === 0 ? (
                        <p className="text-slate-500">No evolution events yet. Click an agent to evolve it.</p>
                    ) : (
                        evolutionLog.map((log, idx) => (
                            <p key={idx} className="text-slate-300 py-0.5">{log}</p>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default EvolutionLab;
