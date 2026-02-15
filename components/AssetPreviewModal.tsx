/**
 * AssetPreviewModal - Universal Asset Preview & Editor
 * 
 * Rich preview modal with format-specific viewers:
 * - Images: Zoomable canvas with pan
 * - Videos: HTML5 player with controls
 * - Audio: Player with timeline
 * - Code: Monaco editor (via MonacoBridge)
 * - Documents: iframe viewer
 */

import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
    X, Download, Trash2, Star, Edit3, Send,
    ZoomIn, ZoomOut, RotateCw, Maximize2,
    Play, Pause, Volume2, VolumeX,
    Save, Eye, Code, FileText
} from 'lucide-react';

// Lazy load Monaco to avoid bundle bloat
const MonacoBridge = lazy(() => import('./MonacoBridge'));

interface Asset {
    id: string;
    type: 'image' | 'video' | 'audio' | 'document';
    name: string;
    description?: string;
    filePath: string;
    sizeBytes?: number;
    mimeType?: string;
    prompt?: string;
    tags: string[];
    isFavorite: boolean;
    createdAt: number;
}

interface AssetPreviewModalProps {
    asset: Asset | null;
    isOpen: boolean;
    onClose: () => void;
    onDelete?: (id: string) => void;
    onFavorite?: (id: string) => void;
    onSendToChat?: (asset: Asset) => void;
    onSave?: (id: string, content: string | Blob) => void;
}

