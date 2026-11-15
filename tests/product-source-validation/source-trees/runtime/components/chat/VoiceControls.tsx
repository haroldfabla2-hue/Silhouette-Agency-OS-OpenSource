import React, { useState, useRef, useEffect } from 'react';
import { Volume2, Pause, Play, Loader2, VolumeX } from 'lucide-react';
import { api, API_BASE_URL } from '../../utils/api';

interface VoiceControlsProps {
    text: string;
    autoPlay?: boolean;
    voiceId?: string;
    onPlaybackStatus?: (status: 'playing' | 'stopped') => void;
}

export const VoiceControls: React.FC<VoiceControlsProps> = ({
    text,
    autoPlay = false,
    voiceId,
    onPlaybackStatus
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Auto-play effect
    useEffect(() => {
        if (autoPlay && text && !audioUrl && !isPlaying && !error) {
            handlePlay();
        }
    }, [autoPlay, text]);

    const handlePlay = async () => {
        if (isPlaying && audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
            onPlaybackStatus?.('stopped');
            return;
        }

        // Resume if paused and URL exists
        if (audioUrl && audioRef.current && audioRef.current.paused && audioRef.current.currentTime > 0) {
            try {
                await audioRef.current.play();
                setIsPlaying(true);
                onPlaybackStatus?.('playing');
                return;
            } catch (e) {
                console.warn("Resume failed, retrying fetch");
            }
        }

        // Fetch new audio
        setIsLoading(true);
        setError(false);

        try {
            const response = await api.post<{ success: boolean; url: string }>('/v1/media/tts/speak', {
                text,
                voice_id: voiceId
            });

            if (response && response.success && response.url) {
                // Ensure URL is absolute if backend returns relative
                const url = response.url.startsWith('http')
                    ? response.url
                    : `${API_BASE_URL || 'http://localhost:3000'}${response.url}`;

                setAudioUrl(url);

                // Initialize audio
                if (!audioRef.current) {
                    audioRef.current = new Audio(url);
                    audioRef.current.onended = () => {
                        setIsPlaying(false);
                        onPlaybackStatus?.('stopped');
                    };
                    audioRef.current.onerror = () => {
                        setIsLoading(false);
                        setIsPlaying(false);
                        setError(true);
                        onPlaybackStatus?.('stopped');
                    };
                } else {
                    audioRef.current.src = url;
                }

                await audioRef.current.play();
                setIsPlaying(true);
                onPlaybackStatus?.('playing');
            } else {
                throw new Error('Invalid response');
            }
        } catch (err) {
            console.error('[Voice] Playback failed', err);
            setError(true);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center gap-2 mt-2">
            <button
                onClick={handlePlay}
                disabled={isLoading}
                className={`
                    flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all duration-300
                    ${error
                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                        : isPlaying
                            ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/50'
                            : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-cyan-400'
                    }
                `}
            >
                {isLoading ? (
                    <Loader2 size={12} className="animate-spin" />
                ) : isPlaying ? (
                    <Pause size={12} />
                ) : error ? (
                    <VolumeX size={12} />
                ) : (
                    <Volume2 size={12} />
                )}

                <span>
                    {isLoading ? 'Generating...' : isPlaying ? 'Stop' : error ? 'Error' : 'Listen'}
                </span>
            </button>

            {/* Visualizer (Fake bars) when playing */}
            {isPlaying && (
                <div className="flex items-center gap-[2px] h-3">
                    {[...Array(5)].map((_, i) => (
                        <div
                            key={i}
                            className="w-0.5 bg-cyan-400/80 rounded-full animate-pulse"
                            style={{
                                height: `${Math.max(20, Math.random() * 100)}%`,
                                animationDuration: `${0.4 + Math.random() * 0.4}s`
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
