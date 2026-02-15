import React, { useState, useEffect, useRef } from 'react';
import { X, Volume2, Mic, Upload, Play, Loader2, Save, Trash2, RefreshCw, Library, Sparkles } from 'lucide-react';
import { api } from '../../utils/api';
import { VoiceLibraryModal } from './VoiceLibraryModal';
import { VoiceCloningWizard } from './VoiceCloningWizard';

interface VoiceConfig {
    enabled: boolean;
    autoSpeak: boolean;
    voiceId?: string;
    volume: number;
}

interface VoiceSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentConfig: VoiceConfig;
    onSave: (config: VoiceConfig) => void;
}

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({ isOpen, onClose, currentConfig, onSave }) => {
    const [config, setConfig] = useState<VoiceConfig>(currentConfig);
    const [voices, setVoices] = useState<{ default_models: string[]; cloned_voices: string[] }>({ default_models: [], cloned_voices: [] });
    const [loading, setLoading] = useState(false);
    const [cloning, setCloning] = useState(false);
    const [cloneName, setCloneName] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [health, setHealth] = useState<string>('UNKNOWN');

    // New modal states
    const [showLibrary, setShowLibrary] = useState(false);
    const [showCloneWizard, setShowCloneWizard] = useState(false);
    const [selectedVoiceName, setSelectedVoiceName] = useState<string>('Default Voice');

    useEffect(() => {
        if (isOpen) {
            loadVoices();
            checkHealth();
            setConfig(currentConfig);
        }
    }, [isOpen]);

    const loadVoices = async () => {
        setLoading(true);
        try {
            const res = await api.get<any>('/v1/media/tts/voices');
            if (res.voices) {
                setVoices(res.voices);
            }
        } catch (error) {
            console.error('Failed to load voices', error);
        } finally {
            setLoading(false);
        }
    };

    const checkHealth = async () => {
        try {
            const res = await api.get<any>('/v1/media/tts/health');
            setHealth(res.status);
        } catch (e) {
            setHealth('OFFLINE');
        }
    }

    const handleClone = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0] || !cloneName) return;

        try {
            setCloning(true);
            const formData = new FormData();
            formData.append('file', e.target.files[0]);
            formData.append('name', cloneName);

            const rawRes = await api.fetch('/v1/media/tts/voices/clone', {
                method: 'POST',
                body: formData
            });
            const res = await rawRes.json();

            if (res.success) {
                await loadVoices();
                setConfig({ ...config, voiceId: res.voice_id });
                setCloneName('');
            }
        } catch (error) {
            console.error('Cloning failed', error);
            alert('Failed to clone voice. Ensure backend is running.');
        } finally {
            setCloning(false);
        }
    };

    const handleVoiceSelect = (voiceId: string) => {
        setConfig({ ...config, voiceId });
        // Update selected voice name for display
        setSelectedVoiceName(voiceId ? voiceId.replace('.wav', '').replace(/_/g, ' ') : 'Default Voice');
    };

    const handleCloneComplete = async (voiceId: string) => {
        await loadVoices();
        handleVoiceSelect(voiceId);
    };

    const handleSave = () => {
        onSave(config);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="w-full max-w-lg bg-[#1a1b26] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#16161e]">
                        <div className="flex items-center gap-2">
                            <Mic className="text-purple-400 w-5 h-5" />
                            <h2 className="text-lg font-medium text-white">Voice Settings</h2>
                        </div>
                        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6 overflow-y-auto">

                        {/* Status Check */}
                        <div className={`flex items-center gap-2 text-xs font-mono p-2 rounded ${health.includes('ONLINE') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            <div className={`w-2 h-2 rounded-full ${health.includes('ONLINE') ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                            ENGINE STATUS: {health}
                        </div>

                        {/* Quick Actions - NEW */}
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setShowLibrary(true)}
                                className="flex items-center justify-center gap-2 p-4 bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/30 rounded-lg hover:border-purple-500/50 transition-all group"
                            >
                                <Library className="w-5 h-5 text-purple-400 group-hover:scale-110 transition-transform" />
                                <span className="text-sm font-medium text-white">Voice Library</span>
                            </button>
                            <button
                                onClick={() => setShowCloneWizard(true)}
                                className="flex items-center justify-center gap-2 p-4 bg-gradient-to-br from-pink-600/20 to-purple-600/20 border border-pink-500/30 rounded-lg hover:border-pink-500/50 transition-all group"
                            >
                                <Sparkles className="w-5 h-5 text-pink-400 group-hover:scale-110 transition-transform" />
                                <span className="text-sm font-medium text-white">Clone Voice</span>
                            </button>
                        </div>

                        {/* Current Voice Display - NEW */}
                        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-xs text-white/40 uppercase tracking-wider">Current Voice</span>
                                    <p className="text-lg font-medium text-white mt-1">{selectedVoiceName}</p>
                                </div>
                                <button
                                    onClick={() => setShowLibrary(true)}
                                    className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
                                >
                                    Change →
                                </button>
                            </div>
                        </div>

                        {/* Auto-Speak Toggle */}
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-white/80">Auto-Speak Responses</label>
                            <button
                                onClick={() => setConfig({ ...config, autoSpeak: !config.autoSpeak })}
                                className={`w-12 h-6 rounded-full transition-colors relative ${config.autoSpeak ? 'bg-purple-500' : 'bg-white/10'}`}
                            >
                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${config.autoSpeak ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        {/* Volume Slider */}
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-white/60">Volume</span>
                                <span className="text-white font-mono">{(config.volume * 100).toFixed(0)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={config.volume}
                                onChange={(e) => setConfig({ ...config, volume: parseFloat(e.target.value) })}
                                className="w-full accent-purple-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        <div className="h-px bg-white/10 my-4" />

                        {/* Voice Selection (Simplified) */}
                        <div className="space-y-4">
                            <label className="text-sm font-medium text-white/80 block">Quick Voice Selection</label>

                            {loading ? (
                                <div className="flex items-center justify-center py-4 text-white/40">
                                    <Loader2 className="animate-spin mr-2" /> Loading voices...
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                    {/* Default Model */}
                                    <button
                                        onClick={() => handleVoiceSelect('')}
                                        className={`flex items-center justify-between p-3 rounded-lg border text-left transition-all ${!config.voiceId
                                            ? 'bg-purple-500/20 border-purple-500/50 text-white'
                                            : 'bg-white/5 border-transparent text-white/60 hover:bg-white/10'
                                            }`}
                                    >
                                        <span className="text-sm">🎤 Default Voice</span>
                                        {!config.voiceId && <div className="w-2 h-2 rounded-full bg-purple-500" />}
                                    </button>

                                    {/* Cloned Voices */}
                                    {voices.cloned_voices.map((voice) => (
                                        <button
                                            key={voice}
                                            onClick={() => handleVoiceSelect(voice)}
                                            className={`flex items-center justify-between p-3 rounded-lg border text-left transition-all ${config.voiceId === voice
                                                ? 'bg-purple-500/20 border-purple-500/50 text-white'
                                                : 'bg-white/5 border-transparent text-white/60 hover:bg-white/10'
                                                }`}
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-sm truncate">🎙️ {voice.replace('.wav', '')}</span>
                                                <span className="text-xs text-white/30 uppercase">Cloned</span>
                                            </div>
                                            {config.voiceId === voice && <div className="w-2 h-2 rounded-full bg-purple-500" />}
                                        </button>
                                    ))}

                                    {/* Show more prompt */}
                                    {voices.cloned_voices.length === 0 && (
                                        <div className="text-center py-4 text-white/40 text-sm">
                                            <p>No custom voices yet</p>
                                            <button
                                                onClick={() => setShowLibrary(true)}
                                                className="text-purple-400 hover:text-purple-300 mt-2"
                                            >
                                                Browse Voice Library →
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Quick Clone Section (Simplified) */}
                        <div className="bg-white/5 rounded-lg p-4 border border-white/10 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-purple-300">
                                <Upload size={16} />
                                <span>Quick Upload (6-15 sec WAV)</span>
                            </div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Voice name"
                                    value={cloneName}
                                    onChange={(e) => setCloneName(e.target.value)}
                                    className="flex-1 bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={cloning || !cloneName}
                                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                    {cloning ? <Loader2 className="animate-spin w-4 h-4" /> : <Upload className="w-4 h-4" />}
                                    {cloning ? 'Cloning...' : 'Upload'}
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept=".wav"
                                    className="hidden"
                                    onChange={handleClone}
                                />
                            </div>

                            <p className="text-xs text-white/30 text-center">
                                For better results, use the <button onClick={() => setShowCloneWizard(true)} className="text-purple-400 hover:underline">Voice Cloning Wizard</button>
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/10 bg-[#16161e] flex justify-end gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-6 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                            <Save size={16} />
                            Save Settings
                        </button>
                    </div>
                </div>
            </div>

            {/* Voice Library Modal */}
            <VoiceLibraryModal
                isOpen={showLibrary}
                onClose={() => setShowLibrary(false)}
                onSelectVoice={handleVoiceSelect}
                onOpenCloneWizard={() => {
                    setShowLibrary(false);
                    setShowCloneWizard(true);
                }}
                currentVoiceId={config.voiceId}
            />

            {/* Voice Cloning Wizard */}
            <VoiceCloningWizard
                isOpen={showCloneWizard}
                onClose={() => setShowCloneWizard(false)}
                onComplete={handleCloneComplete}
            />
        </>
    );
};