// File type detection
const getFileCategory = (filePath: string, mimeType?: string): 'image' | 'video' | 'audio' | 'code' | 'document' => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
    if (['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'json', 'md', 'txt'].includes(ext)) return 'code';
    return 'document';
};

// Get file URL for display
const getAssetUrl = (filePath: string): string => {
    // Handle both absolute and relative paths
    if (filePath.startsWith('http')) return filePath;
    const relativePath = filePath.replace(/.*uploads[\\\/]/, 'uploads/').replace(/\\/g, '/');
    return `/${relativePath}`;
};

export const AssetPreviewModal: React.FC<AssetPreviewModalProps> = ({
    asset,
    isOpen,
    onClose,
    onDelete,
    onFavorite,
    onSendToChat,
    onSave
}) => {
    const [zoom, setZoom] = useState(1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [rotation, setRotation] = useState(0);

    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    // Reset state when asset changes
    useEffect(() => {
        setZoom(1);
        setRotation(0);
        setIsEditing(false);
        setEditContent('');
        setIsPlaying(false);
    }, [asset?.id]);

    // Load code content for editing
    useEffect(() => {
        if (asset && getFileCategory(asset.filePath) === 'code') {
            fetch(getAssetUrl(asset.filePath))
                .then(res => res.text())
                .then(setEditContent)
                .catch(console.error);
        }
    }, [asset]);

    if (!isOpen || !asset) return null;

    const category = getFileCategory(asset.filePath, asset.mimeType);
    const assetUrl = getAssetUrl(asset.filePath);

    const handleZoomIn = () => setZoom(z => Math.min(z + 0.25, 4));
    const handleZoomOut = () => setZoom(z => Math.max(z - 0.25, 0.25));
    const handleRotate = () => setRotation(r => (r + 90) % 360);

    const handlePlayPause = () => {
        const media = videoRef.current || audioRef.current;
        if (media) {
            if (isPlaying) media.pause();
            else media.play();
            setIsPlaying(!isPlaying);
        }
    };

    const handleSaveEdit = async () => {
        if (onSave && editContent) {
            onSave(asset.id, editContent);
            setIsEditing(false);
        }
    };

    const formatDate = (ts: number) => new Date(ts).toLocaleDateString('es', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const formatSize = (bytes?: number) => {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="relative w-[90vw] max-w-5xl h-[85vh] bg-slate-900 rounded-xl shadow-2xl 
                border border-slate-700 flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            {category === 'image' && <FileText size={18} className="text-blue-400" />}
                            {category === 'video' && <Play size={18} className="text-purple-400" />}
                            {category === 'audio' && <Volume2 size={18} className="text-green-400" />}
                            {category === 'code' && <Code size={18} className="text-yellow-400" />}
                            {category === 'document' && <FileText size={18} className="text-orange-400" />}
                        </div>
                        <h2 className="text-lg font-semibold text-white truncate max-w-md">{asset.name}</h2>
                        <span className="px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300">
                            {asset.mimeType || category}
                        </span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
                    {/* Left: View controls */}
                    <div className="flex items-center gap-2">
                        {category === 'image' && (
                            <>
                                <button onClick={handleZoomOut} className="p-2 hover:bg-slate-700 rounded">
                                    <ZoomOut size={18} className="text-slate-300" />
                                </button>
                                <span className="text-sm text-slate-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
                                <button onClick={handleZoomIn} className="p-2 hover:bg-slate-700 rounded">
                                    <ZoomIn size={18} className="text-slate-300" />
                                </button>
                                <div className="w-px h-6 bg-slate-700 mx-2" />
                                <button onClick={handleRotate} className="p-2 hover:bg-slate-700 rounded">
                                    <RotateCw size={18} className="text-slate-300" />
                                </button>
                            </>
                        )}

                        {(category === 'video' || category === 'audio') && (
                            <>
                                <button onClick={handlePlayPause} className="p-2 hover:bg-slate-700 rounded">
                                    {isPlaying ? <Pause size={18} className="text-slate-300" /> : <Play size={18} className="text-slate-300" />}
                                </button>
                                <button onClick={() => setIsMuted(!isMuted)} className="p-2 hover:bg-slate-700 rounded">
                                    {isMuted ? <VolumeX size={18} className="text-slate-300" /> : <Volume2 size={18} className="text-slate-300" />}
                                </button>
                            </>
                        )}

                        {category === 'code' && (
                            <>
                                <button
                                    onClick={() => setIsEditing(!isEditing)}
                                    className={`px-3 py-1.5 rounded flex items-center gap-2 text-sm ${isEditing ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-300'}`}
                                >
                                    {isEditing ? <Eye size={14} /> : <Edit3 size={14} />}
                                    {isEditing ? 'Preview' : 'Edit'}
                                </button>
                                {isEditing && (
                                    <button
                                        onClick={handleSaveEdit}
                                        className="px-3 py-1.5 bg-green-500 text-white rounded flex items-center gap-2 text-sm"
                                    >
                                        <Save size={14} /> Save
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2">
                        <a href={assetUrl} download className="p-2 hover:bg-slate-700 rounded" title="Download">
                            <Download size={18} className="text-slate-300" />
                        </a>
                        {onFavorite && (
                            <button onClick={() => onFavorite(asset.id)} className="p-2 hover:bg-slate-700 rounded" title="Favorite">
                                <Star size={18} className={asset.isFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-slate-300'} />
                            </button>
                        )}
                        {onSendToChat && (
                            <button onClick={() => onSendToChat(asset)} className="p-2 hover:bg-slate-700 rounded" title="Send to Chat">
                                <Send size={18} className="text-slate-300" />
                            </button>
                        )}
                        {onDelete && (
                            <button onClick={() => onDelete(asset.id)} className="p-2 hover:bg-red-500/20 rounded" title="Delete">
                                <Trash2 size={18} className="text-red-400" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Preview Content */}
                <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-slate-950/50">
                    {/* IMAGE */}
                    {category === 'image' && (
                        <div className="overflow-auto max-w-full max-h-full">
                            <img
                                src={assetUrl}
                                alt={asset.name}
                                style={{
                                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                                    transition: 'transform 0.2s ease'
                                }}
                                className="max-w-none"
                            />
                        </div>
                    )}

                    {/* VIDEO */}
                    {category === 'video' && (
                        <video
                            ref={videoRef}
                            src={assetUrl}
                            controls
                            muted={isMuted}
                            className="max-w-full max-h-full rounded"
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                        />
                    )}

                    {/* AUDIO */}
                    {category === 'audio' && (
                        <div className="w-full max-w-2xl p-8 bg-slate-800 rounded-xl">
                            <div className="flex items-center justify-center mb-6">
                                <div className="w-32 h-32 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full 
                                    flex items-center justify-center">
                                    <Volume2 size={48} className="text-white" />
                                </div>
                            </div>
                            <audio
                                ref={audioRef}
                                src={assetUrl}
                                controls
                                muted={isMuted}
                                className="w-full"
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                            />
                        </div>
                    )}

                    {/* CODE */}
                    {category === 'code' && (
                        <div className="w-full h-full flex gap-4">
                            {/* Monaco Editor */}
                            <div className="flex-1 h-full">
                                <Suspense fallback={
                                    <div className="w-full h-full flex items-center justify-center bg-slate-950 rounded border border-slate-700">
                                        <span className="text-slate-400">Loading editor...</span>
                                    </div>
                                }>
                                    <MonacoBridge
                                        code={editContent}
                                        language={asset.filePath.split('.').pop() || 'plaintext'}
                                        onChange={(value) => setEditContent(value || '')}
                                        readOnly={!isEditing}
                                        height="100%"
                                    />
                                </Suspense>
                            </div>

                            {/* Live HTML Preview */}
                            {asset.filePath.endsWith('.html') && (
                                <div className="flex-1 h-full flex flex-col">
                                    <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 text-xs text-slate-400">
                                        Live Preview
                                    </div>
                                    <iframe
                                        srcDoc={editContent}
                                        className="flex-1 bg-white rounded-b border border-slate-700"
                                        sandbox="allow-scripts"
                                        title="HTML Preview"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* DOCUMENT (PDF, etc) */}
                    {category === 'document' && (
                        <iframe
                            src={assetUrl}
                            className="w-full h-full rounded border border-slate-700"
                            title={asset.name}
                        />
                    )}
                </div>

                {/* Footer: Metadata */}
                <div className="px-4 py-3 border-t border-slate-700 bg-slate-800/50">
                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-4 text-slate-400">
                            <span>{formatSize(asset.sizeBytes)}</span>
                            <span>•</span>
                            <span>{formatDate(asset.createdAt)}</span>
                            {asset.tags.length > 0 && (
                                <>
                                    <span>•</span>
                                    <div className="flex gap-1">
                                        {asset.tags.slice(0, 3).map(tag => (
                                            <span key={tag} className="px-2 py-0.5 bg-slate-700 rounded text-xs">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                        {asset.prompt && (
                            <p className="text-slate-500 truncate max-w-md" title={asset.prompt}>
                                💬 {asset.prompt.slice(0, 50)}...
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AssetPreviewModal;
