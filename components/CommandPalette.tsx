import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, File, Terminal, Zap, Command, ArrowRight, X } from 'lucide-react';
import { FileNode } from '../types';

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    files: FileNode[];
    onOpenFile: (fileId: string) => void;
    onRunCommand: (cmd: string) => void;
}

interface CommandOption {
    id: string;
    label: string;
    type: 'FILE' | 'COMMAND' | 'AI';
    icon: React.ReactNode;
    action: () => void;
    shortcut?: string;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, files, onOpenFile, onRunCommand }) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Flatten file tree for search
    const getAllFiles = (nodes: FileNode[]): FileNode[] => {
        let all: FileNode[] = [];
        for (const node of nodes) {
            if (node.type === 'FILE') all.push(node);
            if ((node as any).children) all = [...all, ...getAllFiles((node as any).children)];
        }
        return all;
    };

    const flatFiles = getAllFiles(files);

    // Generate Options based on query
    const options: CommandOption[] = [
        // 1. System Commands
        { id: 'save', label: 'Save File', type: 'COMMAND' as const, icon: <Command size={14} />, action: () => onRunCommand('save'), shortcut: 'Ctrl+S' },
        { id: 'format', label: 'Format Document', type: 'COMMAND' as const, icon: <Zap size={14} />, action: () => onRunCommand('format'), shortcut: 'Alt+F' },
        { id: 'terminal', label: 'Toggle Terminal', type: 'COMMAND' as const, icon: <Terminal size={14} />, action: () => onRunCommand('toggle_terminal'), shortcut: 'Ctrl+`' },

        // 2. Files (Filtered)
        ...flatFiles.map(f => ({
            id: f.id,
            label: f.name,
            type: 'FILE' as const,
            icon: <File size={14} />,
            action: () => onOpenFile(f.id)
        }))
    ].filter(opt => opt.label.toLowerCase().includes(query.toLowerCase()));

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % options.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => (prev - 1 + options.length) % options.length);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (options[selectedIndex]) {
                    options[selectedIndex].action();
                    onClose();
                }
            } else if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, options, selectedIndex, onClose]);

    // Auto-focus input
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
            setQuery('');
            setSelectedIndex(0);
        }
    }, [isOpen]);

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm" onClick={onClose}>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        transition={{ duration: 0.1 }}
                        className="w-[600px] max-w-[90vw] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Search Input */}
                        <div className="flex items-center px-4 py-3 border-b border-slate-800">
                            <Search className="text-slate-500 mr-3" size={18} />
                            <input
                                ref={inputRef}
                                type="text"
                                className="flex-1 bg-transparent text-white placeholder-slate-500 outline-none text-lg font-light"
                                placeholder="Type a command or search files..."
                                value={query}
                                onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                            />
                            <div className="flex gap-2">
                                <kbd className="hidden sm:inline-block px-2 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400 border border-slate-700">ESC</kbd>
                            </div>
                        </div>

                        {/* Results List */}
                        <div className="max-h-[300px] overflow-y-auto p-2 custom-scrollbar">
                            {options.length === 0 ? (
                                <div className="p-4 text-center text-slate-500 text-sm">No results found.</div>
                            ) : (
                                options.map((opt, index) => (
                                    <div
                                        key={opt.id}
                                        className={`
                                            flex items-center px-3 py-2 rounded-lg cursor-pointer transition-colors
                                            ${index === selectedIndex ? 'bg-cyan-900/30 text-cyan-100 border border-cyan-500/30' : 'text-slate-400 hover:bg-slate-800/50'}
                                        `}
                                        onClick={() => { opt.action(); onClose(); }}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <div className={`mr-3 p-1 rounded ${index === selectedIndex ? 'text-cyan-400' : 'text-slate-500'}`}>
                                            {opt.icon}
                                        </div>
                                        <span className="flex-1 text-sm">{opt.label}</span>
                                        {opt.shortcut && (
                                            <span className="text-[10px] opacity-50 font-mono bg-slate-950/50 px-1.5 py-0.5 rounded">{opt.shortcut}</span>
                                        )}
                                        {index === selectedIndex && <ArrowRight size={14} className="ml-2 opacity-50" />}
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between">
                            <span>Silhouette Studio v1.0</span>
                            <div className="flex gap-3">
                                <span><strong className="text-slate-400">↑↓</strong> to navigate</span>
                                <span><strong className="text-slate-400">↵</strong> to select</span>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default CommandPalette;
