import React, { useState, useEffect, useRef, Component as ReactComponent, ReactNode } from 'react';
// NOTE: These star imports are intentional - DynamicWorkspace injects them into runtime-generated components
// This component is lazy-loaded, so these large bundles only load when DynamicWorkspace is visited
import * as Recharts from 'recharts';
import * as Lucide from 'lucide-react';
import { vfs } from '../services/virtualFileSystem';
import { VFSProject, FileNode } from '../types';
import { uiContext } from '../services/uiContext';
import {
    LayoutTemplate, RefreshCcw, FolderOpen,
    Terminal as TerminalIcon, Play, Server, Globe,
    File, FileCode, FileJson, ChevronRight, ChevronDown,
    Plus, Trash2, Save, X, Download, HardDrive, Cpu, Eye
} from 'lucide-react';
import MonacoBridge from './MonacoBridge';
import CommandPalette from './CommandPalette';
import PRToolbar from './PRToolbar';
import PRNotification from './PRNotification';
import { lazy, Suspense } from 'react';
import type { Presentation } from '../types/presentation';

// Lazy load PresentationViewer for code splitting
const PresentationViewer = lazy(() => import('./PresentationViewer'));

// Access to Babel from the global scope (injected in index.html)
declare const Babel: any;

interface DynamicWorkspaceProps {
    initialProjectId?: string | null;
}

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: string | null;
}

