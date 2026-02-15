// =============================================================================
// Nexus Canvas - Toolbar Panel
// Photoshop-style vertical toolbar
// =============================================================================

import React from 'react';
import { useActiveTool, useCanvasStore } from '../store/useCanvasStore';
import type { CanvasTool } from '../../../types/canvas';

interface ToolButtonProps {
    tool: CanvasTool;
    icon: string;
    label: string;
    shortcut: string;
    description: string;
    isActive: boolean;
    onClick: () => void;
}

const ToolButton: React.FC<ToolButtonProps> = ({
    tool,
    icon,
    label,
    shortcut,
    description,
    isActive,
    onClick
}) => {
    const [isHovered, setIsHovered] = React.useState(false);

    return (
        <div
            className="relative group"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <button
                onClick={onClick}
                className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all ${isActive
                    ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/30'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
                    }`}
            >
                <span className="text-xl">{icon}</span>
            </button>

            {/* Photoshop-style Rich Tooltip */}
            {isHovered && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 pointer-events-none">
                    <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-white text-sm">{label}</span>
                        <span className="text-xs text-slate-500 font-mono bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                            {shortcut}
                        </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-tight">
                        {description}
                    </p>
                    {/* Tiny arrow */}
                    <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-t-transparent border-r-[6px] border-r-slate-900 border-b-[6px] border-b-transparent" />
                </div>
            )}
        </div>
    );
};

const TOOLS: { tool: CanvasTool; icon: string; label: string; shortcut: string; description: string }[] = [
    { tool: 'move', icon: '↔️', label: 'Move', shortcut: 'V', description: 'Move layers and selections around the canvas.' },
    { tool: 'selection-rect', icon: '⬜', label: 'Rectangular Selection', shortcut: 'M', description: 'Create rectangular selections to edit specific areas.' },
    { tool: 'selection-lasso', icon: '〰️', label: 'Lasso Selection', shortcut: 'L', description: 'Draw freeform selections for organic shapes.' },
    { tool: 'brush', icon: '🖌️', label: 'Brush', shortcut: 'B', description: 'Paint strokes with adjustable size and opacity.' },
    { tool: 'eraser', icon: '🧽', label: 'Eraser', shortcut: 'E', description: 'Erase pixels from raster layers.' },
    { tool: 'eyedropper', icon: '💧', label: 'Eyedropper', shortcut: 'I', description: 'Sample colors from the image.' },
    { tool: 'text', icon: 'T', label: 'Text', shortcut: 'T', description: 'Add editable text layers.' },
    { tool: 'shape', icon: '◯', label: 'Shape', shortcut: 'U', description: 'Draw vector shapes (Circle, Rectangle).' },
    { tool: 'zoom', icon: '🔍', label: 'Zoom', shortcut: 'Z', description: 'Zoom in and out of the document.' },
    { tool: 'pan', icon: '✋', label: 'Pan', shortcut: 'H', description: 'Pan the view without moving layers.' },
];

export const ToolbarPanel: React.FC = () => {
    const activeTool = useActiveTool();
    const { setTool, foregroundColor, backgroundColor, setForegroundColor } = useCanvasStore();

    // Convert color to CSS
    const colorToCss = (c: { r: number; g: number; b: number; a: number }) =>
        `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;

    return (
        <div className="w-14 bg-slate-800 border-r border-slate-700 flex flex-col items-center py-3 gap-2 z-50">
            {/* Tool buttons */}
            {TOOLS.map((t) => (
                <ToolButton
                    key={t.tool}
                    tool={t.tool}
                    icon={t.icon}
                    label={t.label}
                    shortcut={t.shortcut}
                    description={t.description}
                    isActive={activeTool === t.tool}
                    onClick={() => setTool(t.tool)}
                />
            ))}

            {/* Divider */}
            <div className="w-8 h-px bg-slate-600 my-2" />

            {/* Color swatches */}
            <div className="relative w-10 h-10 group" title="Color Picker">
                {/* Background color (behind) */}
                <div
                    className="absolute bottom-0 right-0 w-6 h-6 rounded border border-slate-500"
                    style={{ backgroundColor: colorToCss(backgroundColor) }}
                />
                {/* Foreground color (front) */}
                <div
                    className="absolute top-0 left-0 w-6 h-6 rounded border-2 border-white shadow-md cursor-pointer hover:scale-105 transition-transform"
                    style={{ backgroundColor: colorToCss(foregroundColor) }}
                    onClick={() => {
                        // Simple color picker (in real app, open a color picker modal)
                        const input = document.createElement('input');
                        input.type = 'color';
                        input.value = `#${foregroundColor.r.toString(16).padStart(2, '0')}${foregroundColor.g.toString(16).padStart(2, '0')}${foregroundColor.b.toString(16).padStart(2, '0')}`;
                        input.onchange = (e) => {
                            const hex = (e.target as HTMLInputElement).value;
                            setForegroundColor({
                                r: parseInt(hex.slice(1, 3), 16),
                                g: parseInt(hex.slice(3, 5), 16),
                                b: parseInt(hex.slice(5, 7), 16),
                                a: 1
                            });
                        };
                        input.click();
                    }}
                />
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Persistence Controls */}
            <div className="flex flex-col items-center gap-2 mb-2">
                {/* Autosave Toggle */}
                <button
                    onClick={() => {
                        const prefs = useCanvasStore.getState().prefs;
                        useCanvasStore.getState().setPreferences({ autosaveEnabled: !prefs.autosaveEnabled });
                    }}
                    className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all group relative ${useCanvasStore.getState().prefs?.autosaveEnabled
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                >
                    💾
                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
                        Autosave: {useCanvasStore.getState().prefs?.autosaveEnabled ? 'ON' : 'OFF'}
                    </div>
                </button>

                {/* Drive Sync Toggle */}
                <button
                    onClick={() => {
                        const prefs = useCanvasStore.getState().prefs;
                        useCanvasStore.getState().setPreferences({ autoSyncDrive: !prefs.autoSyncDrive });
                    }}
                    className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all group relative ${useCanvasStore.getState().prefs?.autoSyncDrive
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                >
                    ☁️
                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
                        Drive Sync: {useCanvasStore.getState().prefs?.autoSyncDrive ? 'ON' : 'OFF'}
                    </div>
                </button>

                {/* Manual Sync Button */}
                <button
                    onClick={() => {
                        // TODO: Implement manual sync
                        console.log('[Canvas] Manual sync triggered');
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-700 text-slate-400 hover:bg-cyan-600 hover:text-white transition-all group relative"
                >
                    🔄
                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
                        Sync Now
                    </div>
                </button>
            </div>

            {/* Help */}
            <button
                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white group relative"
            >
                ⌨️
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
                    Keyboard shortcuts
                </div>
            </button>
        </div>
    );
};

