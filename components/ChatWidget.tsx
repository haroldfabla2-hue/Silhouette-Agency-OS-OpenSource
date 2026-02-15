
import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';

// Lazy load asset components for performance
const AssetRenderer = lazy(() => import('./chat/AssetRenderer').then(m => ({ default: m.AssetRenderer })));
const AssetLightbox = lazy(() => import('./chat/AssetLightbox').then(m => ({ default: m.AssetLightbox })));
import { VoiceControls } from './chat/VoiceControls';
import { VoiceSettingsModal } from './chat/VoiceSettingsModal';
// OPTIMIZATION: Using light build with only common languages to reduce bundle (~600KB -> ~50KB)
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';

// Register only the languages we actually need
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
import { UserRole, ChatMessage, ChatSession, IntrospectionLayer, WorkflowStage, SystemProtocol } from '../types';
import { MessageCircle, X, Send, User, RotateCcw, Cpu, WifiOff, Globe, Plus, MessageSquare, ChevronLeft, ChevronRight, Trash2, Paperclip, Volume2, Settings } from 'lucide-react';
import { api, API_BASE_URL } from '../utils/api';
import { getDonnaGreeting } from '../constants/personalities';
import type { ParsedAsset } from './chat/AssetRenderer';


// ... (inside ChatWidget component)



interface ChatWidgetProps {
    currentUserRole: UserRole;
    onChangeRole: (role: UserRole) => void;
    systemMetrics?: any;
    onUpdateThoughts?: (thoughts: string[]) => void;
    onAgentThought?: (agentId: string, thoughts: string[], role: string) => void;
}

interface SessionListProps {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, newTitle: string) => void;
}

