// =============================================================================
// Nexus Canvas - Asset Browser Panel
// Browse and drag-drop assets from AssetCatalog into the canvas
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useCanvasStore } from '../store/useCanvasStore';

interface Asset {
    id: string;
    type: 'image' | 'video' | 'audio' | 'document';
    name: string;
    filePath: string;
    thumbnailPath?: string;
    tags: string[];
    prompt?: string;
    createdAt: number;
}

interface AssetBrowserPanelProps {
    /** Callback when asset is dropped on canvas */
    onAssetDrop?: (asset: Asset) => void;
}

export const AssetBrowserPanel: React.FC<AssetBrowserPanelProps> = ({ onAssetDrop }) => {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'image' | 'video'>('image');
    const [draggedAsset, setDraggedAsset] = useState<Asset | null>(null);

    const { addLayer, updateLayer } = useCanvasStore();

    // Fetch assets from catalog
    const fetchAssets = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filter !== 'all') params.append('type', filter);
            if (searchQuery) params.append('query', searchQuery);
            params.append('isArchived', 'false');
            params.append('limit', '50');

            const res = await fetch(`/v1/media/catalog?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setAssets(data.assets || []);
            }
        } catch (e) {
            console.error('[AssetBrowser] Failed to fetch:', e);
        } finally {
            setLoading(false);
        }
    }, [filter, searchQuery]);

    useEffect(() => {
        fetchAssets();
    }, [fetchAssets]);

    // Handle drag start
    const handleDragStart = (e: React.DragEvent, asset: Asset) => {
        setDraggedAsset(asset);
        e.dataTransfer.setData('application/json', JSON.stringify(asset));
        e.dataTransfer.effectAllowed = 'copy';
    };

    // Handle drop on canvas (called externally)
    const handleAssetSelect = async (asset: Asset) => {
        // Create a new layer with the asset image
        const layerId = addLayer(`Asset: ${asset.name}`, 'raster');

        // Load the image and convert to base64
        try {
            // Use the file path to load via API
            const response = await fetch(`/uploads/${asset.filePath.split('uploads/')[1]}`);
            if (response.ok) {
                const blob = await response.blob();
                const reader = new FileReader();
                reader.onload = () => {
                    const base64 = reader.result as string;
                    updateLayer(layerId, {
                        imageData: base64,
                        name: asset.name
                    });
                };
                reader.readAsDataURL(blob);
            }
        } catch (e) {
            console.warn('[AssetBrowser] Failed to load asset image:', e);
        }

        onAssetDrop?.(asset);
    };

    // Get thumbnail URL
    const getThumbnailUrl = (asset: Asset): string => {
        if (asset.thumbnailPath) {
            const relativePath = asset.thumbnailPath.split('uploads/')[1];
            return relativePath ? `/uploads/${relativePath}` : '/placeholder.png';
        }
        // Fallback to main file for images
        if (asset.type === 'image' && asset.filePath) {
            const relativePath = asset.filePath.split('uploads/')[1];
            return relativePath ? `/uploads/${relativePath}` : '/placeholder.png';
        }
        return '/placeholder.png';
    };

    return (
        <div className="flex flex-col h-full bg-slate-800/80 backdrop-blur-sm">
            {/* Header */}
            <div className="p-2 border-b border-slate-700">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white">Assets</span>
                    <button
                        onClick={fetchAssets}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                        title="Refresh"
                    >
                        🔄
                    </button>
                </div>

                {/* Search */}
                <input
                    type="text"
                    placeholder="Search assets..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />

                {/* Filter tabs */}
                <div className="flex gap-1 mt-2">
                    {(['all', 'image', 'video'] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-2 py-0.5 text-xs rounded transition-colors ${filter === f
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                }`}
                        >
                            {f === 'all' ? 'All' : f === 'image' ? '🖼️' : '🎬'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Asset Grid */}
            <div className="flex-1 overflow-y-auto p-2">
                {loading ? (
                    <div className="flex items-center justify-center h-20">
                        <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full" />
                    </div>
                ) : assets.length === 0 ? (
                    <div className="text-center text-slate-500 text-xs py-4">
                        No assets found
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {assets.map((asset) => (
                            <div
                                key={asset.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, asset)}
                                onClick={() => handleAssetSelect(asset)}
                                className="group relative aspect-square bg-slate-900 rounded-lg overflow-hidden cursor-pointer border border-transparent hover:border-cyan-500 transition-all"
                                title={`${asset.name}\n${asset.prompt || 'No prompt'}`}
                            >
                                {/* Thumbnail */}
                                <img
                                    src={getThumbnailUrl(asset)}
                                    alt={asset.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23334155" width="100" height="100"/><text x="50" y="55" font-size="40" text-anchor="middle" fill="%2394a3b8">🖼️</text></svg>';
                                    }}
                                />

                                {/* Overlay on hover */}
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-1.5">
                                    <span className="text-white text-xs truncate font-medium">
                                        {asset.name}
                                    </span>
                                    {asset.tags.length > 0 && (
                                        <div className="flex gap-0.5 mt-0.5 overflow-hidden">
                                            {asset.tags.slice(0, 2).map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="px-1 py-0.5 bg-cyan-500/30 text-cyan-300 text-[10px] rounded"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Drag indicator */}
                                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-white text-xs bg-black/50 px-1 rounded">⤵️</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer info */}
            <div className="px-2 py-1.5 border-t border-slate-700 text-xs text-slate-400">
                {assets.length} asset{assets.length !== 1 ? 's' : ''} • Click or drag to add
            </div>
        </div>
    );
};
