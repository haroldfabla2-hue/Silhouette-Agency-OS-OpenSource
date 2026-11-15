/**
 * VoiceLipSyncPanel - ElevenLabs voice generation with lip sync controls
 * Inspired by ElevenLabs UI: voice picker, stability/similarity sliders, emotion tags
 */

import React, { useState, useEffect, useRef } from 'react';

interface Voice {
    voice_id: string;
    name: string;
    preview_url?: string;
    labels?: Record<string, string>;
}

interface VoiceLipSyncPanelProps {
    videoUrl?: string;
    onVoiceGenerated?: (audioUrl: string) => void;
    onLipSyncApplied?: (videoUrl: string) => void;
}

const VoiceLipSyncPanel: React.FC<VoiceLipSyncPanelProps> = ({
    videoUrl,
    onVoiceGenerated,
    onLipSyncApplied
}) => {
    const [voices, setVoices] = useState<Voice[]>([]);
    const [selectedVoice, setSelectedVoice] = useState<string>('');
    const [script, setScript] = useState('');
    const [stability, setStability] = useState(0.5);
    const [similarity, setSimilarity] = useState(0.75);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedAudio, setGeneratedAudio] = useState<string | null>(null);
    const [isApplyingLipSync, setIsApplyingLipSync] = useState(false);
    const [isPlayingPreview, setIsPlayingPreview] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Emotion tags for ElevenLabs v3
    const emotionTags = [
        { tag: '[whispers]', label: '🤫 Whisper' },
        { tag: '[excited]', label: '😄 Excited' },
        { tag: '[sighs]', label: '😮‍💨 Sigh' },
        { tag: '[laughs]', label: '😂 Laugh' },
        { tag: '[sad]', label: '😢 Sad' },
        { tag: '[angry]', label: '😠 Angry' },
    ];

    useEffect(() => {
        fetchVoices();
    }, []);

    const fetchVoices = async () => {
        try {
            const res = await fetch('/v1/media/voices');
            if (res.ok) {
                const data = await res.json();
                setVoices(data.voices || []);
                if (data.voices?.length > 0) {
                    setSelectedVoice(data.voices[0].voice_id);
                }
            }
        } catch (e) {
            console.error('Failed to fetch voices:', e);
            // Demo voices fallback
            setVoices([
                { voice_id: 'rachel', name: 'Rachel', labels: { accent: 'American', gender: 'Female' } },
                { voice_id: 'adam', name: 'Adam', labels: { accent: 'American', gender: 'Male' } },
                { voice_id: 'bella', name: 'Bella', labels: { accent: 'British', gender: 'Female' } },
            ]);
            setSelectedVoice('rachel');
        }
    };

    const insertEmotionTag = (tag: string) => {
        setScript(prev => prev + ' ' + tag + ' ');
    };

    const generateVoice = async () => {
        if (!script.trim()) return;

        setIsGenerating(true);
        try {
            const res = await fetch('/v1/media/generate/voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: script,
                    voiceId: selectedVoice,
                    settings: { stability, similarity_boost: similarity }
                })
            });

            if (res.ok) {
                const data = await res.json();
                setGeneratedAudio(data.audioUrl);
                onVoiceGenerated?.(data.audioUrl);
            }
        } catch (e) {
            console.error('Voice generation failed:', e);
        } finally {
            setIsGenerating(false);
        }
    };

    const applyLipSync = async () => {
        if (!videoUrl || !generatedAudio) return;

        setIsApplyingLipSync(true);
        try {
            const res = await fetch('/v1/media/lipsync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrl,
                    audioUrl: generatedAudio
                })
            });

            if (res.ok) {
                const data = await res.json();
                onLipSyncApplied?.(data.videoUrl);
            }
        } catch (e) {
            console.error('Lip sync failed:', e);
        } finally {
            setIsApplyingLipSync(false);
        }
    };

    const playVoicePreview = async (previewUrl?: string) => {
        if (!previewUrl) return;

        if (audioRef.current) {
            audioRef.current.pause();
        }

        audioRef.current = new Audio(previewUrl);
        audioRef.current.onplay = () => setIsPlayingPreview(true);
        audioRef.current.onended = () => setIsPlayingPreview(false);
        audioRef.current.play();
    };

    const selectedVoiceData = voices.find(v => v.voice_id === selectedVoice);

    return (
        <div className="bg-slate-900/80 rounded-xl border border-slate-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 p-3 border-b border-slate-700">
                <span className="text-lg">🎤</span>
                <span className="text-sm font-medium text-white">Voice & Lip Sync</span>
            </div>

            <div className="p-3 space-y-4">
                {/* Voice Selector */}
                <div className="space-y-2">
                    <label className="text-xs text-slate-400">Voice</label>
                    <div className="flex gap-2">
                        <select
                            value={selectedVoice}
                            onChange={(e) => setSelectedVoice(e.target.value)}
                            className="flex-1 px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                        >
                            {voices.map(voice => (
                                <option key={voice.voice_id} value={voice.voice_id}>
                                    {voice.name} {voice.labels?.gender ? `(${voice.labels.gender})` : ''}
                                </option>
                            ))}
                        </select>
                        <button
                            onClick={() => playVoicePreview(selectedVoiceData?.preview_url)}
                            disabled={!selectedVoiceData?.preview_url || isPlayingPreview}
                            className="px-3 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 disabled:opacity-50 transition-colors"
                        >
                            {isPlayingPreview ? '🔊' : '▶'}
                        </button>
                    </div>
                </div>

                {/* Script Textarea */}
                <div className="space-y-2">
                    <label className="text-xs text-slate-400">Script / Dialogue</label>
                    <textarea
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                        placeholder="Enter the text to speak... Use emotion tags like [whispers] or [excited]"
                        className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 h-24 resize-none"
                    />
                </div>

                {/* Emotion Tags */}
                <div className="space-y-2">
                    <label className="text-xs text-slate-400">Emotion Tags</label>
                    <div className="flex flex-wrap gap-1">
                        {emotionTags.map(({ tag, label }) => (
                            <button
                                key={tag}
                                onClick={() => insertEmotionTag(tag)}
                                className="px-2 py-1 text-xs bg-slate-800 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-700 hover:border-slate-500 transition-colors"
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Stability Slider */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-slate-400">Stability</label>
                        <span className="text-xs text-cyan-400">{stability.toFixed(2)}</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={stability}
                        onChange={(e) => setStability(parseFloat(e.target.value))}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                        <span>More Dynamic</span>
                        <span>More Consistent</span>
                    </div>
                </div>

                {/* Similarity Slider */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-slate-400">Similarity</label>
                        <span className="text-xs text-cyan-400">{similarity.toFixed(2)}</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={similarity}
                        onChange={(e) => setSimilarity(parseFloat(e.target.value))}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                        <span>More Unique</span>
                        <span>More Similar</span>
                    </div>
                </div>

                {/* Generated Audio Preview */}
                {generatedAudio && (
                    <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-600">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-green-400">✓ Audio Generated</span>
                        </div>
                        <audio controls src={generatedAudio} className="w-full h-8" />
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                    <button
                        onClick={generateVoice}
                        disabled={!script.trim() || isGenerating}
                        className="flex-1 px-4 py-2 text-sm bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                        {isGenerating ? (
                            <>
                                <span className="animate-spin">⏳</span>
                                Generating...
                            </>
                        ) : (
                            <>🎤 Generate Voice</>
                        )}
                    </button>

                    {generatedAudio && videoUrl && (
                        <button
                            onClick={applyLipSync}
                            disabled={isApplyingLipSync}
                            className="flex-1 px-4 py-2 text-sm bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                        >
                            {isApplyingLipSync ? (
                                <>
                                    <span className="animate-spin">⏳</span>
                                    Syncing...
                                </>
                            ) : (
                                <>👄 Apply Lip Sync</>
                            )}
                        </button>
                    )}
                </div>

                {!videoUrl && (
                    <p className="text-[10px] text-slate-500 text-center">
                        💡 Generate a video first, then apply lip sync
                    </p>
                )}
            </div>
        </div>
    );
};

export default VoiceLipSyncPanel;