const SessionList: React.FC<SessionListProps> = ({ sessions, activeSessionId, onSelect, onDelete, onRename }) => {
    return (
        <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
            {sessions.map(session => (
                <div
                    key={session.id}
                    className={`p-3 rounded-lg cursor-pointer group relative transition-all duration-200 border ${activeSessionId === session.id ? 'bg-cyan-950/30 border-cyan-900/50 shadow-[0_0_10px_rgba(6,182,212,0.1)]' : 'hover:bg-slate-800/50 border-transparent hover:border-slate-700'}`}
                    onClick={() => onSelect(session.id)}
                >
                    <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                            <h4 className={`text-sm font-medium truncate transition-colors ${activeSessionId === session.id ? 'text-cyan-400' : 'text-slate-300 group-hover:text-slate-200'}`}>
                                {session.title || "New Conversation"}
                            </h4>
                            <p className="text-xs text-slate-500 mt-1 truncate">
                                {session.lastUpdated ? new Date(session.lastUpdated).toLocaleDateString() : 'New'} • {session.lastUpdated ? new Date(session.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Session'}
                            </p>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(session.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-900/20 rounded-md text-slate-500 hover:text-red-400 transition-all transform hover:scale-110"
                            title="Delete Session"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            ))}
            {sessions.length === 0 && (
                <div className="text-center py-8 text-slate-600 text-sm">
                    No active sessions
                </div>
            )}
        </div>
    );
};

// [PHASE 15] Rich Terminal Component
const TerminalBlock: React.FC<{ content: string }> = ({ content }) => {
    // Format: <<<TERMINAL (cmd="git status")>>> \n output \n <<<END>>>
    // Or just <<<TERMINAL>>> cmd \n output <<<END>>>

    // Naive parse: Strip tags
    const raw = content.replace(/<<<TERMINAL.*?>/g, '').replace(/<<<END>>>/g, '').trim();
    const lines = raw.split('\n');
    const cmd = lines[0]?.startsWith('$') ? lines[0] : `$ ${lines[0]}`; // Guess command
    const output = lines.slice(1).join('\n');

    return (
        <div className="my-3 rounded-md overflow-hidden bg-[#1e1e1e] border border-slate-700 shadow-lg font-mono text-xs w-full">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-[#333]">
                <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></div>
                </div>
                <div className="text-slate-400 text-[10px]">bash</div>
            </div>
            <div className="p-3 text-slate-300 whitespace-pre-wrap overflow-x-auto">
                <div className="text-cyan-400 font-bold mb-1">{cmd}</div>
                <div className="opacity-80">{output}</div>
            </div>
        </div>
    );
};

const ChatWidget: React.FC<ChatWidgetProps> = ({ currentUserRole, onChangeRole, systemMetrics, onUpdateThoughts, onAgentThought }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Session State
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);

    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isLocalMode, setIsLocalMode] = useState(false);
    const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null); // [PHASE 15]
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // [ASSET DISPLAY] Lightbox state
    const [lightboxAsset, setLightboxAsset] = useState<ParsedAsset | null>(null);
    const [allAssets, setAllAssets] = useState<ParsedAsset[]>([]);

    // [VOICE] Auto-speak state
    // [VOICE] Auto-speak state - DEPRECATED in favor of voiceConfig
    // const [autoSpeak, setAutoSpeak] = useState(false); 

    // Voice Config State
    const [voiceConfig, setVoiceConfig] = useState<any>({
        enabled: true,
        autoSpeak: false,
        volume: 1.0
    });
    const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);

    // Initial Load of Voice Config
    useEffect(() => {
        const loadVoiceConfig = async () => {
            try {
                const res = await api.get('/v1/media/tts/config');
                setVoiceConfig(res);
            } catch (e) {
                console.warn("Failed to load voice config");
            }
        };
        loadVoiceConfig();
    }, []);

    const handleVoiceConfigSave = async (newConfig: any) => {
        try {
            await api.post('/v1/media/tts/config', newConfig);
            setVoiceConfig(newConfig);
        } catch (e) {
            console.error("Failed to save voice config", e);
        }
    };

    // 1. INITIALIZATION & POLLING
    useEffect(() => {
        if (isOpen) {
            loadSessions();
            const interval = setInterval(loadSessions, 10000); // Poll sessions every 10s
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    // 2. LOAD SESSIONS
    const loadSessions = async () => {
        try {
            const response = await api.get<ChatSession[] | { sessions?: ChatSession[], data?: ChatSession[] }>('/v1/chat/sessions');

            // [DEFENSIVE] Handle both array and object responses
            let list: ChatSession[];
            if (Array.isArray(response)) {
                list = response;
            } else if (response && typeof response === 'object') {
                list = (response as any).sessions || (response as any).data || [];
            } else {
                list = [];
            }

            setSessions(list);
            setIsConnected(true);
            setIsLocalMode(false);

            // Auto-select first session if none selected
            if (!activeSessionId && list.length > 0) {
                selectSession(list[0].id);
            } else if (list.length === 0) {
                createNewSession();
            }

        } catch (e) {
            // Only fall back to local mode if we were NOT connected before (initial load)
            // This prevents the chat from resetting if a background poll fails
            if (!isConnected) {
                setIsConnected(false);
                setIsLocalMode(true);
                const saved = localStorage.getItem('silhouette_local_chat');
                if (saved) setMessages(JSON.parse(saved));
            } else {
                console.warn("Connection unstable, keeping existing session...");
            }
        }
    };

    // 3. SELECT SESSION
    const selectSession = async (id: string) => {
        setActiveSessionId(id);
        try {
            const response = await api.get<any>(`/v1/chat/sessions/${id}?t=${Date.now()}`);

            // [DEFENSIVE] Handle both array and object responses from backend
            let history: ChatMessage[];
            if (Array.isArray(response)) {
                history = response;
            } else if (response && typeof response === 'object') {
                history = response.history || response.messages || response.data || [];
            } else {
                history = [];
            }

            // Ensure it's always an array
            setMessages(Array.isArray(history) ? history : []);
        } catch (e) {
            console.error("Failed to load session history", e);
            setMessages([]); // Reset to empty array on error
        }
    };

    // 4. CREATE NEW SESSION
    const createNewSession = async () => {
        try {
            const newSession = await api.post<ChatSession>('/v1/chat/sessions', { title: "New Conversation" });
            setSessions(prev => [newSession, ...prev]);
            setActiveSessionId(newSession.id);
            setMessages([]);
        } catch (e) {
            setMessages([]);
            setActiveSessionId('local');
        }
    };

    // Auto-scroll (Smart)
    useEffect(() => {
        const div = scrollRef.current;
        if (div) {
            // Only scroll if we are already near the bottom (within 100px)
            // This allows the user to scroll up and read history without being yanked back
            const isAtBottom = div.scrollHeight - div.scrollTop <= div.clientHeight + 150;
            if (isAtBottom) {
                div.scrollTop = div.scrollHeight;
            }
        }
    }, [messages, isTyping]);

    // HELPER: Clean raw protocol JSON
    const cleanProtocolOutput = (text: string) => {
        let cleaned = text;
        cleaned = cleaned.replace(/<<<UI_SCHEMA>>>[\s\S]*?<<<END>>>/g, '✨ [HOLOGRAM: Interface Generated]');
        cleaned = cleaned.replace(/<<<PROJECT_STRUCTURE>>>[\s\S]*?<<<END>>>/g, '📂 [VFS: Project Structure Created]');
        // cleaned = cleaned.replace(/<<<TERMINAL[\s\S]*?>>>[\s\S]*?<<<END>>>/g, '💻 [TERMINAL: Command Executed]'); // Handled by Rich Renderer
        cleaned = cleaned.replace(/<<<NAVIGATE:[\s\S]*?>>>/g, '🧭 [AUTOPILOT: Navigating...]');
        cleaned = cleaned.replace(/<<<PROTOCOL:GENERATE_IMAGE[\s\S]*?>>>/g, '🎨 [VISUAL CORTEX: Generating Artwork...]');
        cleaned = cleaned.replace(/<<<PROTOCOL:SEARCH_ASSETS[\s\S]*?>>>/g, '🔍 [VISUAL CORTEX: Scouting Real Assets...]');
        cleaned = cleaned.replace(/<<<PROTOCOL:ADVANCED_SYNTHESIS[\s\S]*?>>>/g, '🧬 [NANO-BANANA: Synthesizing Campaign...]');
        return cleaned;
    };

    // --- STREAMING HANDLER ---
    const handleSend = async () => {
        if (!input.trim() && !selectedFile) return;

        let userText = input;

        // [PHASE 15] File Upload Handling
        if (selectedFile) {
            try {
                const formData = new FormData();
                formData.append('file', selectedFile);

                // Optimistic UI for file
                const tempFileMsg: ChatMessage = {
                    id: crypto.randomUUID(),
                    role: 'user',
                    text: `📎 Uploading: ${selectedFile.name}...`,
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, tempFileMsg]);

                const res = await api.post<{ filename: string, path: string }>('/v1/assets/upload', formData);

                // Append file reference to text so Agent knows about it
                userText = `[FILE_UPLOAD] Filename: ${res.filename} \nContext: ${input}`;

                // Update optimistic message?? For now, just let the main flow handle the text.
                // Actually, let's remove the "Uploading..." message and just send the real one with the attachment marker?
                // Or update the previous one. Let's keep it simple: 
                // The "userText" sent to backend includes the tag.
                // The UI should probably show the file attachment cleanly.
                // For now, text representation.

                setSelectedFile(null); // Clear after upload
            } catch (e) {
                console.error("Upload failed", e);
                userText += "\n[UPLOAD FAILED]";
            }
        }

        setInput('');
        setIsTyping(true);

        // Optimistic Update
        const tempMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: userText, timestamp: Date.now() };
        setMessages(prev => [...prev, tempMsg]);

        // Placeholder for Agent Response
        const agentMsgId = crypto.randomUUID();
        setMessages(prev => [...prev, { id: agentMsgId, role: 'agent', text: '', timestamp: Date.now() }]);

        // SAFETY NET: Timeout after 45 seconds if no response
        const timeoutId = setTimeout(() => {
            if (isTyping) {
                setIsTyping(false);
                setMessages(prev => prev.map(m =>
                    m.id === agentMsgId && m.text === '' ? { ...m, text: "Error: Request timed out. The agent took too long to respond." } : m
                ));
                if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                }
            }
        }, 45000);

        try {
            abortControllerRef.current = new AbortController();

            const response = await api.fetch('/v1/chat/stream', {
                method: 'POST',
                body: JSON.stringify({
                    messages: [{ role: 'user', content: userText }],
                    useWebSearch: isWebSearchEnabled,
                    systemMetrics,
                    sessionId: activeSessionId
                }),
                signal: abortControllerRef.current.signal
            });

            clearTimeout(timeoutId); // Clear timeout on successful connection

            if (!response.ok) throw new Error("Stream Error");
            if (!response.body) throw new Error("No Response Body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || ''; // Keep partial line

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            // SSE Format from backend: { type: 'token', content: '...' }
                            if (data.type === 'token' && data.content) {
                                fullText += data.content;
                                setMessages(prev => prev.map(m =>
                                    m.id === agentMsgId ? { ...m, text: cleanProtocolOutput(fullText) } : m
                                ));
                            }

                            // Capture Thoughts for Introspection UI
                            if (onUpdateThoughts && (data.thought || data.allThoughts)) {
                                if (data.allThoughts) onUpdateThoughts(data.allThoughts);
                            }

                            // Capture Distributed Agent Thoughts (The "100% Real" Stuff)
                            if (data.type === 'AGENT_THOUGHT' && onAgentThought) {
                                onAgentThought(data.agentId, data.thoughts, data.role);
                            }

                            if (data.done) {
                                setIsTyping(false);
                                loadSessions(); // Refresh list to update preview/timestamp
                            }

                            if (data.error) {
                                console.error("Stream Error Payload", data.error);
                            }
                        } catch (e) {
                            // Ignore parse errors for partial chunks
                        }
                    }
                }
            }

        } catch (e: any) {
            clearTimeout(timeoutId);
            if (e.name !== 'AbortError') {
                setMessages(prev => prev.map(m =>
                    m.id === agentMsgId ? { ...m, text: "Connection Error: " + e.message } : m
                ));
            }
            setIsTyping(false);
        }
    };

    if (currentUserRole === UserRole.VISITOR) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">

            {/* Role Switcher */}
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-700 backdrop-blur-md flex items-center gap-2 shadow-xl">
                <User size={14} className="text-slate-400" />
                <select
                    value={currentUserRole}
                    onChange={(e) => onChangeRole(e.target.value as UserRole)}
                    className="bg-transparent text-xs text-white border-none outline-none cursor-pointer"
                >
                    {Object.values(UserRole).map(role => (
                        <option key={role} value={role}>{role}</option>
                    ))}
                </select>
            </div>

            {isOpen && (
                <div className="w-[800px] h-[600px] bg-slate-950 border border-slate-800 rounded-xl shadow-2xl flex overflow-hidden animate-in fade-in slide-in-from-bottom-10">

                    {/* SIDEBAR */}
                    <div className={`${isSidebarOpen ? 'w-64' : 'w-0'} bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col overflow-hidden`}>
                        <div className="p-3 border-b border-slate-800 flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-400">SESSIONS</span>
                            <button onClick={createNewSession} className="text-cyan-400 hover:text-cyan-300">
                                <Plus size={16} />
                            </button>
                        </div>
                        <SessionList
                            sessions={sessions}
                            activeSessionId={activeSessionId}
                            onSelect={selectSession}
                            onDelete={(id) => {
                                // Optimistic Update
                                setSessions(prev => prev.filter(s => s.id !== id));
                                if (activeSessionId === id) setActiveSessionId(null);

                                api.delete(`/v1/chat/sessions/${id}`).catch(err => {
                                    console.error("Failed to delete session", err);
                                    loadSessions(); // Revert/Refresh on error
                                });
                            }}
                            onRename={(id, newTitle) => {
                                // Optimistic Update
                                setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));

                                api.patch(`/v1/chat/sessions/${id}`, { title: newTitle }).catch(err => {
                                    console.error("Failed to rename session", err);
                                    loadSessions(); // Revert/Refresh on error
                                });
                            }}
                        />
                    </div>

                    {/* MAIN CHAT AREA */}
                    <div className="flex-1 flex flex-col min-w-0 bg-slate-950/50">

                        {/* HEADER */}
                        <div className="h-12 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/50">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setIsVoiceSettingsOpen(true)}
                                    className={`p-1.5 rounded-md transition-colors ${isVoiceSettingsOpen ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    title="Voice Settings"
                                >
                                    <Settings size={16} />
                                </button>
                                <button
                                    onClick={() => handleVoiceConfigSave({ ...voiceConfig, autoSpeak: !voiceConfig.autoSpeak })}
                                    className={`p-1.5 rounded-md transition-colors ${voiceConfig.autoSpeak ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
                                    title={voiceConfig.autoSpeak ? "Auto-speak ON" : "Auto-speak OFF"}
                                >
                                    <Volume2 size={16} />
                                </button>
                                <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-slate-500 hover:text-white">
                                    {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                                </button>
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold text-white">
                                        {sessions.find(s => s.id === activeSessionId)?.title || "New Chat"}
                                    </span>
                                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                        {isConnected ? <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> : <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>}
                                        {isConnected ? 'Connected to Hive Mind' : 'Local Mode'}
                                    </span>
                                </div>
                            </div>
                            <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white">
                                <X size={18} />
                            </button>
                        </div>

                        {/* MESSAGES */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar" ref={scrollRef}>
                            {messages.map((m, i) => {
                                // [NULL SAFE] Fallback for edge cases during streaming
                                const text = m.text ?? '';

                                // Parse thoughts from text (for streaming)
                                const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/);
                                const isThinking = text.trim().startsWith('<thought>') && !thoughtMatch;

                                let cleanText = text;
                                let thoughts = m.thoughts || [];

                                if (thoughtMatch) {
                                    cleanText = text.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
                                    thoughts = [thoughtMatch[1].trim()];
                                } else if (isThinking) {
                                    cleanText = ''; // Hide raw text while thinking
                                }

                                return (
                                    <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                                        <div className={`max-w-[85%] p-3 rounded-lg text-sm ${m.role === 'user'
                                            ? 'bg-cyan-600 text-white rounded-br-none'
                                            : 'bg-slate-800/80 text-slate-300 rounded-bl-none border border-slate-700/50'
                                            }`}>
                                            {m.role === 'user' ? (
                                                <div className="whitespace-pre-wrap">{m.text}</div>
                                            ) : (
                                                <div className="prose prose-invert prose-sm max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0 [&>pre]:bg-slate-950 [&>pre]:p-0 [&>pre]:rounded-md [&>pre]:overflow-hidden">
                                                    {m.agentName && (
                                                        <div className="text-[10px] uppercase font-bold text-cyan-500 mb-1 flex items-center gap-1.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
                                                            {m.agentName}
                                                        </div>
                                                    )}
                                                    {isThinking ? (
                                                        <div className="flex items-center gap-2 text-slate-400 italic animate-pulse">
                                                            <Cpu size={14} />
                                                            <span>Thinking...</span>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {/* [ASSET DISPLAY] Render images, videos, audio inline */}
                                                            <Suspense fallback={null}>
                                                                <AssetRenderer
                                                                    content={cleanText}
                                                                    onAssetClick={(asset) => {
                                                                        setLightboxAsset(asset);
                                                                    }}
                                                                    onAction={(action, asset) => {
                                                                        console.log('[Chat] Asset action:', action, asset);
                                                                        // TODO: Implement regenerate, upscale, etc.
                                                                    }}
                                                                />
                                                            </Suspense>

                                                            {cleanText.split(/(<<<TERMINAL[\s\S]*?>>>[\s\S]*?<<<END>>>)/g).map((part, pIdx) => {
                                                                if (part.startsWith('<<<TERMINAL')) {
                                                                    return <TerminalBlock key={pIdx} content={part} />;
                                                                }
                                                                if (!part.trim()) return null;
                                                                return (
                                                                    <ReactMarkdown
                                                                        key={pIdx}
                                                                        components={{
                                                                            code(props) {
                                                                                const { children, className, node, ...rest } = props
                                                                                const match = /language-(\w+)/.exec(className || '')
                                                                                return match ? (
                                                                                    <div className="relative group my-2">
                                                                                        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                                                                            <button
                                                                                                onClick={() => navigator.clipboard.writeText(String(children))}
                                                                                                className="bg-slate-700 hover:bg-slate-600 text-[10px] px-2 py-1 rounded text-white"
                                                                                            >
                                                                                                Copy
                                                                                            </button>
                                                                                        </div>
                                                                                        <SyntaxHighlighter
                                                                                            {...rest}
                                                                                            PreTag="div"
                                                                                            children={String(children).replace(/\n$/, '')}
                                                                                            language={match[1]}
                                                                                            style={vscDarkPlus}
                                                                                            customStyle={{ margin: 0, padding: '1rem', fontSize: '0.8rem', borderRadius: '0.375rem', background: '#0f172a' }}
                                                                                        />
                                                                                    </div>
                                                                                ) : (
                                                                                    <code {...rest} className={`${className} bg-slate-700/50 px-1 py-0.5 rounded text-cyan-200 font-mono text-xs`}>
                                                                                        {children}
                                                                                    </code>
                                                                                )
                                                                            }
                                                                        }}
                                                                    >
                                                                        {part}
                                                                    </ReactMarkdown>
                                                                );
                                                            })}

                                                            {/* [VOICE] Voice Controls for Agent Messages */}
                                                            {!isThinking && cleanText && (
                                                                <VoiceControls
                                                                    text={cleanText}
                                                                    autoPlay={voiceConfig.autoSpeak && i === messages.length - 1}
                                                                    voiceId={voiceConfig.voiceId}
                                                                />
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Thoughts (Hidden by default or subtle) */}
                                        {thoughts.length > 0 && (
                                            <div className="mt-1 pl-2 border-l-2 border-purple-500/20 max-w-[80%] group cursor-help">
                                                <div className="flex items-center gap-1 text-[10px] text-purple-400/40 uppercase font-bold mb-0.5">
                                                    <Cpu size={10} />
                                                    <span>Thought Process</span>
                                                </div>
                                                <p className="text-[10px] text-purple-400/60 font-mono italic line-clamp-2 group-hover:line-clamp-none transition-all">
                                                    {thoughts[0]}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}

                            {/* Voice Settings Modal */}
                            <VoiceSettingsModal
                                isOpen={isVoiceSettingsOpen}
                                onClose={() => setIsVoiceSettingsOpen(false)}
                                currentConfig={voiceConfig}
                                onSave={handleVoiceConfigSave}
                            />
                            {isTyping && (
                                <div className="flex justify-start">
                                    <div className="bg-slate-800/50 p-2 rounded-lg rounded-bl-none flex gap-1">
                                        <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce"></div>
                                        <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce delay-75"></div>
                                        <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-bounce delay-150"></div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* INPUT AREA */}
                        <div className="p-4 border-t border-slate-800 bg-slate-900/30">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                    placeholder={isConnected ? "Escribe tu comando a Silhouette..." : isLocalMode ? "Modo Local (Sin conexión al Hive Mind)..." : "Conectando..."}
                                    disabled={!isConnected && !isLocalMode}
                                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50 shadow-inner"
                                />
                                <button
                                    onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
                                    className={`p-3 rounded-lg transition-all ${isWebSearchEnabled ? 'bg-green-600 text-white shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-slate-800 text-slate-500 hover:text-white hover:bg-slate-700'}`}
                                    title="Toggle Web Research"
                                >
                                    <Globe size={18} />
                                </button>

                                {/* FILE UPLOAD BUTTON */}
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
                                    }}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`p-3 rounded-lg transition-all ${selectedFile ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)]' : 'bg-slate-800 text-slate-500 hover:text-white hover:bg-slate-700'}`}
                                    title="Attach File"
                                    disabled={!isConnected}
                                >
                                    <Paperclip size={18} />
                                </button>
                                <button
                                    onClick={handleSend}
                                    disabled={(!isConnected && !isLocalMode) || !input.trim()}
                                    className="p-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-900/20 transition-all hover:scale-105"
                                >
                                    <Send size={18} />
                                </button>
                            </div>
                            <div className="text-[10px] text-slate-600 mt-2 text-center">
                                Silhouette OS v2.0 • {isLocalMode ? 'Edge Compute' : 'Hive Mind Connected'} • {systemMetrics?.activeAgents || 0} Agents Active
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="w-14 h-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.5)] flex items-center justify-center transition-all hover:scale-110 animate-bounce-subtle"
                >
                    <MessageCircle size={28} />
                </button>
            )}

            {/* [ASSET DISPLAY] Lightbox for full-screen preview */}
            {lightboxAsset && (
                <Suspense fallback={null}>
                    <AssetLightbox
                        asset={lightboxAsset}
                        assets={allAssets}
                        onClose={() => setLightboxAsset(null)}
                        onAction={(action, asset) => {
                            console.log('[Lightbox] Action:', action, asset);
                            // TODO: Implement regenerate action via API
                        }}
                    />
                </Suspense>
            )}
        </div>
    );
};

export default ChatWidget;