/**
 * PR NOTIFICATION BADGE
 * ═══════════════════════════════════════════════════════════════
 * Shows a badge when there are pending PRs from Silhouette.
 * Polls the backend periodically for new PRs.
 */

import React, { useState, useEffect } from 'react';
import { GitPullRequest, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../utils/api';

interface PendingPR {
    number: number;
    title: string;
    url: string;
    ciStatus: string;
    filesChanged: number;
}

interface PRNotificationProps {
    onOpenPR?: (prNumber: number) => void;
}

const PRNotification: React.FC<PRNotificationProps> = ({ onOpenPR }) => {
    const [pendingPRs, setPendingPRs] = useState<PendingPR[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isIngesting, setIsIngesting] = useState<number | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    // Poll for pending PRs
    useEffect(() => {
        const fetchPRs = async () => {
            try {
                const response = await api.get<{ success: boolean; prs: PendingPR[] }>(
                    '/v1/self-evolution/pending-prs'
                );
                if (response.success) {
                    setPendingPRs(response.prs);
                }
            } catch (error) {
                console.error('[PR_NOTIFICATION] Error fetching PRs:', error);
            }
        };

        fetchPRs();
        const interval = setInterval(fetchPRs, 60000); // Poll every minute

        return () => clearInterval(interval);
    }, []);

    const handleIngestPR = async (prNumber: number) => {
        setIsIngesting(prNumber);
        try {
            const response = await api.post<{ success: boolean; projectId: string }>(
                `/v1/self-evolution/ingest/${prNumber}`,
                {}
            );
            if (response.success) {
                onOpenPR?.(prNumber);
                setIsExpanded(false);
            }
        } catch (error) {
            console.error('[PR_NOTIFICATION] Error ingesting PR:', error);
        } finally {
            setIsIngesting(null);
        }
    };

    if (pendingPRs.length === 0) return null;

    return (
        <div className="relative">
            {/* Badge Button */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="relative flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-600/20 to-cyan-600/20 hover:from-purple-600/30 hover:to-cyan-600/30 border border-purple-500/30 rounded-lg transition-all group"
            >
                <GitPullRequest size={16} className="text-purple-400" />
                <span className="text-xs font-medium text-purple-300 group-hover:text-white">
                    Silhouette quiere modificar su código
                </span>

                {/* Count Badge */}
                <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-purple-500 text-white text-[10px] font-bold rounded-full animate-pulse">
                    {pendingPRs.length}
                </span>
            </button>

            {/* Dropdown */}
            {isExpanded && (
                <div className="absolute top-full left-0 mt-2 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-in slide-in-from-top-2">
                    <div className="p-3 bg-slate-950 border-b border-slate-800">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                            <GitPullRequest size={14} className="text-purple-400" />
                            Pull Requests Pendientes
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Silhouette ha creado cambios para tu revisión
                        </p>
                    </div>

                    <div className="max-h-60 overflow-y-auto">
                        {pendingPRs.map((pr) => (
                            <div
                                key={pr.number}
                                className="p-3 border-b border-slate-800 last:border-0 hover:bg-slate-800/50 transition-colors"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <h5 className="text-sm font-medium text-white truncate">
                                            #{pr.number}: {pr.title}
                                        </h5>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {pr.filesChanged} archivo(s) modificado(s)
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${pr.ciStatus === 'success'
                                                ? 'bg-green-500/20 text-green-400'
                                                : pr.ciStatus === 'failure'
                                                    ? 'bg-red-500/20 text-red-400'
                                                    : 'bg-yellow-500/20 text-yellow-400'
                                                }`}>
                                                {pr.ciStatus === 'success' ? '✅ CI Passed' :
                                                    pr.ciStatus === 'failure' ? '❌ CI Failed' : '⏳ CI Running'}
                                            </span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => handleIngestPR(pr.number)}
                                        disabled={isIngesting === pr.number}
                                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-cyan-400 hover:text-white bg-cyan-900/30 hover:bg-cyan-800/50 rounded transition-colors disabled:opacity-50"
                                    >
                                        {isIngesting === pr.number ? (
                                            <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                            <>
                                                Revisar
                                                <ArrowRight size={12} />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PRNotification;
