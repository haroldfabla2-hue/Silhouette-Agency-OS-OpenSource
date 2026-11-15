// =============================================================================
// Nexus Canvas - Layer Panel
// Photoshop-style layer management UI
// =============================================================================

import React, { useMemo } from 'react';
import { useLayers, useCanvasStore } from '../store/useCanvasStore';
import { useResourceAwareCanvas } from '../hooks/useResourceAwareCanvas';
import type { CanvasLayer } from '../../../types/canvas';

// Icons
const EyeIcon = ({ visible }: { visible: boolean }) => (
    <span className={visible ? 'opacity-100' : 'opacity-30'}>👁</span>
);

const LockIcon = ({ locked }: { locked: boolean }) => (
    <span className={locked ? 'opacity-100' : 'opacity-30'}>{locked ? '🔒' : '🔓'}</span>
);

const FolderIcon = ({ open }: { open: boolean }) => (
    <span className="text-yellow-400 opacity-90">{open ? '📂' : '📁'}</span>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
    <span className={`transition-transform duration-100 inline-block text-[10px] text-slate-400 ${open ? 'rotate-90' : ''}`}>
        ▶
    </span>
);

// Helper
const findLayer = (layers: CanvasLayer[], id: string): CanvasLayer | null => {
    for (const l of layers) {
        if (l.id === id) return l;
        if (l.layers) {
            const found = findLayer(l.layers, id);
            if (found) return found;
        }
    }
    return null;
};

interface LayerItemProps {
    layer: CanvasLayer;
    depth: number;
    isSelected: boolean;
    onSelect: () => void;
    onToggleVisibility: () => void;
    onToggleLock: () => void;
    onToggleClip: () => void;
    onToggleExpand: () => void;
    onDelete: () => void;
}

const LayerItem: React.FC<LayerItemProps> = ({
    layer,
    depth,
    isSelected,
    onSelect,
    onToggleVisibility,
    onToggleLock,
    onToggleClip,
    onToggleExpand,
    onDelete
}) => {
    const paddingLeft = (depth * 16) + (layer.clippingMaskId ? 24 : 8);

    // Icon Selection
    const renderIcon = () => {
        if (layer.type === 'group') return <FolderIcon open={!!layer.expanded} />;
        if (layer.type === 'adjustment') return layer.adjustmentType === 'brightness' ? '🔆' : '🎨';
        if (layer.type === 'text') return 'T';
        if (layer.type === 'vector') return '📐';
        return '🖼';
    };

    return (
        <div className="flex flex-col">
            <div
                className={`flex items-center gap-2 py-1.5 cursor-pointer transition-colors relative group
                    ${isSelected ? 'bg-cyan-600/30 border-l-2 border-cyan-500' : 'hover:bg-slate-700/50 border-l-2 border-transparent'}
                `}
                style={{ paddingLeft: `${paddingLeft}px`, paddingRight: '8px' }}
                onClick={onSelect}
            >
                {/* Clipping Arrow */}
                {layer.clippingMaskId && (
                    <span className="absolute text-slate-500 text-xs" style={{ left: `${paddingLeft - 16}px` }}>↳</span>
                )}

                {/* Group Expander */}
                {layer.type === 'group' ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
                        className="w-4 h-4 flex items-center justify-center hover:bg-slate-600/50 rounded"
                    >
                        <ChevronIcon open={!!layer.expanded} />
                    </button>
                ) : (
                    <span className="w-1" />
                )}

                {/* Visibility */}
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
                    className="hover:bg-slate-600 p-1 rounded opacity-50 hover:opacity-100"
                >
                    <EyeIcon visible={layer.visible} />
                </button>

                {/* Thumbnail / Icon */}
                <div className={`w-8 h-8 rounded flex-shrink-0 flex items-center justify-center text-xs relative overflow-hidden border 
                    ${layer.type === 'adjustment' ? 'bg-purple-900/40 border-purple-700' : 'bg-slate-600/50 border-slate-600'}`}>
                    <span className="text-lg">{renderIcon()}</span>

                    {/* Mask Badge */}
                    {(layer.mask || (layer.vectorMask && layer.vectorMask.enabled)) && (
                        <div className="absolute -right-1 -bottom-1 w-4 h-4 bg-slate-800 border border-slate-500 rounded-sm flex items-center justify-center z-10">
                            <div className={`w-2 h-2 ${layer.vectorMask ? 'bg-white rounded-full' : 'bg-gray-400'}`}></div>
                        </div>
                    )}
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0 pr-2">
                    <div className={`text-sm truncate ${layer.clippingMaskId ? 'text-slate-300 underline decoration-slate-600' : 'text-white'}`}>
                        {layer.name}
                    </div>
                    {layer.type !== 'group' && (
                        <div className="flex items-center gap-1 text-[10px] text-slate-400">
                            {layer.type === 'adjustment' && <span className="text-purple-300 capitalize">{layer.adjustmentType}</span>}
                            <span>{layer.blendMode}</span>
                            <span>{layer.opacity}%</span>
                        </div>
                    )}
                </div>

                {/* Actions (Hover) */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleClip(); }}
                        className={`p-1 rounded ${layer.clippingMaskId ? 'text-cyan-400 bg-slate-700 opacity-100' : 'text-slate-500 hover:text-white hover:bg-slate-600'}`}
                        title="Clipping Mask"
                    >
                        📎
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
                        className={`p-1 rounded ${layer.locked ? 'text-amber-400' : 'text-slate-500 hover:text-white hover:bg-slate-600'}`}
                    >
                        <LockIcon locked={layer.locked} />
                    </button>
                    {!layer.locked && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                            className="p-1 rounded text-red-400 hover:bg-red-500/20"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* Recursive Children (Reverse Order for Display) */}
            {layer.type === 'group' && layer.expanded && layer.layers && (
                <div className="border-l border-slate-700/50 ml-6">
                    <LayerList layers={layer.layers} depth={depth + 1} />
                </div>
            )}
        </div>
    );
};

