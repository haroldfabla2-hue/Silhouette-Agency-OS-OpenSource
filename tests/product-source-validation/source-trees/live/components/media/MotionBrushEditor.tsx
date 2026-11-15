/**
 * MotionBrushEditor - Canvas-based motion path drawing
 * Inspired by Kling AI & Runway: multi-color regions, static brush, direction/speed control
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

type BrushTool = 'motion' | 'static' | 'erase';

interface MotionLayer {
    id: string;
    color: string;
    direction: 'left' | 'right' | 'up' | 'down' | 'zoom_in' | 'zoom_out';
    speed: 'slow' | 'medium' | 'fast';
    isStatic: boolean;
}

interface MotionBrushEditorProps {
    imageUrl: string;
    onMotionDataChange?: (layers: MotionLayer[], canvasData: string) => void;
    onClose?: () => void;
}

const LAYER_COLORS = [
    { id: 'red', hex: '#ef4444', name: 'Red' },
    { id: 'green', hex: '#22c55e', name: 'Green' },
    { id: 'blue', hex: '#3b82f6', name: 'Blue' },
    { id: 'yellow', hex: '#eab308', name: 'Yellow' },
    { id: 'purple', hex: '#a855f7', name: 'Purple' },
    { id: 'cyan', hex: '#06b6d4', name: 'Cyan' },
];

const DIRECTIONS = [
    { id: 'left', icon: '←', label: 'Left' },
    { id: 'right', icon: '→', label: 'Right' },
    { id: 'up', icon: '↑', label: 'Up' },
    { id: 'down', icon: '↓', label: 'Down' },
    { id: 'zoom_in', icon: '⊕', label: 'Zoom In' },
    { id: 'zoom_out', icon: '⊖', label: 'Zoom Out' },
] as const;

const MotionBrushEditor: React.FC<MotionBrushEditorProps> = ({
    imageUrl,
    onMotionDataChange,
    onClose
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [tool, setTool] = useState<BrushTool>('motion');
    const [brushSize, setBrushSize] = useState(32);
    const [selectedColor, setSelectedColor] = useState(LAYER_COLORS[0]);
    const [layers, setLayers] = useState<MotionLayer[]>([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 });

    // Initialize canvas with image
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            // Fit to container
            const maxWidth = 512;
            const scale = maxWidth / img.width;
            const width = maxWidth;
            const height = img.height * scale;

            setCanvasSize({ width, height });
            canvas.width = width;
            canvas.height = height;

            // Draw image as background (we'll overlay on a separate canvas layer)
            ctx.clearRect(0, 0, width, height);
        };
        img.src = imageUrl;
    }, [imageUrl]);

    // Get cursor position relative to canvas
    const getCursorPos = useCallback((e: React.MouseEvent): { x: number; y: number } => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }, []);

    // Draw on canvas
    const draw = useCallback((x: number, y: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);

        if (tool === 'erase') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        } else if (tool === 'static') {
            ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
            ctx.fill();
        } else {
            ctx.fillStyle = `${selectedColor.hex}80`; // 50% opacity
            ctx.fill();
        }
    }, [brushSize, selectedColor, tool]);

    // Mouse handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDrawing(true);
        const pos = getCursorPos(e);
        draw(pos.x, pos.y);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDrawing) return;
        const pos = getCursorPos(e);
        draw(pos.x, pos.y);
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
    };

    // Add motion layer
    const addLayer = () => {
        if (layers.length >= 6) return; // Max 6 layers (Kling limit)

        const usedColors = layers.map(l => l.color);
        const availableColor = LAYER_COLORS.find(c => !usedColors.includes(c.hex)) || LAYER_COLORS[0];

        const newLayer: MotionLayer = {
            id: Math.random().toString(36).substring(7),
            color: availableColor.hex,
            direction: 'right',
            speed: 'medium',
            isStatic: tool === 'static'
        };

        setLayers([...layers, newLayer]);
        setSelectedColor(availableColor);
    };

    // Remove layer
    const removeLayer = (id: string) => {
        setLayers(layers.filter(l => l.id !== id));
    };

    // Update layer
    const updateLayer = (id: string, updates: Partial<MotionLayer>) => {
        setLayers(layers.map(l => l.id === id ? { ...l, ...updates } : l));
    };

    // Clear canvas
    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setLayers([]);
    };

    // Submit motion data
    const handleDone = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const canvasData = canvas.toDataURL('image/png');
        onMotionDataChange?.(layers, canvasData);
        onClose?.();
    };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 rounded-xl border border-slate-700 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">🖌️</span>
                        <span className="text-sm font-medium text-white">Motion Brush Editor</span>
                        <span className="text-xs text-slate-400">(Max 6 layers)</span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={clearCanvas}
                            className="px-3 py-1.5 text-xs bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                        >
                            Reset
                        </button>
                        <button
                            onClick={handleDone}
                            className="px-4 py-1.5 text-xs bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
                        >
                            Done ✓
                        </button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Canvas Area */}
                    <div
                        ref={containerRef}
                        className="flex-1 p-4 flex items-center justify-center bg-slate-950 relative"
                    >
                        {/* Background Image */}
                        <div
                            className="relative"
                            style={{ width: canvasSize.width, height: canvasSize.height }}
                        >
                            <img
                                src={imageUrl}
                                alt="Source"
                                className="absolute inset-0 w-full h-full object-contain rounded-lg"
                            />
                            {/* Drawing Canvas Overlay */}
                            <canvas
                                ref={canvasRef}
                                width={canvasSize.width}
                                height={canvasSize.height}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                                className="absolute inset-0 cursor-crosshair rounded-lg"
                                style={{
                                    cursor: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="${brushSize}" height="${brushSize}"><circle cx="${brushSize / 2}" cy="${brushSize / 2}" r="${brushSize / 2 - 1}" fill="${selectedColor.hex}80" stroke="white" stroke-width="1"/></svg>') ${brushSize / 2} ${brushSize / 2}, crosshair`
                                }}
                            />
                        </div>
                    </div>

                    {/* Tools Panel */}
                    <div className="w-64 border-l border-slate-700 p-4 space-y-4 overflow-y-auto">
                        {/* Tool Selection */}
                        <div className="space-y-2">
                            <label className="text-xs text-slate-400">Tool</label>
                            <div className="flex gap-1">
                                {[
                                    { id: 'motion', icon: '🖌️', label: 'Motion' },
                                    { id: 'static', icon: '🔒', label: 'Static' },
                                    { id: 'erase', icon: '🧹', label: 'Erase' },
                                ].map(t => (
                                    <button
                                        key={t.id}
                                        onClick={() => setTool(t.id as BrushTool)}
                                        className={`flex-1 py-2 text-xs rounded-lg transition-all ${tool === t.id
                                                ? 'bg-cyan-500 text-white'
                                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                            }`}
                                    >
                                        {t.icon} {t.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Brush Size */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-slate-400">Brush Size</label>
                                <span className="text-xs text-cyan-400">{brushSize}px</span>
                            </div>
                            <input
                                type="range"
                                min="8"
                                max="128"
                                value={brushSize}
                                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                            />
                        </div>

                        {/* Color Selection */}
                        <div className="space-y-2">
                            <label className="text-xs text-slate-400">Layer Color</label>
                            <div className="flex gap-2">
                                {LAYER_COLORS.map(color => (
                                    <button
                                        key={color.id}
                                        onClick={() => setSelectedColor(color)}
                                        className={`w-8 h-8 rounded-lg border-2 transition-all ${selectedColor.id === color.id
                                                ? 'border-white scale-110'
                                                : 'border-transparent hover:border-slate-500'
                                            }`}
                                        style={{ backgroundColor: color.hex }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Add Layer Button */}
                        <button
                            onClick={addLayer}
                            disabled={layers.length >= 6}
                            className="w-full py-2 text-xs bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                        >
                            + Add Motion Layer ({layers.length}/6)
                        </button>

                        {/* Motion Layers List */}
                        <div className="space-y-2">
                            <label className="text-xs text-slate-400">Motion Layers</label>
                            {layers.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                    Draw on the image, then add a layer to define motion
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {layers.map((layer, index) => (
                                        <div
                                            key={layer.id}
                                            className="p-2 bg-slate-800 rounded-lg border border-slate-700"
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-4 h-4 rounded"
                                                        style={{ backgroundColor: layer.color }}
                                                    />
                                                    <span className="text-xs text-white">
                                                        {layer.isStatic ? 'Static' : `Layer ${index + 1}`}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => removeLayer(layer.id)}
                                                    className="text-red-400 hover:text-red-300 text-xs"
                                                >
                                                    🗑️
                                                </button>
                                            </div>

                                            {!layer.isStatic && (
                                                <div className="flex gap-2">
                                                    <select
                                                        value={layer.direction}
                                                        onChange={(e) => updateLayer(layer.id, { direction: e.target.value as any })}
                                                        className="flex-1 px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white"
                                                    >
                                                        {DIRECTIONS.map(d => (
                                                            <option key={d.id} value={d.id}>
                                                                {d.icon} {d.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        value={layer.speed}
                                                        onChange={(e) => updateLayer(layer.id, { speed: e.target.value as any })}
                                                        className="flex-1 px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white"
                                                    >
                                                        <option value="slow">Slow</option>
                                                        <option value="medium">Medium</option>
                                                        <option value="fast">Fast</option>
                                                    </select>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MotionBrushEditor;
