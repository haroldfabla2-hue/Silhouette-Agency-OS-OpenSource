// =============================================================================
// Nexus Canvas - Text Properties Panel
// Canva-like text editing interface
// =============================================================================

import React from 'react';
import { useCanvasStore, useSelectedLayer } from '../store/useCanvasStore';
import { textTool, AVAILABLE_FONTS } from '../tools/TextTool';
import type { CanvasColor } from '../../../types/canvas';

export const TextPropertiesPanel: React.FC = () => {
    const selectedLayer = useSelectedLayer();
    const { updateLayer } = useCanvasStore();

    // Only show for text layers
    if (!selectedLayer || selectedLayer.type !== 'text' || !selectedLayer.textData) {
        return null;
    }

    const textData = selectedLayer.textData;

    const handleContentChange = (content: string) => {
        updateLayer(selectedLayer.id, {
            textData: textTool.updateContent(textData, content)
        });
    };

    const handleFontChange = (fontFamily: string) => {
        updateLayer(selectedLayer.id, {
            textData: textTool.updateFontFamily(textData, fontFamily)
        });
    };

    const handleSizeChange = (fontSize: number) => {
        updateLayer(selectedLayer.id, {
            textData: textTool.updateFontSize(textData, fontSize)
        });
    };

    const handleWeightToggle = () => {
        updateLayer(selectedLayer.id, {
            textData: textTool.updateFontWeight(textData, textData.fontWeight === 400 ? 700 : 400)
        });
    };

    const handleColorChange = (hex: string) => {
        const color: CanvasColor = {
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16),
            a: 1
        };
        updateLayer(selectedLayer.id, {
            textData: textTool.updateColor(textData, color)
        });
    };

    const handleAlignmentChange = (alignment: 'left' | 'center' | 'right') => {
        updateLayer(selectedLayer.id, {
            textData: textTool.updateAlignment(textData, alignment)
        });
    };

    const colorToHex = (c: CanvasColor) =>
        `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`;

    return (
        <div className="p-3 bg-slate-800 border-t border-slate-700">
            <h3 className="text-xs font-semibold text-slate-400 uppercase mb-3">Text Properties</h3>

            {/* Text Content */}
            <div className="mb-3">
                <label className="text-xs text-slate-500 block mb-1">Content</label>
                <textarea
                    value={textData.content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm resize-none"
                    rows={3}
                />
            </div>

            {/* Font Family */}
            <div className="mb-3">
                <label className="text-xs text-slate-500 block mb-1">Font</label>
                <select
                    value={textData.fontFamily}
                    onChange={(e) => handleFontChange(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                >
                    {AVAILABLE_FONTS.map((font) => (
                        <option key={font} value={font} style={{ fontFamily: font }}>
                            {font}
                        </option>
                    ))}
                </select>
            </div>

            {/* Font Size & Weight */}
            <div className="flex gap-2 mb-3">
                <div className="flex-1">
                    <label className="text-xs text-slate-500 block mb-1">Size</label>
                    <input
                        type="number"
                        value={textData.fontSize}
                        onChange={(e) => handleSizeChange(parseInt(e.target.value) || 16)}
                        min={8}
                        max={500}
                        className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                    />
                </div>
                <div>
                    <label className="text-xs text-slate-500 block mb-1">Bold</label>
                    <button
                        onClick={handleWeightToggle}
                        className={`px-3 py-1 rounded transition-colors ${textData.fontWeight === 700
                                ? 'bg-cyan-600 text-white'
                                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                            }`}
                    >
                        <strong>B</strong>
                    </button>
                </div>
            </div>

            {/* Color */}
            <div className="mb-3">
                <label className="text-xs text-slate-500 block mb-1">Color</label>
                <input
                    type="color"
                    value={colorToHex(textData.color)}
                    onChange={(e) => handleColorChange(e.target.value)}
                    className="w-full h-8 rounded cursor-pointer"
                />
            </div>

            {/* Alignment */}
            <div className="mb-3">
                <label className="text-xs text-slate-500 block mb-1">Alignment</label>
                <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                            key={align}
                            onClick={() => handleAlignmentChange(align)}
                            className={`flex-1 py-1 rounded transition-colors ${textData.alignment === align
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                }`}
                        >
                            {align === 'left' ? '⬅️' : align === 'center' ? '↔️' : '➡️'}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
