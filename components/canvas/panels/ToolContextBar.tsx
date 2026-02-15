
import React, { useState } from 'react';
import { useCanvasStore, useActiveTool } from '../store/useCanvasStore';
import { selectionTool, SelectionOperation } from '../tools/SelectionTool';
import { FontSelector } from './FontSelector';

export const ToolContextBar: React.FC = () => {
    const activeTool = useActiveTool();
    const { brushSettings, setBrushSettings } = useCanvasStore();
    const [selectionOp, setSelectionOp] = useState<SelectionOperation>('new');

    // Handle selection operation change
    const handleSelectionOpChange = (op: SelectionOperation) => {
        setSelectionOp(op);
        selectionTool.setOperation(op);
    };

    // Helper for sliders
    const Slider = ({ label, value, onChange, min, max, unit = '' }: any) => (
        <div className="flex items-center gap-2 group relative">
            <span className="text-xs text-slate-400 font-medium w-12">{label}</span>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value))}
                className="w-24 h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
            <span className="text-xs text-slate-300 w-8 text-right">{value}{unit}</span>

            {/* Tooltip */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-slate-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap border border-slate-700">
                Adjust {label}
            </div>
        </div>
    );

    if (activeTool === 'brush' || activeTool === 'eraser') {
        return (
            <div className="h-10 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-6">
                <div className="flex items-center gap-2 text-slate-300 border-r border-slate-700 pr-4">
                    <span className="text-lg">{activeTool === 'brush' ? '🖌️' : '🧽'}</span>
                    <span className="text-sm font-semibold capitalize">{activeTool} Tool</span>
                </div>

                <Slider
                    label="Size"
                    value={brushSettings.size}
                    min={1}
                    max={200}
                    unit="px"
                    onChange={(v: number) => setBrushSettings({ size: v })}
                />

                <Slider
                    label="Opacity"
                    value={brushSettings.opacity}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={(v: number) => setBrushSettings({ opacity: v })}
                />

                {activeTool === 'brush' && (
                    <>
                        <Slider
                            label="Flow"
                            value={brushSettings.flow}
                            min={0}
                            max={100}
                            unit="%"
                            onChange={(v: number) => setBrushSettings({ flow: v })}
                        />
                        <Slider
                            label="Hardness"
                            value={brushSettings.hardness}
                            min={0}
                            max={100}
                            unit="%"
                            onChange={(v: number) => setBrushSettings({ hardness: v })}
                        />
                    </>
                )}
            </div>
        );
    }

    if (activeTool === 'text') {
        return (
            <div className="h-12 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-4">
                <div className="flex items-center gap-2 text-slate-300 border-r border-slate-700 pr-4">
                    <span className="text-lg">T</span>
                    <span className="text-sm font-semibold">Text Tool</span>
                </div>

                {/* Font Selector */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Font:</span>
                    <FontSelector
                        value="Inter"
                        onChange={(font) => console.log('[ToolContextBar] Font selected:', font)}
                    />
                </div>

                <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
                    <span className="text-xs text-slate-400">ℹ️ Click canvas to add text</span>
                </div>
            </div>
        );
    }

    if (activeTool === 'selection-rect' || activeTool === 'selection-lasso') {
        const opButtons: { op: SelectionOperation; label: string; shortcut: string }[] = [
            { op: 'new', label: 'New', shortcut: '' },
            { op: 'add', label: 'Add', shortcut: 'Shift' },
            { op: 'subtract', label: 'Subtract', shortcut: 'Alt' },
            { op: 'intersect', label: 'Intersect', shortcut: 'Shift+Alt' },
        ];

        return (
            <div className="h-10 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-4">
                <div className="flex items-center gap-2 text-slate-300 border-r border-slate-700 pr-4">
                    <span className="text-lg">{activeTool === 'selection-rect' ? '⬜' : '〰️'}</span>
                    <span className="text-sm font-semibold capitalize">{activeTool.replace('selection-', '')} Selection</span>
                </div>

                {/* Selection Operation Buttons */}
                <div className="flex bg-slate-900 rounded-md p-0.5 border border-slate-700">
                    {opButtons.map(({ op, label, shortcut }) => (
                        <button
                            key={op}
                            onClick={() => handleSelectionOpChange(op)}
                            className={`px-3 py-0.5 rounded text-xs transition-all ${selectionOp === op
                                    ? 'bg-cyan-600 text-white shadow-sm'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                }`}
                            title={shortcut ? `Hold ${shortcut}` : 'Replace selection'}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <span className="text-xs text-slate-500 ml-auto">
                    Hold Shift to add, Alt to subtract
                </span>
            </div>
        );
    }

    // Default empty bar (Document info)
    return (
        <div className="h-10 bg-slate-800 border-b border-slate-700 flex items-center px-4 justify-between">
            <span className="text-xs text-slate-500">Nexus Canvas Pro</span>
            <div className="flex gap-4 text-xs text-slate-400">
                <span>W: 1920px</span>
                <span>H: 1080px</span>
                <span>DPI: 300</span>
            </div>
        </div>
    );
};
