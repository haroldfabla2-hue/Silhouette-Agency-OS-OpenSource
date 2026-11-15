// =============================================================================
// Nexus Canvas - Main Component
// Professional image editor integrated into Silhouette
// =============================================================================

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useCanvasStore, useLayers, useActiveTool, useViewport, useIsGenerating } from './store/useCanvasStore';
import { canvasEngine, CanvasEngine } from './engine/CanvasEngine';
import { selectionTool } from './tools/SelectionTool';
import { LayerPanel } from './panels/LayerPanel';
import { ToolbarPanel } from './panels/ToolbarPanel';
import { AssetBrowserPanel } from './panels/AssetBrowserPanel';
import { GenerativeFillPanel } from './panels/GenerativeFillPanel';
import { AIToolsPanel } from './panels/AIToolsPanel';
import { TextPropertiesPanel } from './panels/TextPropertiesPanel';
import { ToolContextBar } from './panels/ToolContextBar';
import { AdjustmentsPanel } from './panels/AdjustmentsPanel';
import { LayerStylesPanel } from './panels/LayerStylesPanel';
import { useAutosave } from './hooks/useAutosave';
import { useDriveSync } from './hooks/useDriveSync';
import { useResourceAwareCanvas } from './hooks/useResourceAwareCanvas';
import { LayerMask } from '../../types/canvas';

interface NexusCanvasProps {
    /** Initial document width */
    width?: number;
    /** Initial document height */
    height?: number;
    /** Callback when canvas exports an image */
    onExport?: (imageData: string) => void;
    /** Show asset browser panel */
    showAssetBrowser?: boolean;
}

import { useCanvasAgentLink } from './store/useCanvasAgentLink';