// Recursive List Component
const LayerList: React.FC<{ layers: CanvasLayer[]; depth: number }> = ({ layers, depth }) => {
    const { selectedLayerId, selectLayer, updateLayer, deleteLayer } = useCanvasStore();

    const handleToggleClip = (layerId: string, siblings: CanvasLayer[]) => {
        const index = siblings.findIndex(l => l.id === layerId);
        if (index <= 0) return;

        const layer = siblings[index];
        if (layer.clippingMaskId) {
            updateLayer(layerId, { clippingMaskId: undefined });
        } else {
            const siblingBelow = siblings[index - 1];
            updateLayer(layerId, { clippingMaskId: siblingBelow.id });
        }
    };

    const displayList = [...layers].reverse();

    if (layers.length === 0) return null;

    return (
        <>
            {displayList.map((layer) => (
                <LayerItem
                    key={layer.id}
                    layer={layer}
                    depth={depth}
                    isSelected={layer.id === selectedLayerId}
                    onSelect={() => selectLayer(layer.id)}
                    onToggleVisibility={() => updateLayer(layer.id, { visible: !layer.visible })}
                    onToggleLock={() => updateLayer(layer.id, { locked: !layer.locked })}
                    onToggleExpand={() => updateLayer(layer.id, { expanded: !layer.expanded })}
                    onToggleClip={() => handleToggleClip(layer.id, layers)}
                    onDelete={() => deleteLayer(layer.id)}
                />
            ))}
        </>
    );
};

