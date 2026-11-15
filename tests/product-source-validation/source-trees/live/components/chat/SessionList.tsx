import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Trash2, MoreHorizontal, Edit2, Check, X } from 'lucide-react';
import { ChatSession } from '../../types';

interface SessionListProps {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, newTitle: string) => void;
}

export const SessionList: React.FC<SessionListProps> = ({ sessions, activeSessionId, onSelect, onDelete, onRename }) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpenId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleStartEdit = (session: ChatSession, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(session.id);
        setEditValue(session.title);
        setMenuOpenId(null);
    };

    const handleSaveEdit = (id: string) => {
        if (editValue.trim()) {
            onRename(id, editValue.trim());
        }
        setEditingId(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
        if (e.key === 'Enter') handleSaveEdit(id);
        if (e.key === 'Escape') setEditingId(null);
    };

    const confirmDelete = () => {
        if (deletingId) {
            onDelete(deletingId);
            setDeletingId(null);
            setMenuOpenId(null);
        }
    };

    // Time Grouping Logic
    const groupedSessions = sessions.reduce((groups, session) => {
        const date = new Date(session.lastUpdated);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        let group = 'Older';
        if (diffDays === 0) group = 'Today';
        else if (diffDays === 1) group = 'Yesterday';
        else if (diffDays <= 7) group = 'Previous 7 Days';
        else if (diffDays <= 30) group = 'Previous 30 Days';

        if (!groups[group]) groups[group] = [];
        groups[group].push(session);
        return groups;
    }, {} as Record<string, ChatSession[]>);

    const groupOrder = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'];

    return (
        <>
            <div className="flex-1 overflow-y-auto p-2 space-y-4 custom-scrollbar">
                {groupOrder.map(group => {
                    const groupSessions = groupedSessions[group];
                    if (!groupSessions || groupSessions.length === 0) return null;

                    return (
                        <div key={group}>
                            <div className="text-[10px] font-bold text-slate-500 uppercase px-2 mb-1 tracking-wider">
                                {group}
                            </div>
                            <div className="space-y-0.5">
                                {groupSessions.map(s => (
                                    <div
                                        key={s.id}
                                        className={`group relative w-full text-left p-2 rounded-md text-xs transition-all duration-200 
                                            ${activeSessionId === s.id
                                                ? 'bg-cyan-900/40 text-cyan-100 shadow-sm border border-cyan-800/30'
                                                : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                                            }`}
                                    >
                                        {editingId === s.id ? (
                                            <div className="flex items-center gap-1 animate-in fade-in zoom-in-95 duration-150">
                                                <input
                                                    autoFocus
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onKeyDown={(e) => handleKeyDown(e, s.id)}
                                                    onBlur={() => handleSaveEdit(s.id)}
                                                    className="flex-1 bg-slate-950 border border-cyan-700 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                                />
                                                <button onClick={() => handleSaveEdit(s.id)} className="text-green-400 hover:text-green-300"><Check size={14} /></button>
                                                <button onClick={() => setEditingId(null)} className="text-red-400 hover:text-red-300"><X size={14} /></button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between" onClick={() => onSelect(s.id)}>
                                                <div className="flex-1 min-w-0 cursor-pointer">
                                                    <div className="font-medium truncate pr-6">{s.title}</div>
                                                </div>

                                                {/* Kebab Menu Trigger */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setMenuOpenId(menuOpenId === s.id ? null : s.id);
                                                    }}
                                                    className={`p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity ${menuOpenId === s.id ? 'opacity-100 bg-slate-700 text-white' : ''}`}
                                                >
                                                    <MoreHorizontal size={14} />
                                                </button>

                                                {/* Dropdown Menu */}
                                                {menuOpenId === s.id && (
                                                    <div
                                                        ref={menuRef}
                                                        className="absolute right-0 top-8 z-50 w-32 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2"
                                                    >
                                                        <button
                                                            onClick={(e) => handleStartEdit(s, e)}
                                                            className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"
                                                        >
                                                            <Edit2 size={12} /> Rename
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setDeletingId(s.id);
                                                                // Don't close menu immediately, let modal handle it or close it here?
                                                                // Closing menu here is fine as modal will appear.
                                                                setMenuOpenId(null);
                                                            }}
                                                            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300 flex items-center gap-2 border-t border-slate-800"
                                                        >
                                                            <Trash2 size={12} /> Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Custom Delete Confirmation Modal */}
            {deletingId && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 w-80 max-w-full animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center space-y-4">
                            <div className="p-3 bg-red-500/10 rounded-full text-red-500">
                                <Trash2 size={24} />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-white">Delete Chat?</h3>
                                <p className="text-sm text-slate-400 mt-1">
                                    This action cannot be undone.
                                </p>
                            </div>
                            <div className="flex gap-3 w-full pt-2">
                                <button
                                    onClick={() => setDeletingId(null)}
                                    className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-red-900/20"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