export const NexusCanvas: React.FC<NexusCanvasProps> = ({
    width = 1920,
    height = 1080,
    onExport,
    showAssetBrowser = true
}) => {
    // 🧠 Connect Neural Link
    useCanvasAgentLink();

    // 📦 Persistence & Resource Management
    useAutosave();
    const { syncToDrive } = useDriveSync();
    const { isLowVRAMMode, vramUsage } = useResourceAwareCanvas();

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [rightPanel, setRightPanel] = useState<'layers' | 'assets' | 'adjustments' | 'styles'>('layers');

    const { createDocument, document, selection, clearSelection, setSelection } = useCanvasStore();
    const layers = useLayers();
    const activeTool = useActiveTool();
    const viewport = useViewport();
    const isGenerating = useIsGenerating();

    // Use local instance via ref instead of singleton for React Strict Mode compatibility
    const engineRef = useRef<CanvasEngine | null>(null);

    // Initialize canvas engine
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Create fresh instance for this mount (handles Strict Mode remounts)
        const engine = new CanvasEngine();
        engineRef.current = engine;

        engine.init(canvas, width, height).then(() => {
            // Create initial document if none exists
            if (!document) {
                createDocument('Untitled', width, height);
            }
        });

        return () => {
            engine.destroy();
            engineRef.current = null;
        };
    }, []);

    // Re-render layers when they change
    useEffect(() => {
        if (layers.length > 0 && engineRef.current) {
            engineRef.current.renderLayers(layers, isLowVRAMMode);
        }
    }, [layers, isLowVRAMMode]);

    // Update viewport when it changes
    useEffect(() => {
        engineRef.current?.updateViewport(viewport);
    }, [viewport]);

    // Update selection display
    useEffect(() => {
        if (!engineRef.current) return;
        if (selection.active && selection.path.length > 0) {
            engineRef.current.drawSelection(selection.path);
        } else {
            engineRef.current.clearSelection();
        }
    }, [selection]);

    // Handle container resize
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                canvasEngine.resize(width, height);
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // Mouse handling for selection tools
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (activeTool === 'selection-rect' || activeTool === 'selection-lasso') {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            const x = (e.clientX - rect.left - viewport.panX) / viewport.zoom;
            const y = (e.clientY - rect.top - viewport.panY) / viewport.zoom;

            selectionTool.setMode(activeTool === 'selection-rect' ? 'rectangle' : 'lasso');
            selectionTool.startSelection(x, y);
        }
    }, [activeTool, viewport]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (activeTool === 'selection-rect' || activeTool === 'selection-lasso') {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            const x = (e.clientX - rect.left - viewport.panX) / viewport.zoom;
            const y = (e.clientY - rect.top - viewport.panY) / viewport.zoom;

            selectionTool.updateSelection(x, y);

            // Update store with current path for display
            const path = selectionTool.getPath();
            if (path.length > 0) {
                setSelection({ active: true, path, bounds: selectionTool.getBounds() || undefined });
            }
        }
    }, [activeTool, viewport, setSelection]);

    const handleMouseUp = useCallback(() => {
        if (activeTool === 'selection-rect' || activeTool === 'selection-lasso') {
            const path = selectionTool.endSelection();
            if (path.length > 2) {
                setSelection({ active: true, path, bounds: selectionTool.getBounds() || undefined });
            }
        }
    }, [activeTool, setSelection]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl+Z = Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                useCanvasStore.getState().undo();
            }
            // Ctrl+Shift+Z or Ctrl+Y = Redo
            if ((e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) {
                e.preventDefault();
                useCanvasStore.getState().redo();
            }
            // Escape = Clear selection
            if (e.key === 'Escape') {
                clearSelection();
                selectionTool.clear();
            }
            // Ctrl+D = Clear selection (Photoshop standard)
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                clearSelection();
                selectionTool.clear();
            }
            // Tool shortcuts
            if (!e.ctrlKey && !e.altKey) {
                switch (e.key.toLowerCase()) {
                    case 'v': useCanvasStore.getState().setTool('move'); break;
                    case 'b': useCanvasStore.getState().setTool('brush'); break;
                    case 'e': useCanvasStore.getState().setTool('eraser'); break;
                    case 'm': useCanvasStore.getState().setTool('selection-rect'); break;
                    case 'l': useCanvasStore.getState().setTool('selection-lasso'); break;
                    case 'z': useCanvasStore.getState().setTool('zoom'); break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [clearSelection]);

    // Handle zoom with mouse wheel
    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newZoom = Math.max(0.1, Math.min(10, viewport.zoom + delta));
            useCanvasStore.getState().setZoom(newZoom);
        }
    }, [viewport.zoom]);

    // Export current canvas
    const handleExport = useCallback(async () => {
        const dataUrl = await canvasEngine.exportAsBase64();
        onExport?.(dataUrl);
    }, [onExport]);

    // Get canvas image for AI
    const getCanvasImage = useCallback(async () => {
        return canvasEngine.exportAsBase64();
    }, []);

    // Get selection mask for AI
    const getSelectionMask = useCallback(() => {
        if (!selection.active || selection.path.length < 3) return null;
        return selectionTool.generateMask(width, height);
    }, [selection, width, height]);

    // Handle AI Mask Application (Phase 2 Enhancement)
    const handleApplyMask = useCallback((maskBase64: string, boundingBox?: { x: number; y: number; width: number; height: number }) => {
        if (!document) return;

        const { width, height } = document.dimensions;

        if (boundingBox) {
            // Convert percent to pixels
            const x = (boundingBox.x / 100) * width;
            const y = (boundingBox.y / 100) * height;
            const w = (boundingBox.width / 100) * width;
            const h = (boundingBox.height / 100) * height;

            const pixelBounds = { x, y, width: w, height: h };

            // Create rectangle path
            const path = [
                { x, y },
                { x: x + w, y },
                { x: x + w, y: y + h },
                { x, y: y + h }
            ];

            setSelection({ active: true, path, bounds: pixelBounds });
        }
    }, [document, setSelection]);

    // Handle Adding Layer Mask (Non-Destructive)
    const handleAddMask = useCallback((maskBase64: string) => {
        const selectedId = useCanvasStore.getState().selectedLayerId;
        if (!selectedId) return;

        const mask: LayerMask = {
            id: crypto.randomUUID(),
            imageData: maskBase64,
            inverted: false
        };

        useCanvasStore.getState().updateLayer(selectedId, { mask });
    }, []);

    return (
        <div className="flex h-full bg-slate-900">
            {/* Left: Toolbar */}
            <ToolbarPanel />

            {/* Left: Asset Browser (collapsible) */}
            {showAssetBrowser && (
                <div className="w-48 border-r border-slate-700">
                    <AssetBrowserPanel />
                </div>
            )}

            {/* Center: Canvas & Context Bar */}
            <div className="flex-1 relative overflow-hidden flex flex-col">
                {/* Context Bar (Photoshop/Canva style) */}
                <ToolContextBar />

                <div
                    ref={containerRef}
                    className="flex-1 relative overflow-hidden bg-slate-900 cursor-crosshair"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    {/* Canvas Element */}
                    <canvas
                        ref={canvasRef}
                        className={`absolute inset-0 w-full h-full ${activeTool.startsWith('selection') ? 'cursor-crosshair' :
                            activeTool === 'brush' ? 'cursor-cell' :
                                activeTool === 'move' ? 'cursor-move' :
                                    'cursor-default'
                            }`}
                    />

                    {/* Zoom indicator */}
                    <div className="absolute bottom-4 left-4 px-2 py-1 bg-black/60 rounded text-xs text-white font-mono pointer-events-none">
                        {Math.round(viewport.zoom * 100)}%
                    </div>

                    {/* Generation overlay */}
                    {isGenerating && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
                            <div className="bg-slate-800 rounded-xl p-6 text-center shadow-2xl">
                                <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-3" />
                                <p className="text-white text-sm">Generating with AI...</p>
                                <p className="text-slate-400 text-xs mt-1">
                                    {useCanvasStore.getState().generationProgress}%
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Document info */}
                    {document && (
                        <div className="absolute top-4 left-4 px-2 py-1 bg-black/60 rounded text-xs text-white pointer-events-none">
                            {document.name} • {document.dimensions.width}×{document.dimensions.height}
                        </div>
                    )}

                    {/* Selection info */}
                    {selection.active && selection.bounds && (
                        <div className="absolute top-4 right-4 px-2 py-1 bg-cyan-600/80 rounded text-xs text-white pointer-events-none">
                            Selection: {Math.round(selection.bounds.width)}×{Math.round(selection.bounds.height)}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Inspector Panels */}
            <div className="w-64 bg-slate-800 border-l border-slate-700 flex flex-col">
                {/* Panel Tabs */}
                <div className="flex border-b border-slate-700">
                    <button
                        onClick={() => setRightPanel('layers')}
                        className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${rightPanel === 'layers'
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        Layers
                    </button>
                    <button
                        onClick={() => setRightPanel('assets')}
                        className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${rightPanel === 'assets'
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        Assets
                    </button>
                    <button
                        onClick={() => setRightPanel('adjustments')}
                        className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${rightPanel === 'adjustments'
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        Adjust
                    </button>
                    <button
                        onClick={() => setRightPanel('styles')}
                        className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${rightPanel === 'styles'
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        FX
                    </button>
                </div>

                {/* Panel Content */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {rightPanel === 'layers' && <LayerPanel />}
                    {rightPanel === 'assets' && <AssetBrowserPanel />}
                    {rightPanel === 'adjustments' && <AdjustmentsPanel />}
                    {rightPanel === 'styles' && <LayerStylesPanel />}
                </div>

                {/* Text Properties (shown when text layer selected) */}
                <TextPropertiesPanel />

                {/* AI Tools (Phase 2 Enhancement) */}
                <AIToolsPanel
                    getCanvasImage={getCanvasImage}
                    applyMask={handleApplyMask}
                    addLayerMask={handleAddMask}
                />

                {/* Generative Fill (shown when selection active) */}
                {selection.active && selection.path.length > 2 && (
                    <GenerativeFillPanel
                        getCanvasImage={getCanvasImage}
                        getSelectionMask={getSelectionMask}
                    />
                )}

                {/* Quick actions */}
                <div className="p-3 border-t border-slate-700">
                    <button
                        onClick={handleExport}
                        className="w-full px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg transition-colors"
                    >
                        Export PNG
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NexusCanvas;