// Properties Sub-Panel
const LayerProperties: React.FC<{ layer: CanvasLayer; updateLayer: any }> = ({ layer, updateLayer }) => {
    if (!layer.adjustments) return null;

    const handleChange = (key: keyof typeof layer.adjustments, val: number) => {
        updateLayer(layer.id, { adjustments: { ...layer.adjustments, [key]: val } });
    };

    return (
        <div className="p-3 bg-slate-800 border-t border-slate-700 flex flex-col gap-3">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex justify-between">
                <span>Properties</span>
                <span className="text-purple-400">{layer.name}</span>
            </div>

            {layer.adjustmentType === 'brightness' && (
                <>
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-[10px] text-slate-400">
                            <span>Brightness</span>
                            <span>{layer.adjustments.brightness}</span>
                        </div>
                        <input
                            type="range" min="-100" max="100"
                            value={layer.adjustments.brightness}
                            onChange={(e) => handleChange('brightness', parseInt(e.target.value))}
                            className="w-full accent-cyan-500 h-1 bg-slate-600 rounded cursor-pointer"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-[10px] text-slate-400">
                            <span>Contrast</span>
                            <span>{layer.adjustments.contrast}</span>
                        </div>
                        <input
                            type="range" min="-100" max="100"
                            value={layer.adjustments.contrast}
                            onChange={(e) => handleChange('contrast', parseInt(e.target.value))}
                            className="w-full accent-cyan-500 h-1 bg-slate-600 rounded cursor-pointer"
                        />
                    </div>
                </>
            )}

            {layer.adjustmentType === 'hue' && (
                <>
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-[10px] text-slate-400">
                            <span>Hue</span>
                            <span>{layer.adjustments.hue}°</span>
                        </div>
                        <input
                            type="range" min="0" max="360"
                            value={layer.adjustments.hue}
                            onChange={(e) => handleChange('hue', parseInt(e.target.value))}
                            className="w-full accent-cyan-500 h-1 bg-slate-600 rounded cursor-pointer"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-[10px] text-slate-400">
                            <span>Saturation</span>
                            <span>{layer.adjustments.saturation}</span>
                        </div>
                        <input
                            type="range" min="-100" max="100"
                            value={layer.adjustments.saturation}
                            onChange={(e) => handleChange('saturation', parseInt(e.target.value))}
                            className="w-full accent-cyan-500 h-1 bg-slate-600 rounded cursor-pointer"
                        />
                    </div>
                </>
            )}
        </div>
    );
};

export const LayerPanel: React.FC = () => {
    const layers = useLayers();
    const { addLayer, addMaskFromSelection, addAdjustmentLayer, selectedLayerId, updateLayer } = useCanvasStore();
    const { isLowVRAMMode } = useResourceAwareCanvas();

    const selectedLayer = useMemo(() => findLayer(layers, selectedLayerId || ''), [layers, selectedLayerId]);

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e1e] select-none">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-800">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Layers</span>
                <div className="flex gap-1">
                    <button
                        onClick={() => addAdjustmentLayer('brightness')}
                        className="p-1 hover:bg-slate-600 rounded text-yellow-300"
                        title="Add Brightness/Contrast"
                    >
                        🔆
                    </button>
                    <button
                        onClick={() => addAdjustmentLayer('hue')}
                        className="p-1 hover:bg-slate-600 rounded text-purple-300"
                        title="Add Hue/Saturation"
                    >
                        🎨
                    </button>
                    <div className="w-px h-4 bg-slate-600 mx-1 self-center" />
                    <button
                        onClick={() => addMaskFromSelection()}
                        className="p-1 hover:bg-slate-600 rounded text-white"
                        title="Add Mask from Selection"
                    >
                        🎭
                    </button>
                    <button
                        onClick={() => addLayer('Group', 'group')}
                        className="p-1 hover:bg-slate-600 rounded text-yellow-400"
                        title="New Group"
                    >
                        📁
                    </button>
                    <button
                        onClick={() => addLayer()}
                        className="p-1 hover:bg-slate-600 rounded text-white"
                        title="New Layer"
                    >
                        +
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {layers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-2">
                        <span>Empty Canvas</span>
                        <button onClick={() => addLayer()} className="text-cyan-400 hover:underline">
                            Create Layer
                        </button>
                    </div>
                ) : (
                    <LayerList layers={layers} depth={0} />
                )}
            </div>

            {/* Properties Panel (Contextual) */}
            {selectedLayer && selectedLayer.type === 'adjustment' && (
                <LayerProperties layer={selectedLayer} updateLayer={updateLayer} />
            )}

            {/* Footer */}
            <div className="px-3 py-1.5 border-t border-slate-700 bg-slate-800 text-[10px] text-slate-400 flex justify-between items-center">
                <span>{layers.length} items</span>
                {isLowVRAMMode && <span className="text-yellow-500 font-mono">⚠ Low VRAM</span>}
            </div>
        </div>
    );
};
