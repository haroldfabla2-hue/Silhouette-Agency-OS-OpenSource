/**
 * VoiceLibraryModal
 * Premium UI for browsing and selecting voices from the curated library
 * and managing user-cloned voices
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../utils/api';

interface Voice {
    id: string;
    name: string;
    description?: string;
    category: 'library' | 'cloned' | 'custom';
    language: string;
    gender?: 'male' | 'female' | 'neutral';
    style?: 'professional' | 'casual' | 'narrative' | 'expressive' | 'neutral';
    thumbnailUrl?: string;
    isDefault: boolean;
    isDownloaded: boolean;
    duration?: number;
}

interface VoiceLibraryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectVoice: (voiceId: string) => void;
    onOpenCloneWizard?: () => void;
    currentVoiceId?: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
    'en': 'English',
    'es': 'Español',
    'fr': 'Français',
    'de': 'Deutsch',
    'it': 'Italiano',
    'pt': 'Português',
    'ja': '日本語',
    'zh-cn': '中文',
    'ru': 'Русский',
    'ar': 'العربية'
};

const CATEGORY_TABS = [
    { id: 'all', label: 'All Voices', icon: '🎤' },
    { id: 'library', label: 'Library', icon: '📚' },
    { id: 'cloned', label: 'My Voices', icon: '🎙️' }
];

export const VoiceLibraryModal = ({
    isOpen,
    onClose,
    onSelectVoice,
    onOpenCloneWizard,
    currentVoiceId
}: VoiceLibraryModalProps) => {
    const [voices, setVoices] = useState<Voice[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'all' | 'library' | 'cloned'>('all');
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Fetch voices on mount
    useEffect(() => {
        if (isOpen) {
            fetchVoices();
        }
    }, [isOpen]);

    const fetchVoices = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/v1/voices/library') as {
                library: Voice[];
                cloned: Voice[];
                custom: Voice[]
            };
            const allVoices = [...(res.library || []), ...(res.cloned || []), ...(res.custom || [])];
            setVoices(allVoices);
        } catch (e: any) {
            setError(e.message || 'Failed to load voices');
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async (voiceId: string) => {
        setDownloadingId(voiceId);
        try {
            await api.post(`/v1/voices/library/download/${voiceId}`, {});
            await fetchVoices(); // Refresh list
        } catch (e: any) {
            setError(e.message);
        } finally {
            setDownloadingId(null);
        }
    };

    const handlePlaySample = useCallback(async (voiceId: string) => {
        if (playingId === voiceId) {
            // Stop playing
            audioRef.current?.pause();
            setPlayingId(null);
            return;
        }

        try {
            const voice = voices.find(v => v.id === voiceId);
            if (!voice?.isDownloaded) return;

            // Create audio element
            if (audioRef.current) {
                audioRef.current.pause();
            }

            const audio = new Audio(`/v1/voices/${voiceId}/sample`);
            audioRef.current = audio;

            audio.onended = () => setPlayingId(null);
            audio.onerror = () => {
                setPlayingId(null);
                setError('Failed to play sample');
            };

            setPlayingId(voiceId);
            await audio.play();
        } catch (e) {
            setPlayingId(null);
        }
    }, [playingId, voices]);

    const handleSelect = (voiceId: string) => {
        onSelectVoice(voiceId);
        onClose();
    };

    const handleDelete = async (voiceId: string) => {
        if (!confirm('Are you sure you want to delete this voice?')) return;

        try {
            await api.delete(`/v1/voices/${voiceId}`);
            await fetchVoices();
        } catch (e: any) {
            setError(e.message);
        }
    };

    // Filter voices
    const filteredVoices = voices.filter(voice => {
        // Tab filter
        if (activeTab !== 'all' && voice.category !== activeTab) return false;

        // Search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return (
                voice.name.toLowerCase().includes(query) ||
                voice.description?.toLowerCase().includes(query) ||
                voice.language.toLowerCase().includes(query) ||
                LANGUAGE_NAMES[voice.language]?.toLowerCase().includes(query)
            );
        }

        return true;
    });

    if (!isOpen) return null;

    return (
        <div className="voice-library-overlay" onClick={onClose}>
            <div className="voice-library-modal" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="voice-library-header">
                    <div className="header-title">
                        <span className="header-icon">🎤</span>
                        <h2>Voice Library</h2>
                    </div>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                {/* Search & Actions */}
                <div className="voice-library-toolbar">
                    <div className="search-box">
                        <span className="search-icon">🔍</span>
                        <input
                            type="text"
                            placeholder="Search voices..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {onOpenCloneWizard && (
                        <button className="clone-btn" onClick={onOpenCloneWizard}>
                            <span>✨</span> Clone My Voice
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className="voice-library-tabs">
                    {CATEGORY_TABS.map(tab => (
                        <button
                            key={tab.id}
                            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id as any)}
                        >
                            <span>{tab.icon}</span>
                            {tab.label}
                            <span className="count">
                                {tab.id === 'all'
                                    ? voices.length
                                    : voices.filter(v => v.category === tab.id).length}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Voice Grid */}
                <div className="voice-library-content">
                    {loading ? (
                        <div className="loading-state">
                            <div className="spinner"></div>
                            <p>Loading voices...</p>
                        </div>
                    ) : error ? (
                        <div className="error-state">
                            <span>⚠️</span>
                            <p>{error}</p>
                            <button onClick={fetchVoices}>Retry</button>
                        </div>
                    ) : filteredVoices.length === 0 ? (
                        <div className="empty-state">
                            <span>🎙️</span>
                            <p>No voices found</p>
                            {activeTab === 'cloned' && (
                                <button onClick={onOpenCloneWizard}>Clone Your Voice</button>
                            )}
                        </div>
                    ) : (
                        <div className="voice-grid">
                            {filteredVoices.map(voice => (
                                <div
                                    key={voice.id}
                                    className={`voice-card ${currentVoiceId === voice.id ? 'selected' : ''} ${!voice.isDownloaded ? 'not-downloaded' : ''}`}
                                >
                                    {/* Avatar */}
                                    <div className="voice-avatar">
                                        <span className="avatar-emoji">{voice.thumbnailUrl || '🎤'}</span>
                                        {voice.isDefault && <span className="default-badge">★</span>}
                                    </div>

                                    {/* Info */}
                                    <div className="voice-info">
                                        <h3>{voice.name}</h3>
                                        <p className="voice-description">{voice.description}</p>

                                        <div className="voice-tags">
                                            <span className="tag language">{LANGUAGE_NAMES[voice.language] || voice.language}</span>
                                            {voice.gender && <span className="tag gender">{voice.gender}</span>}
                                            {voice.style && <span className="tag style">{voice.style}</span>}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="voice-actions">
                                        {!voice.isDownloaded ? (
                                            <button
                                                className="download-btn"
                                                onClick={() => handleDownload(voice.id)}
                                                disabled={downloadingId === voice.id}
                                            >
                                                {downloadingId === voice.id ? (
                                                    <span className="spinner-small"></span>
                                                ) : (
                                                    <>⬇️ Download</>
                                                )}
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    className={`play-btn ${playingId === voice.id ? 'playing' : ''}`}
                                                    onClick={() => handlePlaySample(voice.id)}
                                                >
                                                    {playingId === voice.id ? '⏹️' : '▶️'}
                                                </button>
                                                <button
                                                    className="select-btn"
                                                    onClick={() => handleSelect(voice.id)}
                                                >
                                                    Use Voice
                                                </button>
                                                {voice.category === 'cloned' && (
                                                    <button
                                                        className="delete-btn"
                                                        onClick={() => handleDelete(voice.id)}
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="voice-library-footer">
                    <p className="voice-count">
                        {voices.filter(v => v.isDownloaded).length} / {voices.length} voices available
                    </p>
                </div>
            </div>

            <style>{`
                .voice-library-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.8);
                    backdrop-filter: blur(8px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    animation: fadeIn 0.2s ease;
                }

                .voice-library-modal {
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    width: 90%;
                    max-width: 900px;
                    max-height: 85vh;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                    animation: slideUp 0.3s ease;
                }

                .voice-library-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 20px 24px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    background: rgba(0, 0, 0, 0.2);
                }

                .header-title {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .header-icon {
                    font-size: 28px;
                }

                .header-title h2 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 600;
                    color: white;
                }

                .close-btn {
                    background: none;
                    border: none;
                    color: rgba(255, 255, 255, 0.6);
                    font-size: 28px;
                    cursor: pointer;
                    padding: 4px 12px;
                    border-radius: 8px;
                    transition: all 0.2s;
                }

                .close-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: white;
                }

                .voice-library-toolbar {
                    display: flex;
                    gap: 12px;
                    padding: 16px 24px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                }

                .search-box {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    background: rgba(0, 0, 0, 0.3);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    padding: 0 14px;
                }

                .search-icon {
                    margin-right: 10px;
                    opacity: 0.5;
                }

                .search-box input {
                    flex: 1;
                    background: none;
                    border: none;
                    color: white;
                    padding: 12px 0;
                    font-size: 14px;
                    outline: none;
                }

                .search-box input::placeholder {
                    color: rgba(255, 255, 255, 0.4);
                }

                .clone-btn {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border: none;
                    color: white;
                    padding: 12px 20px;
                    border-radius: 10px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: all 0.2s;
                }

                .clone-btn:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
                }

                .voice-library-tabs {
                    display: flex;
                    gap: 8px;
                    padding: 16px 24px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                }

                .tab {
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: rgba(255, 255, 255, 0.7);
                    padding: 10px 16px;
                    border-radius: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    transition: all 0.2s;
                }

                .tab:hover {
                    background: rgba(255, 255, 255, 0.1);
                }

                .tab.active {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-color: transparent;
                    color: white;
                }

                .tab .count {
                    background: rgba(0, 0, 0, 0.3);
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 12px;
                }

                .voice-library-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                }

                .voice-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: 16px;
                }

                .voice-card {
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 12px;
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    transition: all 0.2s;
                }

                .voice-card:hover {
                    background: rgba(255, 255, 255, 0.06);
                    border-color: rgba(255, 255, 255, 0.15);
                    transform: translateY(-2px);
                }

                .voice-card.selected {
                    border-color: #667eea;
                    box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.3);
                }

                .voice-card.not-downloaded {
                    opacity: 0.7;
                }

                .voice-avatar {
                    position: relative;
                    text-align: center;
                }

                .avatar-emoji {
                    font-size: 48px;
                }

                .default-badge {
                    position: absolute;
                    top: -4px;
                    right: calc(50% - 30px);
                    background: #ffd700;
                    color: #1a1a2e;
                    font-size: 12px;
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .voice-info {
                    text-align: center;
                }

                .voice-info h3 {
                    margin: 0 0 4px;
                    font-size: 16px;
                    font-weight: 600;
                    color: white;
                }

                .voice-description {
                    margin: 0 0 8px;
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.5);
                    line-height: 1.4;
                }

                .voice-tags {
                    display: flex;
                    gap: 6px;
                    justify-content: center;
                    flex-wrap: wrap;
                }

                .tag {
                    font-size: 10px;
                    padding: 3px 8px;
                    border-radius: 4px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .tag.language {
                    background: rgba(59, 130, 246, 0.2);
                    color: #60a5fa;
                }

                .tag.gender {
                    background: rgba(168, 85, 247, 0.2);
                    color: #c084fc;
                }

                .tag.style {
                    background: rgba(34, 197, 94, 0.2);
                    color: #4ade80;
                }

                .voice-actions {
                    display: flex;
                    gap: 8px;
                    justify-content: center;
                    margin-top: auto;
                }

                .voice-actions button {
                    padding: 8px 14px;
                    border-radius: 8px;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: none;
                }

                .download-btn {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    width: 100%;
                }

                .play-btn {
                    background: rgba(255, 255, 255, 0.1);
                    color: white;
                }

                .play-btn.playing {
                    background: #ef4444;
                }

                .select-btn {
                    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                    color: white;
                    flex: 1;
                }

                .delete-btn {
                    background: rgba(239, 68, 68, 0.2);
                    color: #ef4444;
                }

                .delete-btn:hover {
                    background: rgba(239, 68, 68, 0.3);
                }

                .loading-state,
                .error-state,
                .empty-state {
                    text-align: center;
                    padding: 60px 20px;
                    color: rgba(255, 255, 255, 0.6);
                }

                .loading-state span,
                .error-state span,
                .empty-state span {
                    font-size: 48px;
                    display: block;
                    margin-bottom: 16px;
                }

                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid rgba(255, 255, 255, 0.1);
                    border-top-color: #667eea;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 16px;
                }

                .spinner-small {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    border-top-color: white;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }

                .voice-library-footer {
                    padding: 16px 24px;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                    background: rgba(0, 0, 0, 0.2);
                    text-align: center;
                }

                .voice-count {
                    margin: 0;
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.5);
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideUp {
                    from { 
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to { 
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default VoiceLibraryModal;
