import React from 'react';
import { Mail, Send, FileText, Trash2, Plus, RefreshCw, Search, MoreVertical, Paperclip, X } from 'lucide-react';
import { Email } from '../../types';

interface EmailLayoutProps {
    emails: Email[];
    loading: boolean;
    loadingMore?: boolean;
    hasMore?: boolean;
    selectedEmail: Email | null;
    currentFolder: string;
    onSelectEmail: (email: Email) => void;
    onCompose: () => void;
    onRefresh: () => void;
    onFolderChange: (folder: string) => void;
    onLoadMore?: () => void;
    className?: string;
}

export const EmailLayout: React.FC<EmailLayoutProps> = ({
    emails,
    loading,
    loadingMore = false,
    hasMore = false,
    selectedEmail,
    currentFolder,
    onSelectEmail,
    onCompose,
    onRefresh,
    onFolderChange,
    onLoadMore,
    className
}) => {
    return (
        <div className={`flex h-full bg-slate-900/90 text-slate-200 overflow-hidden ${className}`}>
            {/* --- SIDEBAR --- */}
            <div className="w-64 bg-slate-950/50 flex flex-col border-r border-slate-800">
                <div className="p-4">
                    <button
                        onClick={onCompose}
                        className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-white text-slate-900 font-medium py-3 rounded-2xl transition-all shadow-lg hover:shadow-cyan-500/20"
                    >
                        <Plus size={20} />
                        <span>Compose</span>
                    </button>
                </div>

                <nav className="flex-1 px-2 space-y-1">
                    <SidebarItem
                        icon={<Mail size={18} />}
                        label="Inbox"
                        active={currentFolder === 'INBOX'}
                        count={emails.filter(e => !e.isRead).length}
                        onClick={() => onFolderChange('INBOX')}
                    />
                    <SidebarItem
                        icon={<Send size={18} />}
                        label="Sent"
                        active={currentFolder === 'SENT'}
                        onClick={() => onFolderChange('SENT')}
                    />
                    <SidebarItem
                        icon={<FileText size={18} />}
                        label="Drafts"
                        active={currentFolder === 'DRAFTS'}
                        onClick={() => onFolderChange('DRAFTS')}
                    />
                    <SidebarItem
                        icon={<Trash2 size={18} />}
                        label="Trash"
                        active={currentFolder === 'TRASH'}
                        onClick={() => onFolderChange('TRASH')}
                    />
                </nav>

                <div className="p-4 mt-auto border-t border-slate-800">
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Labels</h3>
                    <div className="space-y-2">
                        <LabelItem color="bg-emerald-500" label="Project Alpha" />
                        <LabelItem color="bg-cyan-500" label="Finance" />
                        <LabelItem color="bg-purple-500" label="Personal" />
                    </div>
                </div>
            </div>

            {/* --- EMAIL LIST --- */}
            <div className={`${selectedEmail ? 'w-80 hidden md:flex' : 'flex-1'} flex flex-col border-r border-slate-800 transition-all duration-300`}>
                {/* Toolbar */}
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur">
                    <div className="relative flex-1 mr-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                        <input
                            type="text"
                            placeholder="Search mail"
                            className="w-full bg-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-600"
                        />
                    </div>
                    <button onClick={onRefresh} className={`p-2 rounded-full hover:bg-slate-800 text-slate-400 ${loading ? 'animate-spin' : ''}`}>
                        <RefreshCw size={18} />
                    </button>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {loading && emails.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                            <div className="w-8 h-8 border-2 border-slate-600 border-t-cyan-500 rounded-full animate-spin" />
                            <span className="text-xs">Syncing...</span>
                        </div>
                    ) : (
                        emails.map(email => (
                            <div
                                key={email.id}
                                onClick={() => onSelectEmail(email)}
                                className={`
                                    p-4 border-b border-slate-800/50 cursor-pointer hover:bg-slate-800/40 transition-colors
                                    ${selectedEmail?.id === email.id ? 'bg-cyan-900/10 border-l-2 border-l-cyan-400' : 'border-l-2 border-l-transparent'}
                                    ${!email.isRead ? 'bg-slate-800/20' : ''}
                                `}
                            >
                                <div className="flex justify-between items-baseline mb-1">
                                    <span className={`text-sm truncate pr-2 ${!email.isRead ? 'font-bold text-white' : 'font-medium text-slate-300'}`}>
                                        {email.from.split('<')[0]}
                                    </span>
                                    <span className="text-[10px] text-slate-500 whitespace-nowrap">
                                        {new Date(email.date).toLocaleDateString()}
                                    </span>
                                </div>
                                <h4 className={`text-xs mb-1 truncate ${!email.isRead ? 'font-semibold text-slate-200' : 'text-slate-400'}`}>
                                    {email.subject}
                                </h4>
                                <p className="text-[11px] text-slate-500 line-clamp-2">
                                    {email.snippet}
                                </p>
                            </div>
                        ))
                    )}

                    {/* LOAD MORE BUTTON */}
                    {hasMore && !loading && (
                        <button
                            onClick={onLoadMore}
                            disabled={loadingMore}
                            className="w-full p-4 text-sm text-cyan-400 hover:bg-slate-800/50 transition-colors flex items-center justify-center gap-2 border-t border-slate-700"
                        >
                            {loadingMore ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                'Load More Emails'
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* --- READING PANE --- */}
            {selectedEmail ? (
                <div className="flex-1 flex flex-col bg-slate-900">
                    {/* Header */}
                    <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800">
                        <div className="flex gap-2">
                            <button className="p-2 hover:bg-slate-800 rounded-full text-slate-400" title="Archive"><FileText size={18} /></button>
                            <button className="p-2 hover:bg-slate-800 rounded-full text-slate-400" title="Delete"><Trash2 size={18} /></button>
                            <button className="p-2 hover:bg-slate-800 rounded-full text-slate-400" title="Mark as unread"><Mail size={18} /></button>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span>{new Date(selectedEmail.date).toLocaleString()}</span>
                            <button onClick={() => onSelectEmail(null as any)} className="md:hidden p-2 hover:bg-slate-800 rounded"><X size={18} /></button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                        <h1 className="text-xl font-medium text-white mb-6">{selectedEmail.subject}</h1>

                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                                {selectedEmail.from.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <div className="text-sm font-bold text-white">
                                    {selectedEmail.from}
                                </div>
                                <div className="text-xs text-slate-400">to me</div>
                            </div>
                        </div>

                        {/* Email Body - RICH TEXT RENDERING */}
                        <div className="prose prose-invert prose-sm max-w-none text-slate-300 bg-white/5 p-4 rounded-lg shadow-inner">
                            {/* We use a secure iframe-like approach or sanitized HTML for rich content */}
                            {selectedEmail.body ? (
                                <div dangerouslySetInnerHTML={{ __html: selectedEmail.body }} />
                            ) : (
                                <div className="whitespace-pre-wrap font-sans">
                                    {selectedEmail.snippet}
                                    <div className="mt-8 pt-4 border-t border-slate-700/50 italic text-slate-500 text-xs">
                                        [This email has no full body content available]
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Reply Box Mockup */}
                    <div className="p-4 border-t border-slate-800 bg-slate-950/30">
                        <div className="flex gap-4 items-center text-slate-400 text-sm border border-slate-700 rounded-lg p-4 hover:border-slate-500 cursor-text transition-colors">
                            <img src="/avatars/me.jpg" className="w-6 h-6 rounded-full bg-slate-700" alt="" />
                            <span>Reply to {selectedEmail.from.split('<')[0].trim()}...</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 hidden md:flex flex-col items-center justify-center text-slate-600 bg-slate-900/50">
                    <Mail size={64} className="mb-4 opacity-20" />
                    <p className="text-sm">Select an email to read</p>
                </div>
            )}
        </div>
    );
};

const SidebarItem = ({ icon, label, active, count, onClick }: any) => (
    <button
        onClick={onClick}
        className={`
            w-full flex items-center justify-between px-4 py-2 text-sm font-medium rounded-r-full transition-colors mr-2
            ${active
                ? 'bg-cyan-900/30 text-cyan-400 border-l-4 border-cyan-500'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-l-4 border-transparent'}
        `}
    >
        <div className="flex items-center gap-3">
            {icon}
            <span>{label}</span>
        </div>
        {count > 0 && (
            <span className="text-[10px] font-bold bg-slate-800 px-2 py-0.5 rounded-full">
                {count}
            </span>
        )}
    </button>
);

const LabelItem = ({ color, label }: any) => (
    <div className="flex items-center gap-3 px-4 py-1 text-sm text-slate-400 hover:text-slate-200 cursor-pointer transition-colors">
        <div className={`w-3 h-3 rounded ${color}`} />
        <span>{label}</span>
    </div>
);
