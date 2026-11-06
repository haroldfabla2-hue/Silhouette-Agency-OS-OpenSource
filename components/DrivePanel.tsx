// =============================================================================
// Drive Panel
// Lightweight Google Drive file browser - lazy-loaded side panel
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react';

interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    size?: number;
    thumbnailLink?: string;
    webViewLink?: string;
    modifiedTime?: string;
}

interface DrivePanelProps {
    isOpen: boolean;
    onClose: () => void;
    onFileSelect?: (file: DriveFile) => void;
}

export const DrivePanel: React.FC<DrivePanelProps> = ({ isOpen, onClose, onFileSelect }) => {
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentFolder, setCurrentFolder] = useState<string | null>(null);
    const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([
        { id: null, name: 'My Drive' }
    ]);

    // Check connection status
    useEffect(() => {
        if (isOpen) {
            checkStatus();
        }
    }, [isOpen]);

    const checkStatus = async () => {
        try {
            const res = await fetch('/v1/drive/status');
            const data = await res.json();
            setConnected(data.authenticated);
            if (data.authenticated) {
                loadFiles();
            }
        } catch (e) {
            setConnected(false);
        }
    };

    const loadFiles = async (folderId?: string) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (folderId) params.append('folderId', folderId);
            if (searchQuery) params.append('query', searchQuery);

            const res = await fetch(`/v1/drive/files?${params.toString()}`);
            const data = await res.json();
            setFiles(data.files || []);
        } catch (e) {
            console.error('[DrivePanel] Load failed:', e);
        } finally {
            setLoading(false);
        }
    };

    // Track auth polling interval so it can be cleaned up on unmount
    const authIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        return () => {
            // Clean up auth polling if component unmounts during OAuth flow
            if (authIntervalRef.current) {
                clearInterval(authIntervalRef.current);
                authIntervalRef.current = null;
            }
        };
    }, []);

    const handleConnect = () => {
        window.open('/v1/drive/auth', 'Google Drive', 'width=500,height=600');
        // Clear any previous polling
        if (authIntervalRef.current) clearInterval(authIntervalRef.current);

        authIntervalRef.current = setInterval(async () => {
            try {
                const res = await fetch('/v1/drive/status');
                const data = await res.json();
                if (data.authenticated) {
                    if (authIntervalRef.current) clearInterval(authIntervalRef.current);
                    authIntervalRef.current = null;
                    setConnected(true);
                    loadFiles();
                }
            } catch { /* ignore polling errors */ }
        }, 2000);
        // Stop after 2 minutes
        setTimeout(() => {
            if (authIntervalRef.current) {
                clearInterval(authIntervalRef.current);
                authIntervalRef.current = null;
            }
        }, 120000);
    };

    const handleFolderClick = (folder: DriveFile) => {
        setCurrentFolder(folder.id);
        setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
        loadFiles(folder.id);
    };

    const handleBreadcrumbClick = (index: number) => {
        const crumb = breadcrumbs[index];
        setCurrentFolder(crumb.id);
        setBreadcrumbs(prev => prev.slice(0, index + 1));
        loadFiles(crumb.id || undefined);
    };

    const isFolder = (file: DriveFile) => file.mimeType === 'application/vnd.google-apps.folder';

    const formatSize = (bytes?: number) => {
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    if (!isOpen) return null;

    return (
        <>
            <button
                type="button"
                className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
                onClick={onClose}
                aria-label="Close Google Drive panel"
            />

            <div className="fixed right-0 top-0 z-40 h-[100dvh] w-full max-w-sm bg-slate-800/95 backdrop-blur-sm border-l border-slate-700 shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-700">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg shrink-0">📁</span>
                        <span className="text-sm font-medium text-white truncate">Google Drive</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                    >
                        ✕
                    </button>
                </div>

                {!connected ? (
                    /* Not connected */
                    <div className="flex-1 flex items-center justify-center p-4">
                        <div className="text-center max-w-xs">
                            <p className="text-slate-400 text-sm mb-4">Connect your Google Drive</p>
                            <button
                                onClick={handleConnect}
                                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                            >
                                🔗 Connect
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Breadcrumbs */}
                        <div className="px-3 py-2 border-b border-slate-700 text-xs text-slate-400 flex items-center gap-1 overflow-x-auto custom-scrollbar">
                            {breadcrumbs.map((crumb, i) => (
                                <React.Fragment key={crumb.id || 'root'}>
                                    {i > 0 && <span className="text-slate-600">/</span>}
                                    <button
                                        onClick={() => handleBreadcrumbClick(i)}
                                        className="hover:text-white truncate max-w-[120px]"
                                    >
                                        {crumb.name}
                                    </button>
                                </React.Fragment>
                            ))}
                        </div>

                        {/* Search */}
                        <div className="p-3 border-b border-slate-700">
                            <input
                                type="text"
                                placeholder="Search files..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && loadFiles(currentFolder || undefined)}
                                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-500"
                            />
                        </div>

                        {/* File list */}
                        <div className="flex-1 overflow-y-auto p-2 sm:p-3 custom-scrollbar">
                            {loading ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : files.length === 0 ? (
                                <p className="text-center text-slate-500 text-xs py-4">No files</p>
                            ) : (
                                <div className="space-y-1">
                                    {files.map((file) => (
                                        <div
                                            key={file.id}
                                            onClick={() => isFolder(file) ? handleFolderClick(file) : onFileSelect?.(file)}
                                            className="flex items-center gap-3 p-2.5 hover:bg-slate-700/50 rounded cursor-pointer group"
                                        >
                                            <span className="text-lg shrink-0">
                                                {isFolder(file) ? '📁' :
                                                    file.mimeType.startsWith('image/') ? '🖼️' :
                                                        file.mimeType.startsWith('video/') ? '🎬' :
                                                            file.mimeType.includes('pdf') ? '📄' : '📎'}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-white truncate">{file.name}</p>
                                                {file.size && (
                                                    <p className="text-[11px] text-slate-500">{formatSize(file.size)}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-3 border-t border-slate-700 text-xs text-slate-500">
                            {files.length} items
                        </div>
                    </>
                )}
            </div>
        </>
    );
};

export default DrivePanel;
