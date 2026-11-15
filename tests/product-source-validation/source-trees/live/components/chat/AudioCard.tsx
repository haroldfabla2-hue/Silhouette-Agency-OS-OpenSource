/**
 * AudioCard - Waveform Audio Player Component
 * 
 * Features:
 * - Visual waveform representation
 * - Play/pause with smooth animations
 * - Time scrubber
 * - ElevenLabs voice badge
 */

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, RefreshCw, Mic2 } from 'lucide-react';
import { ParsedAsset } from './AssetRenderer';

interface AudioCardProps {
    asset: ParsedAsset;
    onAction?: (action: string) => void;
}

export const AudioCard: React.FC<AudioCardProps> = ({
    asset,
    onAction
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [waveformData, setWaveformData] = useState<number[]>([]);
    const audioRef = useRef<HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Generate fake waveform data (in production, analyze actual audio)
    useEffect(() => {
        const bars = 40;
        const data = Array.from({ length: bars }, () =>
            0.2 + Math.random() * 0.8
        );
        setWaveformData(data);
    }, [asset.url]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleLoadedMetadata = () => {
            setIsLoading(false);
            setDuration(audio.duration);
        };

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };

        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('ended', handleEnded);
        };
    }, []);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;

        if (isPlaying) {
            audio.pause();
            setIsPlaying(false);
        } else {
            audio.play().catch(() => { });
            setIsPlaying(true);
        }
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        if (!audio || duration === 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = x / rect.width;
        audio.currentTime = percent * duration;
    };

    const handleDownload = async () => {
        try {
            const response = await fetch(asset.url);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audio-${asset.id}.mp3`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed:', err);
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="relative rounded-xl overflow-hidden bg-slate-900/80 border border-slate-700/50 p-4 transition-all duration-300 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10">
            {/* Hidden Audio Element */}
            <audio ref={audioRef} src={asset.url} preload="metadata" />

            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                        <Mic2 size={16} className="text-purple-400" />
                    </div>
                    <div>
                        <div className="text-sm text-white font-medium">
                            {asset.alt || 'Audio'}
                        </div>
                        {asset.provider && (
                            <div className="text-[10px] text-purple-400 uppercase tracking-wider">
                                {asset.provider}
                            </div>
                        )}
                    </div>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                    {formatTime(currentTime)} / {formatTime(duration)}
                </div>
            </div>

            {/* Waveform & Controls */}
            <div className="flex items-center gap-3">
                {/* Play Button */}
                <button
                    onClick={togglePlay}
                    disabled={isLoading}
                    className={`
                        w-10 h-10 flex items-center justify-center rounded-full
                        transition-all duration-300
                        ${isPlaying
                            ? 'bg-purple-500 hover:bg-purple-400'
                            : 'bg-slate-700 hover:bg-slate-600'
                        }
                        disabled:opacity-50
                    `}
                >
                    {isPlaying ? (
                        <Pause size={18} className="text-white" fill="white" />
                    ) : (
                        <Play size={18} className="text-white ml-0.5" fill="white" />
                    )}
                </button>

                {/* Waveform */}
                <div
                    className="flex-1 h-12 flex items-end gap-[2px] cursor-pointer relative"
                    onClick={handleSeek}
                >
                    {waveformData.map((height, i) => {
                        const barProgress = (i / waveformData.length) * 100;
                        const isPlayed = barProgress <= progressPercent;

                        return (
                            <div
                                key={i}
                                className={`
                                    flex-1 rounded-full transition-all duration-150
                                    ${isPlayed ? 'bg-purple-500' : 'bg-slate-600'}
                                `}
                                style={{
                                    height: `${height * 100}%`,
                                    minHeight: '4px'
                                }}
                            />
                        );
                    })}

                    {/* Progress Indicator */}
                    <div
                        className="absolute top-0 bottom-0 w-0.5 bg-white/80 rounded-full shadow-glow"
                        style={{ left: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700/50">
                <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300 transition-colors"
                >
                    <Download size={12} />
                    Download
                </button>
                {onAction && (
                    <button
                        onClick={() => onAction('regenerate')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg text-xs text-purple-300 transition-colors"
                    >
                        <RefreshCw size={12} />
                        Regenerate
                    </button>
                )}
            </div>
        </div>
    );
};

export default AudioCard;
