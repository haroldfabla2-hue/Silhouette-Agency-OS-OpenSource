/**
 * PR TOOLBAR COMPONENT
 * ═══════════════════════════════════════════════════════════════
 * Special toolbar that appears when viewing a PR_REVIEW project.
 * Provides actions to approve, reject, or ask questions about the PR.
 */

import React, { useState } from 'react';
import { CheckCircle, XCircle, MessageCircle, ExternalLink, GitPullRequest, Loader2 } from 'lucide-react';
import { api } from '../utils/api';

interface PRToolbarProps {
    projectName: string;
    prNumber: number;
    ciStatus: 'success' | 'failure' | 'pending' | 'unknown';
    prUrl: string;
    onApproved?: () => void;
    onRejected?: () => void;
}

const PRToolbar: React.FC<PRToolbarProps> = ({
    projectName,
    prNumber,
    ciStatus,
    prUrl,
    onApproved,
    onRejected
}) => {
    const [isApproving, setIsApproving] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);
    const [showRejectDialog, setShowRejectDialog] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleApprove = async () => {
        if (!confirm('¿Estás seguro de aprobar y mergear este PR?')) return;

        setIsApproving(true);
        setMessage(null);

        try {
            const response = await api.post<{ success: boolean; message: string }>(
                `/v1/self-evolution/approve/${prNumber}`,
                {}
            );

            if (response.success) {
                setMessage({ type: 'success', text: response.message });
                onApproved?.();
            } else {
                setMessage({ type: 'error', text: response.message });
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'Error al aprobar PR' });
        } finally {
            setIsApproving(false);
        }
    };

    const handleReject = async () => {
        setIsRejecting(true);
        setMessage(null);

        try {
            const response = await api.post<{ success: boolean; message: string }>(
                `/v1/self-evolution/reject/${prNumber}`,
                { reason: rejectReason }
            );

            if (response.success) {
                setMessage({ type: 'success', text: response.message });
                setShowRejectDialog(false);
                onRejected?.();
            } else {
                setMessage({ type: 'error', text: response.message });
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'Error al rechazar PR' });
        } finally {
            setIsRejecting(false);
        }
    };

    const ciStatusConfig = {
        success: { icon: '✅', color: 'text-green-400', bg: 'bg-green-500/10', label: 'CI Passed' },
        failure: { icon: '❌', color: 'text-red-400', bg: 'bg-red-500/10', label: 'CI Failed' },
        pending: { icon: '⏳', color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'CI Running' },
        unknown: { icon: '❓', color: 'text-slate-400', bg: 'bg-slate-500/10', label: 'CI Unknown' }
    };

    const status = ciStatusConfig[ciStatus];

    return (
        <div className="bg-gradient-to-r from-purple-900/20 via-cyan-900/20 to-purple-900/20 border-b border-cyan-500/30 p-3">
            <div className="flex items-center justify-between gap-4">
                {/* Left: PR Info */}
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
                        <GitPullRequest size={20} className="text-purple-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            Auto-Modificación #{prNumber}
                            <span className={`text-xs px-2 py-0.5 rounded ${status.bg} ${status.color}`}>
                                {status.icon} {status.label}
                            </span>
                        </h3>
                        <p className="text-xs text-slate-400 truncate max-w-xs">
                            {projectName}
                        </p>
                    </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2">
                    {/* View on GitHub */}
                    <a
                        href={prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/50 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
                    >
                        <ExternalLink size={14} />
                        GitHub
                    </a>

                    {/* Ask Question */}
                    <button
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:text-white bg-cyan-900/30 hover:bg-cyan-800/50 rounded-lg transition-colors border border-cyan-500/30"
                        title="Pregunta a Silhouette sobre este cambio"
                    >
                        <MessageCircle size={14} />
                        Preguntar
                    </button>

                    {/* Reject */}
                    <button
                        onClick={() => setShowRejectDialog(true)}
                        disabled={isRejecting || isApproving}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 hover:text-white bg-red-900/30 hover:bg-red-800/50 rounded-lg transition-colors border border-red-500/30 disabled:opacity-50"
                    >
                        {isRejecting ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                        Rechazar
                    </button>

                    {/* Approve */}
                    <button
                        onClick={handleApprove}
                        disabled={isApproving || isRejecting || ciStatus !== 'success'}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-lg transition-colors shadow-lg shadow-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={ciStatus !== 'success' ? 'El CI debe pasar antes de aprobar' : 'Aprobar y mergear este PR'}
                    >
                        {isApproving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        Aprobar y Mergear
                    </button>
                </div>
            </div>

            {/* Message */}
            {message && (
                <div className={`mt-2 px-3 py-2 rounded text-xs ${message.type === 'success'
                    ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                    : 'bg-red-500/10 text-red-400 border border-red-500/30'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Reject Dialog */}
            {showRejectDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full m-4 shadow-2xl">
                        <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <XCircle className="text-red-400" size={20} />
                            Rechazar PR #{prNumber}
                        </h4>
                        <p className="text-slate-400 text-sm mb-4">
                            Proporciona una razón para rechazar este cambio. Silhouette aprenderá de esta retroalimentación.
                        </p>
                        <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Razón del rechazo (opcional)..."
                            className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white text-sm resize-none focus:outline-none focus:border-cyan-500"
                        />
                        <div className="flex justify-end gap-2 mt-4">
                            <button
                                onClick={() => setShowRejectDialog(false)}
                                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleReject}
                                disabled={isRejecting}
                                className="px-4 py-2 text-sm font-bold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-50"
                            >
                                {isRejecting ? 'Rechazando...' : 'Confirmar Rechazo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PRToolbar;
