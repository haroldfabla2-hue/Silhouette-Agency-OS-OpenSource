/**
 * VideoCard - Inline Video Player Component
 * 
 * Features:
 * - Autoplay on hover (like Twitter/X)
 * - Native controls with custom overlay
 * - Duration badge
 * - Audio toggle (for Veo videos)
 * - Fullscreen support
 */

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { ParsedAsset } from './AssetRenderer';

interface VideoCardProps {
    asset: ParsedAsset;
    onClick?: () => void;
    onAction?: (action: string) => void;
    autoplayOnHover?: boolean;
}

export const VideoCard: React.FC<VideoCardProps> = ({
    asset,
    onClick,
    onAction,
    autoplayOnHover = true
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(true);
    const [isHovered, setIsHovered] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleLoadedMetadata = () => {
            setIsLoading(false);
            setDuration(video.duration);
        };

        const handleError = () => {
            setIsLoading(false);
            setHasError(true);
        };

        const handleTimeUpdate = () => {
            setCurrentTime(video.currentTime);
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('error', handleError);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);

        return () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('error', handleError);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
        };
    }, []);

    // Autoplay on hover
    useEffect(() => {
        if (!autoplayOnHover || !videoRef.current) return;

        if (isHovered && !isPlaying) {
            videoRef.current.play().catch(() => { });
        } else if (!isHovered && isPlaying) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
    }, [isHovered, autoplayOnHover]);

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const togglePlay = (e: React.MouseEvent) => {
        e.stopPropagation();
        const video = videoRef.current;
        if (!video) return;

        if (isPlaying) {
            video.pause();
        } else {
            video.play().catch(() => { });
        }
    };

    const toggleMute = (e: React.MouseEvent) => {
        e.stopPropagation();
        const video = videoRef.current;
        if (!video) return;

        video.muted = !video.muted;
        setIsMuted(!isMuted);
    };

    const handleFullscreen = (e: React.MouseEvent) => {
        e.stopPropagation();
        const video = videoRef.current;
        if (!video) return;

        if (video.requestFullscreen) {
            video.requestFullscreen();
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
            a.download = `video-${asset.id}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed:', err);
        }
    };

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div
            className="relative group rounded-xl overflow-hidden bg-slate-900/80 border border-slate-700/50 transition-all duration-300 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/10"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={onClick}
        >
            {/* Loading State */}
            {isLoading && (
                <div className="absolute inset-0 bg-slate-900 flex items-center justify-center z-10">
                    <div className="w-10 h-10 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                </div>
            )}

            {/* Error State */}
            {hasError && (
                <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-3 z-10">
                    <AlertCircle className="w-10 h-10 text-red-400" />
                    <span className="text-sm text-slate-400">Failed to load video</span>
                    <button
                        onClick={(e) => { e.stopPropagation(); window.location.reload(); }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-cyan-400"
                    >
                        <RefreshCw size={14} />
                        Retry
                    </button>
                </div>
            )}

            {/* Video Element */}
            <div className="aspect-video">
                <video
                    ref={videoRef}
                    src={asset.url}
                    className="w-full h-full object-cover"
                    muted={isMuted}
                    loop
                    playsInline
                    preload="metadata"
                />
            </div>

            {/* Play/Pause Overlay */}
            <div
                className={`
                    absolute inset-0 flex items-center justify-center
                    bg-black/30 transition-opacity duration-300
                    ${isHovered || !isPlaying ? 'opacity-100' : 'opacity-0'}
                `}
            >
                <button
                    onClick={togglePlay}
                    className="w-16 h-16 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-all hover:scale-110"
                >
                    {isPlaying ? (
                        <Pause className="w-8 h-8 text-white" fill="white" />
                    ) : (
                        <Play className="w-8 h-8 text-white ml-1" fill="white" />
                    )}
                </button>
            </div>

            {/* Duration Badge */}
            <div className="absolute top-3 right-3 px-2 py-1 bg-black/70 backdrop-blur-sm rounded-md text-xs text-white font-mono">
                {formatTime(duration)}
            </div>

            {/* Provider Badge */}
            {asset.provider && (
                <div className="absolute top-3 left-3 px-2 py-1 bg-cyan-500/20 backdrop-blur-sm rounded-md text-[10px] text-cyan-300 font-medium uppercase tracking-wider">
                    🎬 {asset.provider}
                </div>
            )}

            {/* Bottom Controls */}
            <div
                className={`
                    absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 to-transparent
                    transition-opacity duration-300
                    ${isHovered ? 'opacity-100' : 'opacity-0'}
                `}
            >
                {/* Progress Bar */}
                <div className="h-1 bg-slate-700 rounded-full mb-3 overflow-hidden cursor-pointer">
                    <div
                        className="h-full bg-cyan-500 rounded-full transition-all duration-100"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                {/* Control Buttons */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={togglePlay}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            {isPlaying ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white" />}
                        </button>
                        <button
                            onClick={toggleMute}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            {isMuted ? <VolumeX size={16} className="text-white" /> : <Volume2 size={16} className="text-white" />}
                        </button>
                        <span className="text-xs text-slate-400 font-mono">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleDownload}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                            title="Download"
                        >
                            <Download size={16} className="text-white" />
                        </button>
                        <button
                            onClick={handleFullscreen}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                            title="Fullscreen"
                        >
                            <Maximize2 size={16} className="text-white" />
                        </button>
                        {onAction && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onAction('regenerate'); }}
                                className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors"
                                title="Regenerate"
                            >
                                <RefreshCw size={16} className="text-purple-300" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VideoCard;
