/**
 * ImageCard - Premium Image Display Component
 * 
 * Features:
 * - Lazy loading with skeleton
 * - Hover overlay with actions
 * - Glassmorphism design
 * - Click to open lightbox
 * - Error state with retry
 */

import React, { useState, useRef, useEffect } from 'react';
import { Download, ZoomIn, RefreshCw, ExternalLink, Sparkles, AlertCircle } from 'lucide-react';
import { ParsedAsset } from './AssetRenderer';

interface ImageCardProps {
    asset: ParsedAsset;
    onClick?: () => void;
    onAction?: (action: string) => void;
    compact?: boolean;
}

export const ImageCard: React.FC<ImageCardProps> = ({
    asset,
    onClick,
    onAction,
    compact = false
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const imgRef = useRef<HTMLImageElement>(null);

    // Intersection Observer for lazy loading
    useEffect(() => {
        const img = imgRef.current;
        if (!img) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    img.src = asset.url;
                    observer.disconnect();
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(img);
        return () => observer.disconnect();
    }, [asset.url]);

    const handleLoad = () => {
        setIsLoading(false);
        setHasError(false);
    };

    const handleError = () => {
        setIsLoading(false);
        setHasError(true);
    };

    const handleRetry = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsLoading(true);
        setHasError(false);
        if (imgRef.current) {
            imgRef.current.src = '';
            setTimeout(() => {
                if (imgRef.current) imgRef.current.src = asset.url;
            }, 100);
        }
    };

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const response = await fetch(asset.url);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = asset.alt || `image-${asset.id}.${asset.url.split('.').pop()?.split('?')[0] || 'png'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed:', err);
        }
    };

    const handleOpenExternal = (e: React.MouseEvent) => {
        e.stopPropagation();
        window.open(asset.url, '_blank');
    };

    return (
        <div
            className={`
                relative group rounded-xl overflow-hidden cursor-pointer
                bg-slate-900/50 border border-slate-700/50
                transition-all duration-300 ease-out
                hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/10
                ${compact ? 'aspect-square' : 'aspect-video'}
            `}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Loading Skeleton */}
            {isLoading && (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 animate-pulse">
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                    </div>
                </div>
            )}

            {/* Error State */}
            {hasError && (
                <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                    <span className="text-xs text-slate-400">Failed to load</span>
                    <button
                        onClick={handleRetry}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-cyan-400 transition-colors"
                    >
                        <RefreshCw size={12} />
                        Retry
                    </button>
                </div>
            )}

            {/* Image */}
            <img
                ref={imgRef}
                alt={asset.alt || 'Generated image'}
                onLoad={handleLoad}
                onError={handleError}
                className={`
                    w-full h-full object-cover transition-all duration-500
                    ${isLoading || hasError ? 'opacity-0' : 'opacity-100'}
                    ${isHovered ? 'scale-105' : 'scale-100'}
                `}
            />

            {/* Gradient Overlay */}
            <div
                className={`
                    absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent
                    transition-opacity duration-300
                    ${isHovered ? 'opacity-100' : 'opacity-0'}
                `}
            />

            {/* Info & Actions Overlay */}
            <div
                className={`
                    absolute inset-x-0 bottom-0 p-3
                    transition-all duration-300 transform
                    ${isHovered ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}
                `}
            >
                {/* Provider Badge */}
                {asset.provider && (
                    <div className="flex items-center gap-1 mb-2">
                        <Sparkles size={10} className="text-cyan-400" />
                        <span className="text-[10px] text-cyan-400 font-medium uppercase tracking-wider">
                            {asset.provider}
                        </span>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 backdrop-blur-sm hover:bg-white/20 rounded-lg text-xs text-white transition-all"
                        title="Download"
                    >
                        <Download size={12} />
                        <span className="hidden sm:inline">Download</span>
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 backdrop-blur-sm hover:bg-cyan-500/30 rounded-lg text-xs text-cyan-300 transition-all"
                        title="Zoom"
                    >
                        <ZoomIn size={12} />
                    </button>
                    <button
                        onClick={handleOpenExternal}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 backdrop-blur-sm hover:bg-white/20 rounded-lg text-xs text-white transition-all"
                        title="Open in new tab"
                    >
                        <ExternalLink size={12} />
                    </button>
                    {onAction && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onAction('regenerate'); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/20 backdrop-blur-sm hover:bg-purple-500/30 rounded-lg text-xs text-purple-300 transition-all"
                            title="Regenerate"
                        >
                            <RefreshCw size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Alt Text Badge (compact mode) */}
            {compact && asset.alt && (
                <div
                    className={`
                        absolute top-2 left-2 max-w-[80%]
                        px-2 py-1 bg-black/60 backdrop-blur-sm rounded-md
                        text-[10px] text-white truncate
                        transition-opacity duration-300
                        ${isHovered ? 'opacity-100' : 'opacity-0'}
                    `}
                >
                    {asset.alt}
                </div>
            )}
        </div>
    );
};

export default ImageCard;
