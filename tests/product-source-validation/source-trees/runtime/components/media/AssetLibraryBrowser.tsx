/**
 * AssetLibraryBrowser - Visual asset management with @mention support
 * Inspired by Figma/Adobe asset libraries with up to 7 reference images per character
 */

import React, { useState, useEffect } from 'react';

type AssetRole = 'character' | 'environment' | 'prop';

interface AssetReference {
    id: string;
    name: string;
    role: AssetRole;
    description?: string;
    referenceImages: string[];
    tags: string[];
    createdAt: string;
}

interface AssetLibraryBrowserProps {
    onInsertMention: (mention: string) => void;
    onSelectAsset?: (asset: AssetReference) => void;
}

const AssetLibraryBrowser: React.FC<AssetLibraryBrowserProps> = ({
    onInsertMention,
    onSelectAsset
}) => {
    const [assets, setAssets] = useState<AssetReference[]>([]);
    const [filter, setFilter] = useState<AssetRole | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAsset, setSelectedAsset] = useState<AssetReference | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newAsset, setNewAsset] = useState({ name: '', role: 'character' as AssetRole, description: '' });
    const [loading, setLoading] = useState(true);

    // Fetch assets on mount
    useEffect(() => {
        fetchAssets();
    }, []);

    const fetchAssets = async () => {
        try {
            const res = await fetch('/v1/media/assets/library');
            if (res.ok) {
                const data = await res.json();
                setAssets(data.assets || []);
            }
        } catch (e) {
            console.error('Failed to fetch assets:', e);
            // Demo data fallback
            setAssets([
                { id: '1', name: 'Alex', role: 'character', description: '30-year-old executive with sharp features', referenceImages: [], tags: ['business', 'male'], createdAt: new Date().toISOString() },
                { id: '2', name: 'ForestEnv', role: 'environment', description: 'Misty forest with golden sunlight', referenceImages: [], tags: ['nature', 'cinematic'], createdAt: new Date().toISOString() },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const createAsset = async () => {
        if (!newAsset.name.trim()) return;

        try {
            const res = await fetch('/v1/media/assets/library', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newAsset)
            });
            if (res.ok) {
                await fetchAssets();
                setIsCreating(false);
                setNewAsset({ name: '', role: 'character', description: '' });
            }
        } catch (e) {
            console.error('Failed to create asset:', e);
        }
    };

    const deleteAsset = async (id: string) => {
        try {
            await fetch(`/v1/media/assets/library/${id}`, { method: 'DELETE' });
            await fetchAssets();
            setSelectedAsset(null);
        } catch (e) {
            console.error('Failed to delete asset:', e);
        }
    };

    const filteredAssets = assets.filter(a => {
        const matchesFilter = filter === 'all' || a.role === filter;
        const matchesSearch = a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            a.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesFilter && matchesSearch;
    });

    const roleIcons: Record<AssetRole, string> = {
        character: '🧑',
        environment: '🌲',
        prop: '📦'
    };

    const roleColors: Record<AssetRole, string> = {
        character: 'from-purple-500 to-pink-500',
        environment: 'from-green-500 to-teal-500',
        prop: 'from-amber-500 to-orange-500'
    };

    return (
        <div className="bg-slate-900/80 rounded-xl border border-slate-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-slate-700">
                <div className="flex items-center gap-2">
                    <span className="text-lg">🎭</span>
                    <span className="text-sm font-medium text-white">Asset Library</span>
                    <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">
                        {assets.length}
                    </span>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="px-3 py-1 text-xs bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors"
                >
                    + New Asset
                </button>
            </div>

            {/* Tab Filters */}
            <div className="flex gap-1 p-2 border-b border-slate-700/50">
                {(['all', 'character', 'environment', 'prop'] as const).map(role => (
                    <button
                        key={role}
                        onClick={() => setFilter(role)}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-all ${filter === role
                                ? 'bg-white/10 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        {role === 'all' ? '📁 All' : `${roleIcons[role]} ${role.charAt(0).toUpperCase() + role.slice(1)}s`}
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="p-2">
                <input
                    type="text"
                    placeholder="🔍 Search assets..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
            </div>

            {/* Asset Grid */}
            <div className="p-2 max-h-64 overflow-y-auto">
                {loading ? (
                    <div className="text-center py-8 text-slate-500">Loading...</div>
                ) : filteredAssets.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm">
                        No assets found. Create one to get started.
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-2">
                        {filteredAssets.map(asset => (
                            <button
                                key={asset.id}
                                onClick={() => {
                                    setSelectedAsset(asset);
                                    onSelectAsset?.(asset);
                                }}
                                className={`p-3 rounded-lg border text-left transition-all ${selectedAsset?.id === asset.id
                                        ? 'border-cyan-500 bg-cyan-500/10'
                                        : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
                                    }`}
                            >
                                <div className={`w-full h-12 rounded-lg bg-gradient-to-br ${roleColors[asset.role]} flex items-center justify-center text-2xl mb-2`}>
                                    {asset.referenceImages.length > 0 ? (
                                        <img
                                            src={asset.referenceImages[0]}
                                            alt={asset.name}
                                            className="w-full h-full object-cover rounded-lg"
                                        />
                                    ) : (
                                        roleIcons[asset.role]
                                    )}
                                </div>
                                <div className="text-xs text-white font-medium truncate">@{asset.name}</div>
                                <div className="text-[10px] text-slate-400">
                                    {asset.referenceImages.length} refs
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Selected Asset Detail */}
            {selectedAsset && (
                <div className="p-3 border-t border-slate-700 bg-slate-800/50">
                    <div className="flex items-start justify-between mb-2">
                        <div>
                            <span className="text-sm font-medium text-cyan-400">@{selectedAsset.name}</span>
                            <span className="text-xs text-slate-500 ml-2">{selectedAsset.role}</span>
                        </div>
                        <span className="text-lg">{roleIcons[selectedAsset.role]}</span>
                    </div>

                    {selectedAsset.description && (
                        <p className="text-xs text-slate-400 mb-2 line-clamp-2">
                            {selectedAsset.description}
                        </p>
                    )}

                    {selectedAsset.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                            {selectedAsset.tags.map(tag => (
                                <span key={tag} className="px-2 py-0.5 text-[10px] bg-slate-700 text-slate-300 rounded-full">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <button
                            onClick={() => onInsertMention(`@${selectedAsset.name}`)}
                            className="flex-1 px-3 py-1.5 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
                        >
                            Insert @{selectedAsset.name}
                        </button>
                        <button
                            onClick={() => deleteAsset(selectedAsset.id)}
                            className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                        >
                            🗑️
                        </button>
                    </div>
                </div>
            )}

            {/* Create Asset Modal */}
            {isCreating && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-600 w-80">
                        <h3 className="text-sm font-medium text-white mb-3">Create New Asset</h3>

                        <input
                            type="text"
                            placeholder="Asset name (e.g., Alex, ForestEnv)"
                            value={newAsset.name}
                            onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
                            className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-white mb-2"
                        />

                        <select
                            value={newAsset.role}
                            onChange={(e) => setNewAsset({ ...newAsset, role: e.target.value as AssetRole })}
                            className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-white mb-2"
                        >
                            <option value="character">🧑 Character</option>
                            <option value="environment">🌲 Environment</option>
                            <option value="prop">📦 Prop</option>
                        </select>

                        <textarea
                            placeholder="Description (detailed visual description for AI)"
                            value={newAsset.description}
                            onChange={(e) => setNewAsset({ ...newAsset, description: e.target.value })}
                            className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-white mb-3 h-20 resize-none"
                        />

                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsCreating(false)}
                                className="flex-1 px-3 py-2 text-xs bg-slate-700 text-white rounded-lg hover:bg-slate-600"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={createAsset}
                                className="flex-1 px-3 py-2 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AssetLibraryBrowser;
