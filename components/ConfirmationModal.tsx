/**
 * CONFIRMATION MODAL
 * 
 * Human-in-the-Loop UI component for approving/rejecting critical actions.
 * Displays pending confirmations from ActionExecutor and allows user response.
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, Check, X, Clock, ShieldAlert, FileWarning, Terminal, Globe } from 'lucide-react';
import { api } from '../utils/api';

interface PendingConfirmation {
    id: string;
    action: {
        type: string;
        agentId: string;
        payload: any;
    };
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    reason: string;
    expiresAt: number;
}

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose }) => {
    const [confirmations, setConfirmations] = useState<PendingConfirmation[]>([]);
    const [loading, setLoading] = useState(false);

    // Fetch pending confirmations
    const fetchConfirmations = async () => {
        try {
            const res = await api.get('/v1/autonomy/confirmations') as any;
            if (res.success) {
                setConfirmations(res.confirmations || []);
            }
        } catch (e) {
            console.error('[CONFIRMATION] Failed to fetch:', e);
        }
    };

    // Poll for new confirmations
    useEffect(() => {
        if (isOpen) {
            fetchConfirmations();
            const interval = setInterval(fetchConfirmations, 3000);
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    const handleApprove = async (id: string) => {
        setLoading(true);
        try {
            await api.post(`/v1/autonomy/confirmations/${id}/approve`, {});
            setConfirmations(prev => prev.filter(c => c.id !== id));
        } catch (e) {
            console.error('[CONFIRMATION] Approve failed:', e);
        }
        setLoading(false);
    };

    const handleReject = async (id: string) => {
        setLoading(true);
        try {
            await api.post(`/v1/autonomy/confirmations/${id}/reject`, {});
            setConfirmations(prev => prev.filter(c => c.id !== id));
        } catch (e) {
            console.error('[CONFIRMATION] Reject failed:', e);
        }
        setLoading(false);
    };

    const getRiskColor = (level: string) => {
        switch (level) {
            case 'CRITICAL': return 'text-red-500 bg-red-500/10 border-red-500/30';
            case 'HIGH': return 'text-orange-500 bg-orange-500/10 border-orange-500/30';
            case 'MEDIUM': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30';
            default: return 'text-green-500 bg-green-500/10 border-green-500/30';
        }
    };

    const getActionIcon = (type: string) => {
        if (type.includes('FILE') || type.includes('WRITE')) return <FileWarning size={16} />;
        if (type.includes('COMMAND') || type.includes('SHELL')) return <Terminal size={16} />;
        if (type.includes('HTTP') || type.includes('REQUEST')) return <Globe size={16} />;
        return <ShieldAlert size={16} />;
    };

    const formatTimeRemaining = (expiresAt: number) => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) return 'Expired';
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-500/10">
                            <ShieldAlert className="text-amber-400" size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Action Confirmations</h2>
                            <p className="text-xs text-slate-400">
                                {confirmations.length} pending approval{confirmations.length !== 1 ? 's' : ''}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 overflow-y-auto max-h-[60vh] custom-scrollbar space-y-3">
                    {confirmations.length === 0 ? (
                        <div className="text-center py-12">
                            <Check className="mx-auto text-green-500 mb-3" size={40} />
                            <p className="text-slate-400 text-sm">No pending confirmations</p>
                            <p className="text-slate-500 text-xs mt-1">All actions are running smoothly</p>
                        </div>
                    ) : (
                        confirmations.map(conf => (
                            <div
                                key={conf.id}
                                className={`p-4 rounded-xl border ${getRiskColor(conf.riskLevel)} transition-all hover:scale-[1.01]`}
                            >
                                {/* Risk Badge */}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        {getActionIcon(conf.action.type)}
                                        <span className="text-xs font-bold uppercase">
                                            {conf.riskLevel} RISK
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 text-slate-400 text-xs">
                                        <Clock size={12} />
                                        {formatTimeRemaining(conf.expiresAt)}
                                    </div>
                                </div>

                                {/* Action Details */}
                                <div className="mb-3">
                                    <p className="text-white font-medium text-sm">{conf.reason}</p>
                                    <p className="text-slate-500 text-xs mt-1">
                                        Agent: <span className="text-slate-300">{conf.action.agentId}</span>
                                        {' • '}
                                        Type: <span className="text-slate-300">{conf.action.type}</span>
                                    </p>
                                </div>

                                {/* Payload Preview */}
                                {conf.action.payload && (
                                    <div className="bg-black/30 rounded p-2 mb-3 font-mono text-xs text-slate-400 overflow-x-auto">
                                        {JSON.stringify(conf.action.payload, null, 2).slice(0, 200)}
                                        {JSON.stringify(conf.action.payload).length > 200 && '...'}
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleApprove(conf.id)}
                                        disabled={loading}
                                        className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                                    >
                                        <Check size={14} />
                                        APPROVE
                                    </button>
                                    <button
                                        onClick={() => handleReject(conf.id)}
                                        disabled={loading}
                                        className="flex-1 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                                    >
                                        <X size={14} />
                                        REJECT
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-between items-center">
                    <p className="text-xs text-slate-500">
                        Actions expire after 5 minutes and are auto-rejected
                    </p>
                    <button
                        onClick={fetchConfirmations}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold transition-colors"
                    >
                        REFRESH
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
