/**
 * AssetManagerTab - Unified Asset Browser UI
 * 
 * Full-featured asset management interface with:
 * - Grid/List view toggle
 * - Filter by type, tags, folder
 * - Search functionality
 * - Bulk actions
 * - Rich preview modal
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Grid3X3, List, Search, Filter, Star, Archive, Trash2,
    FolderOpen, Tag, Image, Video, FileAudio, FileText,
    RefreshCw, Download, MoreVertical, Check
} from 'lucide-react';
import { AssetPreviewModal } from './AssetPreviewModal';

interface Asset {
    id: string;
    type: 'image' | 'video' | 'audio' | 'document';
    name: string;
    description?: string;
    filePath: string;
    thumbnailPath?: string;
    sizeBytes?: number;
    mimeType?: string;
    prompt?: string;
    provider?: string;
    tags: string[];
    folder: string;
    isFavorite: boolean;
    isArchived: boolean;
    createdAt: number;
}

interface AssetManagerTabProps {
    onAssetSelect?: (asset: Asset) => void;
    onInsertMention?: (mention: string) => void;
    onSendToChat?: (asset: Asset) => void;
}

const ASSET_TYPE_ICONS: Record<string, React.ReactNode> = {
    image: <Image size={16} className="text-blue-400" />,
    video: <Video size={16} className="text-purple-400" />,
    audio: <FileAudio size={16} className="text-green-400" />,
    document: <FileText size={16} className="text-yellow-400" />
};

export const AssetManagerTab: React.FC<AssetManagerTabProps> = ({
    onAssetSelect,
    onInsertMention,
    onSendToChat
}) => {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeType, setActiveType] = useState<string | null>(null);
    const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
    const [stats, setStats] = useState<any>(null);

    // Preview modal state
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

    // Fetch assets
    const fetchAssets = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (activeType) params.append('type', activeType);
            if (searchQuery) params.append('query', searchQuery);
            params.append('isArchived', 'false');

            const res = await fetch(`/v1/media/catalog?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setAssets(data.assets || []);
                setStats(data.stats);
            }
        } catch (e) {
            console.error('Failed to fetch assets:', e);
        } finally {
            setLoading(false);
        }
    }, [activeType, searchQuery]);

    useEffect(() => {
        fetchAssets();
    }, [fetchAssets]);

    // Open preview modal
    const handleOpenPreview = (asset: Asset) => {
        setPreviewAsset(asset);
        setIsPreviewOpen(true);
        onAssetSelect?.(asset);
    };

    // Handle selection
    const toggleSelect = (id: string) => {
        setSelectedAssets(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Handle actions
    const handleDelete = async (ids: string[]) => {
        if (!confirm(`Delete ${ids.length} asset(s)?`)) return;

        for (const id of ids) {
            await fetch(`/v1/media/catalog/${id}`, { method: 'DELETE' });
        }
        setSelectedAssets(new Set());
        setIsPreviewOpen(false);
        fetchAssets();
    };

    const handleToggleFavorite = async (id: string) => {
        await fetch(`/v1/media/catalog/${id}/favorite`, { method: 'POST' });
        fetchAssets();
    };

    const handleArchive = async (ids: string[]) => {
        for (const id of ids) {
            await fetch(`/v1/media/catalog/${id}/archive`, { method: 'POST' });
        }
        setSelectedAssets(new Set());
        fetchAssets();
    };

    // Format file size
    const formatSize = (bytes?: number) => {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Format date
    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString('es', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    return (
        <div className="flex flex-col h-full bg-slate-900 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-700">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <FolderOpen size={20} className="text-cyan-400" />
                        Asset Manager
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded ${viewMode === 'grid' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Grid3X3 size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded ${viewMode === 'list' ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white'}`}
                        >
                            <List size={18} />
                        </button>
                        <button
                            onClick={fetchAssets}
                            className="p-2 rounded text-slate-400 hover:text-white"
                        >
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search assets..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-600 rounded-lg
                            text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                </div>

                {/* Type Filters */}
                <div className="flex gap-2 flex-wrap">
                    <button
                        onClick={() => setActiveType(null)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                            ${!activeType ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                    >
                        All {stats?.total ? `(${stats.total})` : ''}
                    </button>
                    {['image', 'video', 'audio', 'document'].map(type => (
                        <button
                            key={type}
                            onClick={() => setActiveType(type)}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5
                                ${activeType === type ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                        >
                            {ASSET_TYPE_ICONS[type]}
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                            {stats?.byType?.[type] ? ` (${stats.byType[type]})` : ''}
                        </button>
                    ))}
                </div>

                {/* Bulk Actions */}
                {selectedAssets.size > 0 && (
                    <div className="flex items-center gap-2 mt-4 p-3 bg-slate-800 rounded-lg">
                        <span className="text-sm text-slate-400">{selectedAssets.size} selected</span>
                        <div className="flex-1" />
                        <button
                            onClick={() => handleArchive(Array.from(selectedAssets))}
                            className="px-3 py-1.5 bg-orange-500/20 text-orange-400 rounded-lg text-sm hover:bg-orange-500/30"
                        >
                            <Archive size={14} className="inline mr-1" /> Archive
                        </button>
                        <button
                            onClick={() => handleDelete(Array.from(selectedAssets))}
                            className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-sm hover:bg-red-500/30"
                        >
                            <Trash2 size={14} className="inline mr-1" /> Delete
                        </button>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-slate-400">
                        <RefreshCw className="animate-spin mr-2" /> Loading...
                    </div>
                ) : assets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <FolderOpen size={48} className="mb-2 opacity-50" />
                        <p>No assets found</p>
                        <p className="text-sm">Generate some images or videos to see them here</p>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {assets.map(asset => (
                            <div
                                key={asset.id}
                                onClick={() => handleOpenPreview(asset)}
                                className={`relative group bg-slate-800 rounded-lg overflow-hidden cursor-pointer
                                    border-2 transition-all hover:border-cyan-500
                                    ${selectedAssets.has(asset.id) ? 'border-cyan-500' : 'border-transparent'}`}
                            >
                                {/* Thumbnail */}
                                <div className="aspect-square bg-slate-700 flex items-center justify-center">
                                    {asset.type === 'image' && asset.filePath ? (
                                        <img
                                            src={`/uploads/${asset.filePath.replace(/^.*uploads[\\\/]/, '').replace(/\\/g, '/')}`}
                                            alt={asset.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : asset.type === 'video' && asset.filePath ? (
                                        <video
                                            src={`/uploads/${asset.filePath.replace(/^.*uploads[\\\/]/, '').replace(/\\/g, '/')}`}
                                            className="w-full h-full object-cover"
                                            muted
                                        />
                                    ) : (
                                        <div className="text-4xl opacity-50">
                                            {ASSET_TYPE_ICONS[asset.type]}
                                        </div>
                                    )}
                                </div>

                                {/* Selection checkbox */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}
                                    className={`absolute top-2 left-2 w-5 h-5 rounded border 
                                        ${selectedAssets.has(asset.id)
                                            ? 'bg-cyan-500 border-cyan-500'
                                            : 'border-slate-400 bg-slate-800/80 opacity-0 group-hover:opacity-100'}`}
                                >
                                    {selectedAssets.has(asset.id) && <Check size={14} className="text-white" />}
                                </button>

                                {/* Favorite button */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(asset.id); }}
                                    className={`absolute top-2 right-2 p-1 rounded 
                                        ${asset.isFavorite ? 'text-yellow-400' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                                >
                                    <Star size={16} fill={asset.isFavorite ? 'currentColor' : 'none'} />
                                </button>

                                {/* Info */}
                                <div className="p-2">
                                    <p className="text-sm text-white truncate">{asset.name}</p>
                                    <p className="text-xs text-slate-400 flex items-center gap-1">
                                        {ASSET_TYPE_ICONS[asset.type]}
                                        {formatSize(asset.sizeBytes)}
                                    </p>
                                </div>

                                {/* Insert mention button */}
                                {onInsertMention && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onInsertMention(`@${asset.name}`); }}
                                        className="absolute bottom-2 right-2 px-2 py-1 bg-cyan-500 text-white text-xs rounded
                                            opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        @Mention
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {assets.map(asset => (
                            <div
                                key={asset.id}
                                onClick={() => handleOpenPreview(asset)}
                                className={`flex items-center gap-4 p-3 bg-slate-800 rounded-lg cursor-pointer
                                    border-2 transition-all hover:border-cyan-500
                                    ${selectedAssets.has(asset.id) ? 'border-cyan-500' : 'border-transparent'}`}
                            >
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}
                                    className={`w-5 h-5 rounded border flex-shrink-0
                                        ${selectedAssets.has(asset.id) ? 'bg-cyan-500 border-cyan-500' : 'border-slate-400'}`}
                                >
                                    {selectedAssets.has(asset.id) && <Check size={14} className="text-white" />}
                                </button>

                                <div className="w-12 h-12 bg-slate-700 rounded flex items-center justify-center flex-shrink-0">
                                    {ASSET_TYPE_ICONS[asset.type]}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <p className="text-white truncate">{asset.name}</p>
                                    <p className="text-xs text-slate-400">{asset.prompt?.slice(0, 50)}...</p>
                                </div>

                                <div className="text-right text-sm text-slate-400 flex-shrink-0">
                                    <p>{formatSize(asset.sizeBytes)}</p>
                                    <p>{formatDate(asset.createdAt)}</p>
                                </div>

                                <button
                                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(asset.id); }}
                                    className={asset.isFavorite ? 'text-yellow-400' : 'text-slate-400'}
                                >
                                    <Star size={16} fill={asset.isFavorite ? 'currentColor' : 'none'} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer Stats */}
            {stats && (
                <div className="p-3 border-t border-slate-700 text-xs text-slate-400 flex items-center justify-between">
                    <span>
                        {stats.total} assets • {formatSize(stats.totalSizeBytes)} total
                    </span>
                    <span>
                        ⭐ {stats.favorites} favorites • 📦 {stats.archived} archived
                    </span>
                </div>
            )}

            {/* Preview Modal */}
            <AssetPreviewModal
                asset={previewAsset}
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                onDelete={(id) => handleDelete([id])}
                onFavorite={handleToggleFavorite}
                onSendToChat={onSendToChat}
            />
        </div>
    );
};

export default AssetManagerTab;

