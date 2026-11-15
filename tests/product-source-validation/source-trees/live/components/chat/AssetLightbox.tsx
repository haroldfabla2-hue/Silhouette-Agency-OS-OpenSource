/**
 * AssetLightbox - Full-Screen Asset Preview with Basic Editor
 * 
 * Features:
 * - Keyboard navigation (Esc, arrows)
 * - Zoom (scroll wheel)
 * - Pan (drag)
 * - Basic adjustments (brightness, contrast)
 * - Download action
 * 
 * Performance: Lazy loaded, minimal DOM
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, RotateCw, Sun, Contrast, RefreshCw } from 'lucide-react';
import { ParsedAsset } from './AssetRenderer';

interface AssetLightboxProps {
    asset: ParsedAsset | null;
    assets?: ParsedAsset[];
    onClose: () => void;
    onAction?: (action: string, asset: ParsedAsset) => void;
}

export const AssetLightbox: React.FC<AssetLightboxProps> = ({
    asset,
    assets = [],
    onClose,
    onAction
}) => {
    const [currentAsset, setCurrentAsset] = useState<ParsedAsset | null>(asset);
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [showControls, setShowControls] = useState(true);

    // Basic adjustments
    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);
    const [showEditor, setShowEditor] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const currentIndex = assets.findIndex(a => a.id === currentAsset?.id);
    const hasMultiple = assets.length > 1;

    // Reset state when asset changes
    useEffect(() => {
        setCurrentAsset(asset);
        resetView();
    }, [asset]);

    const resetView = () => {
        setZoom(1);
        setRotation(0);
        setPosition({ x: 0, y: 0 });
        setBrightness(100);
        setContrast(100);
    };

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'Escape':
                    onClose();
                    break;
                case 'ArrowLeft':
                    if (hasMultiple && currentIndex > 0) {
                        setCurrentAsset(assets[currentIndex - 1]);
                        resetView();
                    }
                    break;
                case 'ArrowRight':
                    if (hasMultiple && currentIndex < assets.length - 1) {
                        setCurrentAsset(assets[currentIndex + 1]);
                        resetView();
                    }
                    break;
                case '+':
                case '=':
                    setZoom(z => Math.min(z + 0.25, 5));
                    break;
                case '-':
                    setZoom(z => Math.max(z - 0.25, 0.25));
                    break;
                case 'r':
                    setRotation(r => (r + 90) % 360);
                    break;
                case '0':
                    resetView();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentIndex, assets, hasMultiple, onClose]);

    // Mouse wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(z => Math.max(0.25, Math.min(5, z + delta)));
    }, []);

    // Drag to pan
    const handleMouseDown = (e: React.MouseEvent) => {
        if (zoom > 1) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            setPosition({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
        // Show controls on mouse move
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    };

    const handleMouseUp = () => setIsDragging(false);

    const handleDownload = async () => {
        if (!currentAsset) return;
        try {
            const response = await fetch(currentAsset.url);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ext = currentAsset.url.split('.').pop()?.split('?')[0] || 'png';
            a.download = `${currentAsset.alt || 'image'}-${currentAsset.id}.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed:', err);
        }
    };

    if (!currentAsset) return null;

    const imageStyle: React.CSSProperties = {
        transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
        filter: `brightness(${brightness}%) contrast(${contrast}%)`,
        cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
        transition: isDragging ? 'none' : 'transform 0.2s ease-out, filter 0.2s ease-out',
    };

    return (
        <div
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center"
            ref={containerRef}
            onClick={(e) => e.target === containerRef.current && onClose()}
            onMouseMove={handleMouseMove}
        >
            {/* Close Button */}
            <button
                onClick={onClose}
                className={`absolute top-4 right-4 z-20 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-all ${showControls ? 'opacity-100' : 'opacity-0'}`}
            >
                <X className="w-6 h-6 text-white" />
            </button>

            {/* Navigation Arrows */}
            {hasMultiple && (
                <>
                    <button
                        onClick={() => { setCurrentAsset(assets[currentIndex - 1]); resetView(); }}
                        disabled={currentIndex === 0}
                        className={`absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-all ${showControls ? 'opacity-100' : 'opacity-0'}`}
                    >
                        <ChevronLeft className="w-6 h-6 text-white" />
                    </button>
                    <button
                        onClick={() => { setCurrentAsset(assets[currentIndex + 1]); resetView(); }}
                        disabled={currentIndex === assets.length - 1}
                        className={`absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-all ${showControls ? 'opacity-100' : 'opacity-0'}`}
                    >
                        <ChevronRight className="w-6 h-6 text-white" />
                    </button>
                </>
            )}

            {/* Image */}
            <div
                className="relative max-w-[90vw] max-h-[85vh] overflow-hidden"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                {currentAsset.type === 'image' ? (
                    <img
                        src={currentAsset.url}
                        alt={currentAsset.alt || 'Preview'}
                        className="max-w-full max-h-[85vh] object-contain select-none"
                        style={imageStyle}
                        draggable={false}
                    />
                ) : currentAsset.type === 'video' ? (
                    <video
                        src={currentAsset.url}
                        controls
                        autoPlay
                        className="max-w-full max-h-[85vh]"
                        style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)` }}
                    />
                ) : null}
            </div>

            {/* Bottom Controls */}
            <div className={`absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 to-transparent transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <div className="max-w-2xl mx-auto">
                    {/* Info */}
                    <div className="text-center mb-3">
                        {currentAsset.provider && (
                            <span className="text-xs text-cyan-400 uppercase tracking-wider">
                                {currentAsset.provider}
                            </span>
                        )}
                        {currentAsset.alt && (
                            <p className="text-sm text-white/80 mt-1 line-clamp-2">{currentAsset.alt}</p>
                        )}
                        {hasMultiple && (
                            <span className="text-xs text-slate-400 mt-1 block">
                                {currentIndex + 1} / {assets.length}
                            </span>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setZoom(z => Math.min(z + 0.5, 5))} className="p-2.5 hover:bg-white/10 rounded-lg" title="Zoom In">
                            <ZoomIn size={18} className="text-white" />
                        </button>
                        <button onClick={() => setZoom(z => Math.max(z - 0.5, 0.25))} className="p-2.5 hover:bg-white/10 rounded-lg" title="Zoom Out">
                            <ZoomOut size={18} className="text-white" />
                        </button>
                        <button onClick={() => setRotation(r => (r + 90) % 360)} className="p-2.5 hover:bg-white/10 rounded-lg" title="Rotate">
                            <RotateCw size={18} className="text-white" />
                        </button>

                        <div className="w-px h-6 bg-white/20 mx-2" />

                        <button onClick={() => setShowEditor(!showEditor)} className={`p-2.5 rounded-lg ${showEditor ? 'bg-cyan-500/20' : 'hover:bg-white/10'}`} title="Adjustments">
                            <Sun size={18} className={showEditor ? 'text-cyan-400' : 'text-white'} />
                        </button>

                        <div className="w-px h-6 bg-white/20 mx-2" />

                        <button onClick={handleDownload} className="p-2.5 hover:bg-white/10 rounded-lg" title="Download">
                            <Download size={18} className="text-white" />
                        </button>
                        <button onClick={resetView} className="p-2.5 hover:bg-white/10 rounded-lg" title="Reset">
                            <RefreshCw size={18} className="text-white" />
                        </button>
                        {onAction && (
                            <button
                                onClick={() => onAction('regenerate', currentAsset)}
                                className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg text-sm text-purple-300"
                            >
                                Regenerate
                            </button>
                        )}
                    </div>

                    {/* Editor Panel */}
                    {showEditor && (
                        <div className="mt-4 p-4 bg-black/40 rounded-xl flex items-center gap-6 justify-center">
                            <div className="flex items-center gap-3">
                                <Sun size={16} className="text-yellow-400" />
                                <input
                                    type="range"
                                    min={50}
                                    max={150}
                                    value={brightness}
                                    onChange={(e) => setBrightness(Number(e.target.value))}
                                    className="w-24 accent-yellow-400"
                                />
                                <span className="text-xs text-slate-400 w-8">{brightness}%</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <Contrast size={16} className="text-blue-400" />
                                <input
                                    type="range"
                                    min={50}
                                    max={150}
                                    value={contrast}
                                    onChange={(e) => setContrast(Number(e.target.value))}
                                    className="w-24 accent-blue-400"
                                />
                                <span className="text-xs text-slate-400 w-8">{contrast}%</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AssetLightbox;