// --- ERROR BOUNDARY COMPONENT (AUTO-HEAL ENABLED) ---
class ErrorBoundary extends ReactComponent<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: any): ErrorBoundaryState {
        return { hasError: true, error: error.toString() };
    }

    componentDidCatch(error: any, errorInfo: any) {
        console.error("Runtime App Error:", error, errorInfo);

        // --- OMNIPOTENT AUTO-HEAL TRIGGER ---
        // 1. Detect Error
        // 2. Emit Fix Request to System Bus (via global event or service)
        // Since we are in a React Class Component, we might need a helper or global access.
        // For V1, we'll log it and assume the Orchestrator is watching logs via 'Sensory Data'.

        // BETTER: Dispatch a custom DOM event that the parent functional component can listen to
        const event = new CustomEvent('silhouette-runtime-error', {
            detail: { error: error.toString(), info: errorInfo }
        });
        window.dispatchEvent(event);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-full flex flex-col items-center justify-center bg-red-950/20 text-red-400 p-6 text-center animate-pulse">
                    <div className="p-4 bg-red-900/20 rounded-full mb-4 border border-red-500/30">
                        <Cpu size={32} className="animate-spin" />
                    </div>
                    <h3 className="text-lg font-bold mb-2">System Failure Detected</h3>
                    <p className="text-xs text-red-300 mb-4">Initiating Auto-Heal Protocol...</p>
                    <pre className="text-xs font-mono bg-black/50 p-4 rounded border border-red-900/50 max-w-full overflow-auto text-left">
                        {this.state.error}
                    </pre>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold"
                    >
                        MANUAL RESET
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// --- RUNTIME COMPILER ---
const RuntimeApp: React.FC<{ code: string }> = ({ code }) => {
    const [Component, setComponent] = useState<React.FC | null>(null);
    const [compileError, setCompileError] = useState<string | null>(null);

    useEffect(() => {
        if (!code) return;

        // Simple heuristic to ignore empty/comment-only files
        if (code.trim().startsWith('//') && code.length < 50) {
            setComponent(null);
            return;
        }

        try {
            // 1. TRANSFORM IMPORTS TO DESTRUCTURING
            // This allows 'import { LineChart } from "recharts"' to work with our injected object
            let cleanCode = code
                // Handle React imports
                .replace(/import\s+React,?\s*{([^}]*)}\s+from\s+['"]react['"];?/g, 'const {$1} = React;')
                .replace(/import\s+React\s+from\s+['"]react['"];?/g, '') // Remove plain import if handled
                // Handle Recharts
                .replace(/import\s+{([^}]+)}\s+from\s+['"]recharts['"];?/g, 'const {$1} = Recharts;')
                // Handle Lucide
                .replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"];?/g, 'const {$1} = Lucide;')
                // Convert default exports to simple declarations (Babel doesn't like top-level return)
                .replace(/export\s+default\s+function\s+([a-zA-Z0-9_]+)/g, 'function $1')
                .replace(/export\s+default\s+class\s+([a-zA-Z0-9_]+)/g, 'class $1')
                .replace(/export\s+default\s+([a-zA-Z0-9_]+);?/g, '') // Remove "export default App;"
                // Clean any remaining imports we didn't catch (fallback)
                .replace(/^import\s+.*$/gm, '');

            // 2. TRANSPILE TSX -> JS
            const transpiled = Babel.transform(cleanCode, {
                presets: ['react', ['env', { modules: false }]],
                filename: 'file.tsx'
            }).code;

            // 3. CREATE FUNCTION WITH INJECTED SCOPE
            const func = new Function('React', 'Recharts', 'Lucide', `
                // Hooks are handled by regex replacement of imports
                try {
                    ${transpiled}
                } catch(e) {
                    throw e;
                }
                // Fallback return if no export default was found
                return typeof App !== 'undefined' ? App : (() => React.createElement('div', {className:'text-slate-500 p-4'}, 'No "export default" component found.'));
            `);

            // 4. EXECUTE FACTORY
            // Pass the REAL library objects here
            const GeneratedComponent = func(React, Recharts, Lucide);

            setComponent(() => GeneratedComponent);
            setCompileError(null);

        } catch (e: any) {
            console.error("Compilation Error:", e);
            setCompileError(e.message);
        }
    }, [code]);

    if (compileError) return (
        <div className="text-red-400 text-xs p-4 bg-red-950/50 border border-red-500/30 rounded m-4 font-mono">
            <strong>Compilation Failed:</strong><br />{compileError}
        </div>
    );

    if (!Component) return (
        <div className="flex flex-col items-center justify-center h-full text-xs text-slate-500 font-mono gap-2">
            <Cpu size={24} className="animate-spin text-cyan-500" />
            <span className="animate-pulse">Compiling Neural Hologram...</span>
        </div>
    );

    return (
        <ErrorBoundary>
            <div className="w-full h-full bg-white text-black p-4 overflow-auto">
                <Component />
            </div>
        </ErrorBoundary>
    );
};

const DynamicWorkspace: React.FC<DynamicWorkspaceProps> = ({ initialProjectId }) => {
    // --- STATE ---
    const [activeProject, setActiveProject] = useState<VFSProject | null>(null);
    const [projects, setProjects] = useState<VFSProject[]>([]);

    // IDE State
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [openFiles, setOpenFiles] = useState<FileNode[]>([]);
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [unsavedChanges, setUnsavedChanges] = useState<Set<string>>(new Set());

    // View State
    const [activeTab, setActiveTab] = useState<'CODE' | 'PREVIEW'>('CODE');

    // Terminal State
    const [terminalLines, setTerminalLines] = useState<string[]>([]);
    const [cwdId, setCwdId] = useState<string | null>(null);
    const [terminalInput, setTerminalInput] = useState('');
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [historyPointer, setHistoryPointer] = useState<number>(-1);

    const terminalEndRef = useRef<HTMLDivElement>(null);
    const terminalInputRef = useRef<HTMLInputElement>(null);

    // Update Trigger
    const [, setTick] = useState(0);
    const forceUpdate = () => setTick(t => t + 1);

    // Creation State
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectType, setNewProjectType] = useState<VFSProject['type']>('REACT');

    // Presentation Viewer State
    const [showPresentationViewer, setShowPresentationViewer] = useState(false);
    const [activePresentation, setActivePresentation] = useState<Presentation | null>(null);

    // REPORT CONTEXT TO AI
    useEffect(() => {
        const activeNode = activeFileId ? vfs.getNode(activeFileId) : null;

        uiContext.updateContext({
            activeFile: activeNode && activeNode.type === 'FILE'
                ? { name: activeNode.name, content: activeNode.content || '' }
                : undefined
        });

        if (activeProject) {
            uiContext.setActiveProject(activeProject.id);
        }
    }, [activeFileId, activeProject]);

    // Load Projects on Mount
    useEffect(() => {
        const allProjects = vfs.getProjects();
        setProjects(allProjects);

        if (initialProjectId) {
            const target = allProjects.find(p => p.id === initialProjectId);
            if (target) {
                setActiveProject(target);
            }
        }
    }, [initialProjectId]);

    // Init Terminal & CWD when project activates
    useEffect(() => {
        if (activeProject) {
            setCwdId(activeProject.rootFolderId);
            setTerminalLines([
                `\x1b[1;36mSilhouette OS Kernel v4.2.0\x1b[0m`,
                `Type \x1b[1;33mhelp\x1b[0m for available commands.`,
                `Mounted VFS: /mnt/${activeProject.name.toLowerCase().replace(/\s/g, '-')}`
            ]);
            setExpandedFolders(new Set([activeProject.rootFolderId]));
        }
    }, [activeProject]);

    const [isCmdPaletteOpen, setIsCmdPaletteOpen] = useState(false);

    // --- COMMAND PALETTE SHORTCUT ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setIsCmdPaletteOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // --- COMMAND HANDLER ---
    const handleCommand = (cmd: string) => {
        switch (cmd) {
            case 'save':
                handleSave();
                break;
            case 'format':
                // Placeholder for format logic
                logTerminal("Formatting document... (Prettier simulation)");
                break;
            case 'toggle_terminal':
                // Logic to toggle terminal visibility could go here
                logTerminal("Toggling terminal...");
                break;
            default:
                break;
        }
    };

    useEffect(() => {
        terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [terminalLines]);

    // --- AUTO-HEAL LISTENER ---
    useEffect(() => {
        const handleRuntimeError = (e: any) => {
            const { error } = e.detail;
            logTerminal(`\x1b[31m[CRITICAL] Runtime Error Detected: ${error}\x1b[0m`);
            logTerminal(`\x1b[33m[AUTO-HEAL] Requesting immediate fix from TEAM_FIX...\x1b[0m`);

            // Emit Fix Request
            // In a real implementation, we would send the file content + error
            // For now, we simulate the request
            // systemBus.emit(SystemProtocol.TASK_ASSIGNMENT, { ... });
        };

        window.addEventListener('silhouette-runtime-error', handleRuntimeError);
        return () => window.removeEventListener('silhouette-runtime-error', handleRuntimeError);
    }, []);

    const activeFileNode = activeFileId ? vfs.getNode(activeFileId) : null;

    // --- PR REVIEW DETECTION ---
    // Detect if the current project is a PR review project (name starts with "[PR #")
    const isPRReviewProject = activeProject?.name?.startsWith('[PR #') || false;

    // Extract PR info from project name and __PR_INFO__.md file
    const prInfo = isPRReviewProject ? (() => {
        const match = activeProject?.name?.match(/\[PR #(\d+)\]/);
        const prNumber = match ? parseInt(match[1], 10) : 0;

        // Try to find __PR_INFO__.md for more details
        const infoFile = activeProject ?
            vfs.getFileTree(activeProject.rootFolderId).find(f => f.name === '__PR_INFO__.md') : null;

        // Parse CI status from info file content (basic parsing)
        let ciStatus: 'success' | 'failure' | 'pending' | 'unknown' = 'unknown';
        if (infoFile?.content) {
            if (infoFile.content.includes('✅')) ciStatus = 'success';
            else if (infoFile.content.includes('❌')) ciStatus = 'failure';
            else if (infoFile.content.includes('⏳')) ciStatus = 'pending';
        }

        return {
            number: prNumber,
            ciStatus,
            url: `https://github.com/${process.env.GITHUB_REPO_OWNER || 'owner'}/${process.env.GITHUB_REPO_NAME || 'repo'}/pull/${prNumber}`
        };
    })() : null;

    // --- PRESENTATION DETECTION ---
    // Check if current project is an HTML presentation (created by create_presentation tool)
    const isPresentationProject = activeProject?.type === 'HTML' && (() => {
        const rootTree = vfs.getFileTree(activeProject.rootFolderId);
        return rootTree.some(f => f.name === 'data.json');
    })();

    // Load presentation data if it's a presentation project
    const loadPresentation = (): Presentation | null => {
        if (!activeProject || !isPresentationProject) return null;
        const rootTree = vfs.getFileTree(activeProject.rootFolderId);
        const dataFile = rootTree.find(f => f.name === 'data.json');
        if (dataFile?.content) {
            try {
                return JSON.parse(dataFile.content) as Presentation;
            } catch { return null; }
        }
        return null;
    };

    // --- ACTIONS ---

    const handleCreateProject = () => {
        if (!newProjectName) return;
        const p = vfs.createProject(newProjectName, newProjectType);
        setProjects(vfs.getProjects());
        setActiveProject(p);
        setIsCreatingProject(false);
        setNewProjectName('');
    };

    const handleOpenFile = (file: FileNode) => {
        if (!openFiles.find(f => f.id === file.id)) {
            setOpenFiles([...openFiles, file]);
        }
        setActiveFileId(file.id);
        setActiveTab('CODE');
    };

    const handleCloseFile = (e: React.MouseEvent, fileId: string) => {
        e.stopPropagation();
        const newOpen = openFiles.filter(f => f.id !== fileId);
        setOpenFiles(newOpen);
        if (activeFileId === fileId) {
            setActiveFileId(newOpen.length > 0 ? newOpen[newOpen.length - 1].id : null);
        }
    };

    const handleFileChange = (content: string) => {
        if (!activeFileId) return;
        vfs.updateFile(activeFileId, content);
        setUnsavedChanges(prev => new Set(prev).add(activeFileId));
    };

    const handleSave = () => {
        if (activeFileId) {
            setUnsavedChanges(prev => {
                const next = new Set(prev);
                next.delete(activeFileId);
                return next;
            });
            logTerminal(`\x1b[32m✔ Saved ${activeFileNode?.name}\x1b[0m`);
        }
    };

    const toggleFolder = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    };

    const handleDeleteProject = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm("Delete project permanently from VFS?")) {
            vfs.deleteProject(id);
            setProjects(vfs.getProjects());
            if (activeProject?.id === id) setActiveProject(null);
        }
    };

    const handleCreateFile = (folderId: string) => {
        const name = prompt("File Name (e.g. Component.tsx):");
        if (name) {
            vfs.createFile(folderId, name, "// New file");
            toggleFolder(folderId);
            toggleFolder(folderId);
            forceUpdate();
        }
    };

    const logTerminal = (msg: string) => {
        setTerminalLines(prev => [...prev, msg]);
    };

    const handleDownload = () => {
        if (!activeProject) return;
        const data = JSON.stringify(vfs.getFileTree(activeProject.rootFolderId), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeProject.name}_vfs_dump.json`;
        a.click();
        logTerminal("> Project packed and downloaded.");
    };

    // --- TERMINAL LOGIC ---
    const getPathString = (nodeId: string): string => {
        if (!activeProject || nodeId === activeProject.rootFolderId) return '~';
        let parts = [];
        let curr = vfs.getNode(nodeId);
        while (curr && curr.id !== activeProject.rootFolderId) {
            parts.unshift(curr.name);
            if (curr.parentId) curr = vfs.getNode(curr.parentId);
            else break;
        }
        return '~/' + parts.join('/');
    };

    const resolvePathNode = (startNodeId: string, pathStr: string): FileNode | null => {
        if (!pathStr || pathStr === '.') return vfs.getNode(startNodeId) || null;
        if (pathStr === '~') return vfs.getNode(activeProject!.rootFolderId) || null;

        const parts = pathStr.split('/').filter(p => p !== '' && p !== '.');
        let currentId = startNodeId;

        if (pathStr.startsWith('~') || pathStr.startsWith('/')) {
            currentId = activeProject!.rootFolderId;
            if (pathStr.startsWith('~/')) parts.shift();
        }

        for (const part of parts) {
            if (part === '..') {
                const node = vfs.getNode(currentId);
                if (node?.parentId) currentId = node.parentId;
            } else {
                const children = vfs.getFileTree(currentId);
                const match = children.find(c => c.name === part);
                if (match) currentId = match.id;
                else return null;
            }
        }
        return vfs.getNode(currentId) || null;
    };

    const handleTerminalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            executeCommand(terminalInput);
            setCommandHistory(prev => [...prev, terminalInput]);
            setHistoryPointer(-1);
            setTerminalInput('');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length > 0) {
                const newPtr = historyPointer === -1 ? commandHistory.length - 1 : Math.max(0, historyPointer - 1);
                setHistoryPointer(newPtr);
                setTerminalInput(commandHistory[newPtr]);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyPointer !== -1) {
                const newPtr = Math.min(commandHistory.length - 1, historyPointer + 1);
                setHistoryPointer(newPtr);
                setTerminalInput(commandHistory[newPtr]);
            } else {
                setTerminalInput('');
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const args = terminalInput.split(' ');
            const partial = args.pop() || '';
            const children = vfs.getFileTree(cwdId!);
            const match = children.find(c => c.name.startsWith(partial));
            if (match) {
                args.push(match.name + (match.type === 'FOLDER' ? '/' : ''));
                setTerminalInput(args.join(' '));
            }
        }
    };

    const executeCommand = (fullCmd: string) => {
        if (!fullCmd.trim()) return;

        const redirectSplit = fullCmd.split('>');
        const cmdPart = redirectSplit[0].trim();
        const redirectFile = redirectSplit.length > 1 ? redirectSplit[1].trim() : null;

        logTerminal(`\x1b[1;32m➜\x1b[0m \x1b[1;36m${getPathString(cwdId!)}\x1b[0m $ ${fullCmd}`);

        const [cmd, ...args] = cmdPart.split(' ').filter(Boolean);

        try {
            let output = '';

            switch (cmd) {
                case 'help': output = 'Commands: ls, cd, pwd, mkdir, touch, rm, cat, echo, cp, mv, clear, npm'; break;
                case 'clear': setTerminalLines([]); return;
                case 'pwd': output = getPathString(cwdId!); break;
                case 'ls':
                    const targetPath = args[0] || '.';
                    const targetNode = resolvePathNode(cwdId!, targetPath);
                    if (targetNode && targetNode.type === 'FOLDER') {
                        const children = vfs.getFileTree(targetNode.id);
                        if (children.length === 0) output = '(empty)';
                        else {
                            output = children.map(c =>
                                c.type === 'FOLDER' ? `\x1b[1;34m${c.name}/\x1b[0m` : c.name
                            ).join('   ');
                        }
                    } else output = `ls: cannot access '${targetPath}'`;
                    break;
                case 'cd':
                    const cdPath = args[0] || '~';
                    const cdNode = resolvePathNode(cwdId!, cdPath);
                    if (cdNode && cdNode.type === 'FOLDER') {
                        setCwdId(cdNode.id);
                        setExpandedFolders(prev => new Set(prev).add(cdNode.id));
                    } else output = `cd: no such file: ${cdPath}`;
                    break;
                case 'mkdir':
                    if (args[0]) { vfs.createFolder(cwdId!, args[0]); output = `Created directory: ${args[0]}`; forceUpdate(); }
                    else output = 'usage: mkdir <name>';
                    break;
                case 'touch':
                    if (args[0]) { vfs.createFile(cwdId!, args[0], ''); output = `Created file: ${args[0]}`; forceUpdate(); }
                    else output = 'usage: touch <name>';
                    break;
                case 'echo': output = args.join(' ').replace(/"/g, ''); break;
                case 'cat':
                    if (args[0]) {
                        const f = resolvePathNode(cwdId!, args[0]);
                        if (f && f.type === 'FILE') output = f.content || '';
                        else output = `cat: ${args[0]}: No such file`;
                    } else output = 'usage: cat <file>';
                    break;
                case 'rm':
                    if (args[0]) {
                        const n = resolvePathNode(cwdId!, args[0]);
                        if (n) { vfs.deleteNode(n.id); output = `Removed: ${args[0]}`; forceUpdate(); }
                        else output = `rm: no such file`;
                    } else output = 'usage: rm <file>';
                    break;
                case 'npm':
                    if (args[0] === 'install' || args[0] === 'i') {
                        const pkg = args[1] || 'deps';
                        logTerminal(`\x1b[32m[npm] Installing ${pkg}...\x1b[0m`);
                        setTimeout(() => { logTerminal(`\x1b[32m+ ${pkg}@latest\x1b[0m`); logTerminal(`added packages in 400ms`); }, 600);
                        return;
                    } else if (args[0] === 'start') {
                        setActiveTab('PREVIEW');
                        output = '> vite dev server running...';
                    }
                    break;
                default: output = `Command not found: ${cmd}`;
            }

            if (redirectFile) {
                vfs.createFile(cwdId!, redirectFile, output);
                logTerminal(`Redirected output to ${redirectFile}`);
                forceUpdate();
            } else if (output) {
                logTerminal(output);
            }
        } catch (e: any) {
            logTerminal(`\x1b[31mError: ${e.message}\x1b[0m`);
        }
    };

    // --- COMPONENTS ---
    const FileTreeItem: React.FC<{ node: FileNode, depth: number }> = ({ node, depth }) => {
        const isExpanded = expandedFolders.has(node.id);
        const isFile = node.type === 'FILE';
        const Icon = isFile
            ? (node.name.endsWith('tsx') ? FileCode : node.name.endsWith('json') ? FileJson : File)
            : FolderOpen;

        return (
            <div>
                <div
                    className={`flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-slate-800 text-xs ${activeFileId === node.id ? 'bg-cyan-900/20 text-cyan-400' : 'text-slate-400'} transition-colors`}
                    style={{ paddingLeft: `${depth * 12 + 8}px` }}
                    onClick={() => isFile ? handleOpenFile(node) : toggleFolder(node.id)}
                >
                    {!isFile && (
                        <span className="text-slate-600">
                            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        </span>
                    )}
                    {isFile && <span className="w-2.5" />}
                    <Icon size={14} className={node.type === 'FOLDER' ? 'text-yellow-500' : 'text-blue-400'} />
                    <span className="truncate">{node.name}</span>

                    {!isFile && (
                        <button
                            className="ml-auto opacity-0 hover:opacity-100 text-slate-500 hover:text-green-400"
                            onClick={(e) => { e.stopPropagation(); handleCreateFile(node.id); }}
                            title="New File"
                        >
                            <Plus size={10} />
                        </button>
                    )}
                </div>
                {!isFile && isExpanded && (
                    vfs.getFileTree(node.id).map(child => (
                        <FileTreeItem key={child.id} node={child} depth={depth + 1} />
                    ))
                )}
            </div>
        );
    };

    const getPreviewCode = (): string => {
        if (!activeProject) return "// No active project";

        // Recursive search for App.tsx
        const findApp = (folderId: string): string | null => {
            const tree = vfs.getFileTree(folderId);
            for (const node of tree) {
                if (node.type === 'FILE' && node.name === 'App.tsx') return node.content || null;
                if (node.type === 'FOLDER') {
                    const found = findApp(node.id);
                    if (found) return found;
                }
            }
            return null;
        };

        const appCode = findApp(activeProject.rootFolderId);
        if (!appCode && activeFileNode?.name.endsWith('.tsx')) return activeFileNode.content || '';
        return appCode || "// Error: Could not find 'App.tsx' in project.";
    };

    // --- RENDER ---
    if (!activeProject) {
        return (
            <div className="h-full flex flex-col gap-6 p-8 items-center justify-center animate-in fade-in zoom-in-95">
                <div className="text-center mb-8">
                    <div className="w-20 h-20 bg-cyan-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-cyan-500/30">
                        <HardDrive size={40} className="text-cyan-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Dynamic Workspace V2</h1>
                    <p className="text-slate-400 mt-2">Select a VFS Project to mount the file system.</p>
                </div>

                {/* PR Notification - Shows when Silhouette has pending PRs */}
                <div className="mb-6">
                    <PRNotification onOpenPR={(prNumber) => {
                        // Refresh projects to pick up newly ingested PR project
                        setProjects(vfs.getProjects());
                    }} />
                </div>

                {isCreatingProject ? (
                    <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 w-full max-w-md backdrop-blur-sm">
                        <h3 className="text-white font-bold mb-4">Initialize New Project</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-slate-400 uppercase font-bold block mb-1">Project Name</label>
                                <input
                                    autoFocus
                                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-cyan-500"
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    placeholder="my-awesome-app"
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button onClick={() => setIsCreatingProject(false)} className="flex-1 py-2 text-xs text-slate-400 hover:text-white">Cancel</button>
                                <button onClick={handleCreateProject} disabled={!newProjectName} className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold text-xs disabled:opacity-50">Create Project</button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <button
                            onClick={() => setIsCreatingProject(true)}
                            className="h-32 rounded-xl border border-dashed border-slate-700 bg-slate-900/20 hover:bg-slate-900/50 hover:border-cyan-500/50 flex flex-col items-center justify-center gap-2 group transition-all"
                        >
                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-cyan-600 transition-colors">
                                <Plus size={20} className="text-slate-400 group-hover:text-white" />
                            </div>
                            <span className="text-sm font-bold text-slate-400 group-hover:text-white">Create New Project</span>
                        </button>

                        {projects.map(p => (
                            <div
                                key={p.id}
                                onClick={() => setActiveProject(p)}
                                className="h-32 rounded-xl border border-slate-800 bg-slate-900/50 p-4 hover:border-cyan-500 hover:shadow-[0_0_15px_rgba(6,182,212,0.1)] cursor-pointer relative group transition-all flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex justify-between items-start">
                                        <h3 className="text-white font-bold truncate pr-4">{p.name}</h3>
                                        <button onClick={(e) => handleDeleteProject(e, p.id)} className="text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1 mt-1">
                                        {p.type === 'REACT' ? <Globe size={10} /> : <Server size={10} />}
                                        {p.type} App
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // --- RENDER WORKSPACE ---
    return (
        <div className="h-full flex flex-col gap-4 animate-in fade-in">
            {/* PR Review Toolbar - Shown when viewing a PR project */}
            {isPRReviewProject && prInfo && (
                <PRToolbar
                    projectName={activeProject.name}
                    prNumber={prInfo.number}
                    ciStatus={prInfo.ciStatus}
                    prUrl={prInfo.url}
                    onApproved={() => setActiveProject(null)}
                    onRejected={() => setActiveProject(null)}
                />
            )}

            {/* Toolbar */}
            <div className="glass-panel p-2 rounded-xl flex justify-between items-center">
                <div className="flex items-center gap-3 px-2">
                    <button onClick={() => setActiveProject(null)} className="text-slate-500 hover:text-white transition-colors">
                        <LayoutTemplate size={18} />
                    </button>
                    <div className="h-4 w-px bg-slate-700 mx-1"></div>
                    <div>
                        <h1 className="text-sm font-bold text-white flex items-center gap-2">
                            {activeProject.name}
                            {unsavedChanges.size > 0 && <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" title="Unsaved Changes" />}
                        </h1>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                            <span className="flex items-center gap-1"><HardDrive size={10} /> VFS Mounted</span>
                            <span className="flex items-center gap-1 text-cyan-400"><Eye size={10} /> Vision Active</span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={handleDownload} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs border border-slate-700 transition-all">
                        <Download size={12} /> Export
                    </button>
                    {/* Present button for presentation projects */}
                    {isPresentationProject && (
                        <button
                            onClick={() => {
                                const pres = loadPresentation();
                                if (pres) {
                                    setActivePresentation(pres);
                                    setShowPresentationViewer(true);
                                }
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white rounded text-xs font-bold transition-all shadow-lg shadow-purple-500/20"
                        >
                            <Play size={12} /> Present
                        </button>
                    )}
                    <div className="flex bg-slate-900 rounded p-1 border border-slate-800">
                        <button onClick={() => setActiveTab('CODE')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${activeTab === 'CODE' ? 'bg-cyan-600 text-white' : 'text-slate-500 hover:text-white'}`}>
                            <FileCode size={12} className="inline mr-1" /> Code
                        </button>
                        <button onClick={() => setActiveTab('PREVIEW')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${activeTab === 'PREVIEW' ? 'bg-cyan-600 text-white' : 'text-slate-500 hover:text-white'}`}>
                            <Play size={12} className="inline mr-1" /> Run
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex gap-4 overflow-hidden">
                {/* Explorer */}
                <div className="w-56 glass-panel rounded-xl flex flex-col overflow-hidden border-r border-slate-800">
                    <div className="p-3 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-400 uppercase">Explorer</span>
                        <div className="flex gap-1">
                            <button className="text-slate-500 hover:text-white" onClick={() => handleCreateFile(activeProject.rootFolderId)} title="New File"><Plus size={12} /></button>
                            <button className="text-slate-500 hover:text-white" onClick={() => toggleFolder(activeProject.rootFolderId)} title="Refresh"><RefreshCcw size={12} /></button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                        <FileTreeItem node={vfs.getNode(activeProject.rootFolderId)!} depth={0} />
                    </div>
                </div>

                {/* Editor/Preview */}
                <div className="flex-1 flex flex-col glass-panel rounded-xl overflow-hidden relative border border-slate-800 bg-slate-950">

                    {/* Tabs */}
                    <div className="h-9 bg-slate-950 flex items-end px-2 gap-1 overflow-x-auto border-b border-slate-800 no-scrollbar">
                        {openFiles.map(file => (
                            <div
                                key={file.id}
                                onClick={() => handleOpenFile(file)}
                                className={`
                                    group flex items-center gap-2 px-3 py-1.5 min-w-[120px] max-w-[200px] 
                                    text-xs border-t-2 cursor-pointer select-none transition-colors
                                    ${activeFileId === file.id
                                        ? 'bg-slate-900 text-cyan-400 border-cyan-500 rounded-t-md'
                                        : 'bg-slate-950 text-slate-500 border-transparent hover:bg-slate-900/50 hover:text-slate-300'}
                                `}
                            >
                                <span className={`truncate flex-1 ${unsavedChanges.has(file.id) ? 'italic' : ''}`}>{file.name}</span>
                                {unsavedChanges.has(file.id) && <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
                                <button onClick={(e) => handleCloseFile(e, file.id)} className="opacity-0 group-hover:opacity-100 hover:text-red-400">
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* View */}
                    <div className="flex-1 relative flex flex-col overflow-hidden">
                        {activeTab === 'CODE' ? (
                            activeFileNode ? (
                                <div className="flex-1 relative flex overflow-hidden">
                                    <div className="w-10 bg-slate-950 border-r border-slate-800 text-slate-600 text-xs font-mono text-right py-4 pr-2 select-none opacity-50 overflow-hidden hidden">
                                        {/* Line numbers handled by Monaco now */}
                                    </div>
                                    <div className="flex-1 h-full overflow-hidden">
                                        <MonacoBridge
                                            code={activeFileNode.content || ''}
                                            language={activeFileNode.name.endsWith('.json') ? 'json' : activeFileNode.name.endsWith('.css') ? 'css' : 'typescript'}
                                            onChange={(val) => handleFileChange(val || '')}
                                        />
                                    </div>
                                    {unsavedChanges.has(activeFileId!) && (
                                        <button onClick={handleSave} className="absolute bottom-6 right-6 p-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-full shadow-lg transition-transform hover:scale-110 z-50" title="Save">
                                            <Save size={18} />
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
                                    <FileCode size={48} className="mb-4 opacity-20" />
                                    <p className="text-sm">Select a file to edit.</p>
                                </div>
                            )
                        ) : (
                            <div className="flex-1 bg-white relative overflow-auto" id="workspace-preview-container">
                                <div className="absolute top-0 left-0 right-0 bg-slate-100 border-b border-slate-300 px-2 py-1 flex items-center gap-2">
                                    <div className="flex gap-1">
                                        <div className="w-2 h-2 rounded-full bg-red-400" />
                                        <div className="w-2 h-2 rounded-full bg-yellow-400" />
                                        <div className="w-2 h-2 rounded-full bg-green-400" />
                                    </div>
                                    <div className="bg-white px-2 py-0.5 rounded text-[10px] text-slate-500 border border-slate-200 flex-1 text-center font-mono">
                                        http://localhost:3000
                                    </div>
                                </div>
                                <div className="pt-8 h-full">
                                    <RuntimeApp code={getPreviewCode()} />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Terminal */}
                    <div
                        className="h-48 bg-black border-t border-slate-800 p-2 overflow-y-auto custom-scrollbar font-mono text-xs flex flex-col"
                        onClick={() => terminalInputRef.current?.focus()}
                    >
                        <div className="flex items-center gap-2 text-slate-500 mb-1 sticky top-0 bg-black py-1 border-b border-slate-800/50">
                            <TerminalIcon size={12} /> Console Output
                        </div>
                        {terminalLines.map((line, i) => (
                            <div key={i} className="whitespace-pre-wrap break-all leading-tight mb-0.5">
                                <span className={line.includes('[32m') ? "text-green-400" : line.includes('[31m') ? "text-red-400" : line.includes('[36m') ? "text-cyan-400" : "text-slate-400"}>
                                    {line.replace(/\x1b\[[0-9;]*m/g, '')}
                                </span>
                            </div>
                        ))}
                        <div className="flex items-center gap-2 text-slate-300 mt-1">
                            <span className="text-green-500 font-bold">➜</span>
                            <span className="text-cyan-400">{getPathString(cwdId!)}</span>
                            <span className="text-slate-500">$</span>
                            <input
                                ref={terminalInputRef}
                                className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-800"
                                value={terminalInput}
                                onChange={e => setTerminalInput(e.target.value)}
                                onKeyDown={handleTerminalKeyDown}
                                autoComplete="off"
                                spellCheck="false"
                            />
                        </div>
                        <div ref={terminalEndRef} />
                    </div>
                </div>
            </div>
            {/* Command Palette Overlay */}
            <CommandPalette
                isOpen={isCmdPaletteOpen}
                onClose={() => setIsCmdPaletteOpen(false)}
                files={vfs.getFileTree(activeProject?.id || 'root')}
                onOpenFile={(id) => {
                    const node = vfs.getNode(id);
                    if (node && node.type === 'FILE') handleOpenFile(node);
                }}
                onRunCommand={handleCommand}
            />

            {/* Presentation Viewer Overlay */}
            {showPresentationViewer && activePresentation && (
                <Suspense fallback={
                    <div className="fixed inset-0 z-50 bg-slate-900 flex items-center justify-center">
                        <div className="text-cyan-400 animate-pulse">Loading Presentation...</div>
                    </div>
                }>
                    <PresentationViewer
                        presentation={activePresentation}
                        onClose={() => {
                            setShowPresentationViewer(false);
                            setActivePresentation(null);
                        }}
                    />
                </Suspense>
            )}
        </div>
    );
};

export default DynamicWorkspace;