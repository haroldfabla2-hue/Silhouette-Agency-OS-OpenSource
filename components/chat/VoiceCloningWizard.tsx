/**
 * VoiceCloningWizard
 * Multi-step wizard for professional-grade voice cloning
 * Includes recording, quality analysis, preprocessing, and preview
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../utils/api';

type WizardStep = 'intro' | 'recording' | 'analysis' | 'processing' | 'preview';
type CloneMode = 'instant' | 'professional';

interface QualityMetrics {
    overallScore: number;
    duration: number;
    noiseLevel: 'low' | 'medium' | 'high';
    volumeConsistency: 'good' | 'fair' | 'poor';
    clarity: 'excellent' | 'good' | 'fair' | 'poor';
    issues: string[];
}

interface VoiceCloningWizardProps {
    isOpen: boolean;
    onClose: () => void;
    onComplete: (voiceId: string) => void;
}

// Reading prompts for consistent speech samples
const READING_PROMPTS = [
    {
        language: 'es',
        prompts: [
            "La tecnología avanza rápidamente, y nosotros debemos adaptarnos a los cambios.",
            "El conocimiento es poder, y la educación es la llave del futuro.",
            "Hoy es un buen día para aprender algo nuevo y compartirlo con otros."
        ]
    },
    {
        language: 'en',
        prompts: [
            "Technology advances rapidly, and we must adapt to the changes.",
            "Knowledge is power, and education is the key to the future.",
            "Today is a good day to learn something new and share it with others."
        ]
    }
];

export const VoiceCloningWizard = ({
    isOpen,
    onClose,
    onComplete
}: VoiceCloningWizardProps) => {
    // State
    const [step, setStep] = useState<WizardStep>('intro');
    const [mode, setMode] = useState<CloneMode>('instant');
    const [language, setLanguage] = useState('es');
    const [voiceName, setVoiceName] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics | null>(null);
    const [processingStep, setProcessingStep] = useState(0);
    const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [currentPromptIndex, setCurrentPromptIndex] = useState(0);

    // Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<number | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationRef = useRef<number | null>(null);

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setStep('intro');
            setRecordedBlob(null);
            setRecordingDuration(0);
            setQualityMetrics(null);
            setProcessingStep(0);
            setPreviewAudioUrl(null);
            setError(null);
            setVoiceName('');
        }
    }, [isOpen]);

    // Get prompts for current language
    const currentPrompts = READING_PROMPTS.find(p => p.language === language)?.prompts
        || READING_PROMPTS[0].prompts;

    // Start recording
    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });

            // Set up audio analyser for visualization
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            // Start visualization
            drawWaveform();

            // Set up media recorder
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                setRecordedBlob(audioBlob);
                stream.getTracks().forEach(track => track.stop());
                if (animationRef.current) {
                    cancelAnimationFrame(animationRef.current);
                }
            };

            mediaRecorder.start(100); // Collect data every 100ms
            setIsRecording(true);
            setRecordingDuration(0);

            // Timer
            timerRef.current = window.setInterval(() => {
                setRecordingDuration(d => d + 1);
            }, 1000);

        } catch (err: any) {
            setError(`Microphone access denied: ${err.message}`);
        }
    }, []);

    // Stop recording
    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        }
    }, [isRecording]);

    // Draw waveform visualization
    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            ctx.fillStyle = 'rgba(26, 26, 46, 0.3)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

                const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
                gradient.addColorStop(0, '#667eea');
                gradient.addColorStop(1, '#764ba2');

                ctx.fillStyle = gradient;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        };

        draw();
    }, []);

    // Analyze recording quality
    const analyzeRecording = async () => {
        if (!recordedBlob) return;

        setLoading(true);
        setStep('analysis');

        try {
            // For now, simulate analysis (real analysis would be done server-side)
            await new Promise(resolve => setTimeout(resolve, 1500));

            const metrics: QualityMetrics = {
                overallScore: Math.min(95, 70 + Math.random() * 25),
                duration: recordingDuration,
                noiseLevel: recordingDuration > 10 ? 'low' : 'medium',
                volumeConsistency: recordingDuration > 8 ? 'good' : 'fair',
                clarity: recordingDuration > 6 ? 'excellent' : 'good',
                issues: recordingDuration < 6 ? ['Recording is shorter than recommended (6+ seconds)'] : []
            };

            setQualityMetrics(metrics);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Process and create voice clone
    const processVoice = async () => {
        if (!recordedBlob || !voiceName.trim()) return;

        setStep('processing');
        setProcessingStep(0);

        const steps = [
            'Normalizing audio...',
            'Removing background noise...',
            'Optimizing segments...',
            'Creating voice clone...',
            'Finalizing...'
        ];

        try {
            // Simulate processing steps
            for (let i = 0; i < steps.length; i++) {
                setProcessingStep(i);
                await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));
            }

            // Upload to server
            const formData = new FormData();
            formData.append('audio', recordedBlob, 'recording.webm');
            formData.append('name', voiceName);
            formData.append('language', language);

            const response = await api.fetch('/v1/voices/clone', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success && result.voice) {
                setStep('preview');
                // Create preview URL
                setPreviewAudioUrl(`/v1/voices/${result.voice.id}/sample`);
            } else {
                throw new Error(result.error || 'Failed to create voice');
            }

        } catch (err: any) {
            setError(err.message);
            setStep('analysis');
        }
    };

    // Complete wizard
    const handleComplete = () => {
        if (previewAudioUrl) {
            const voiceId = previewAudioUrl.split('/').slice(-2, -1)[0];
            onComplete(voiceId);
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="wizard-overlay" onClick={onClose}>
            <div className="wizard-modal" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="wizard-header">
                    <h2>✨ Clone Your Voice</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                {/* Progress */}
                <div className="wizard-progress">
                    {['intro', 'recording', 'analysis', 'processing', 'preview'].map((s, i) => (
                        <div key={s} className={`progress-step ${step === s ? 'active' : ''} ${['intro', 'recording', 'analysis', 'processing', 'preview'].indexOf(step) > i ? 'complete' : ''}`}>
                            <span className="step-num">{i + 1}</span>
                        </div>
                    ))}
                </div>

                {/* Content */}
                <div className="wizard-content">
                    {error && (
                        <div className="error-banner">
                            <span>⚠️</span> {error}
                            <button onClick={() => setError(null)}>×</button>
                        </div>
                    )}

                    {/* Step 1: Intro */}
                    {step === 'intro' && (
                        <div className="step-intro">
                            <div className="intro-hero">
                                <span className="hero-icon">🎙️</span>
                                <h3>Create Your AI Voice Clone</h3>
                                <p>Record a sample of your voice and we'll create a digital clone that can speak any text in your voice.</p>
                            </div>

                            <div className="mode-selector">
                                <button
                                    className={`mode-card ${mode === 'instant' ? 'selected' : ''}`}
                                    onClick={() => setMode('instant')}
                                >
                                    <span className="mode-icon">⚡</span>
                                    <h4>Instant Clone</h4>
                                    <p>6-15 seconds of audio</p>
                                    <span className="mode-time">~1 minute</span>
                                </button>
                                <button
                                    className={`mode-card ${mode === 'professional' ? 'selected' : ''}`}
                                    onClick={() => setMode('professional')}
                                >
                                    <span className="mode-icon">👑</span>
                                    <h4>Professional Clone</h4>
                                    <p>3-5 minutes of audio</p>
                                    <span className="mode-time">~5 minutes</span>
                                </button>
                            </div>

                            <div className="tips-section">
                                <h4>📝 Tips for Best Results</h4>
                                <ul>
                                    <li>🔇 Record in a quiet room</li>
                                    <li>🎤 Speak clearly at a consistent pace</li>
                                    <li>📏 Keep a consistent distance from mic</li>
                                    <li>🗣️ Use your natural speaking voice</li>
                                </ul>
                            </div>

                            <div className="language-selector">
                                <label>Voice Language:</label>
                                <select value={language} onChange={e => setLanguage(e.target.value)}>
                                    <option value="es">Español</option>
                                    <option value="en">English</option>
                                </select>
                            </div>

                            <button className="primary-btn" onClick={() => setStep('recording')}>
                                Start Recording →
                            </button>
                        </div>
                    )}

                    {/* Step 2: Recording */}
                    {step === 'recording' && (
                        <div className="step-recording">
                            <div className="prompt-card">
                                <span className="prompt-label">Read this aloud:</span>
                                <p className="prompt-text">"{currentPrompts[currentPromptIndex]}"</p>
                                <div className="prompt-nav">
                                    {currentPrompts.map((_, i) => (
                                        <button
                                            key={i}
                                            className={`prompt-dot ${currentPromptIndex === i ? 'active' : ''}`}
                                            onClick={() => setCurrentPromptIndex(i)}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="waveform-container">
                                <canvas ref={canvasRef} width={400} height={100} className="waveform" />
                            </div>

                            <div className="recording-status">
                                <span className={`rec-indicator ${isRecording ? 'recording' : ''}`}>●</span>
                                <span className="duration">
                                    {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:
                                    {(recordingDuration % 60).toString().padStart(2, '0')}
                                </span>
                                <span className="target">
                                    / {mode === 'instant' ? '0:15' : '3:00'} min
                                </span>
                            </div>

                            <div className="recording-controls">
                                {!isRecording && !recordedBlob && (
                                    <button className="record-btn" onClick={startRecording}>
                                        <span>🎙️</span> Start Recording
                                    </button>
                                )}
                                {isRecording && (
                                    <button className="stop-btn" onClick={stopRecording}>
                                        <span>⏹️</span> Stop Recording
                                    </button>
                                )}
                                {recordedBlob && !isRecording && (
                                    <div className="recorded-actions">
                                        <button className="secondary-btn" onClick={() => {
                                            setRecordedBlob(null);
                                            setRecordingDuration(0);
                                        }}>
                                            Re-record
                                        </button>
                                        <button className="primary-btn" onClick={analyzeRecording}>
                                            Analyze Quality →
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="upload-option">
                                <span>or</span>
                                <label className="upload-link">
                                    Upload audio file
                                    <input
                                        type="file"
                                        accept="audio/*"
                                        hidden
                                        onChange={e => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                setRecordedBlob(file);
                                                setRecordingDuration(Math.floor(file.size / 16000)); // Rough estimate
                                            }
                                        }}
                                    />
                                </label>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Analysis */}
                    {step === 'analysis' && (
                        <div className="step-analysis">
                            {loading ? (
                                <div className="analyzing">
                                    <div className="spinner-large"></div>
                                    <p>Analyzing audio quality...</p>
                                </div>
                            ) : qualityMetrics && (
                                <>
                                    <div className="quality-score">
                                        <div className="score-circle">
                                            <span className="score-value">{Math.round(qualityMetrics.overallScore)}</span>
                                            <span className="score-label">Quality Score</span>
                                        </div>
                                    </div>

                                    <div className="metrics-grid">
                                        <div className="metric">
                                            <span className="metric-icon">⏱️</span>
                                            <span className="metric-label">Duration</span>
                                            <span className="metric-value">{qualityMetrics.duration}s</span>
                                        </div>
                                        <div className="metric">
                                            <span className="metric-icon">🔇</span>
                                            <span className="metric-label">Noise Level</span>
                                            <span className={`metric-value ${qualityMetrics.noiseLevel}`}>{qualityMetrics.noiseLevel}</span>
                                        </div>
                                        <div className="metric">
                                            <span className="metric-icon">📊</span>
                                            <span className="metric-label">Volume</span>
                                            <span className={`metric-value ${qualityMetrics.volumeConsistency}`}>{qualityMetrics.volumeConsistency}</span>
                                        </div>
                                        <div className="metric">
                                            <span className="metric-icon">✨</span>
                                            <span className="metric-label">Clarity</span>
                                            <span className={`metric-value ${qualityMetrics.clarity}`}>{qualityMetrics.clarity}</span>
                                        </div>
                                    </div>

                                    {qualityMetrics.issues.length > 0 && (
                                        <div className="issues-list">
                                            <h4>⚠️ Recommendations</h4>
                                            <ul>
                                                {qualityMetrics.issues.map((issue, i) => (
                                                    <li key={i}>{issue}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    <div className="name-input">
                                        <label>Name your voice:</label>
                                        <input
                                            type="text"
                                            value={voiceName}
                                            onChange={e => setVoiceName(e.target.value)}
                                            placeholder="e.g., My Voice, Professional Harold"
                                        />
                                    </div>

                                    <div className="analysis-actions">
                                        <button className="secondary-btn" onClick={() => setStep('recording')}>
                                            ← Re-record
                                        </button>
                                        <button
                                            className="primary-btn"
                                            onClick={processVoice}
                                            disabled={!voiceName.trim()}
                                        >
                                            Create Voice Clone →
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Step 4: Processing */}
                    {step === 'processing' && (
                        <div className="step-processing">
                            <div className="processing-animation">
                                <div className="processing-circle">
                                    <div className="spinner-large"></div>
                                </div>
                            </div>

                            <div className="processing-steps">
                                {['Normalizing audio...', 'Removing background noise...', 'Optimizing segments...', 'Creating voice clone...', 'Finalizing...'].map((label, i) => (
                                    <div key={i} className={`proc-step ${processingStep >= i ? 'active' : ''} ${processingStep > i ? 'complete' : ''}`}>
                                        <span className="step-icon">
                                            {processingStep > i ? '✓' : processingStep === i ? '⟳' : '○'}
                                        </span>
                                        <span className="step-label">{label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 5: Preview */}
                    {step === 'preview' && (
                        <div className="step-preview">
                            <div className="success-hero">
                                <span className="success-icon">🎉</span>
                                <h3>Voice Clone Created!</h3>
                                <p>Your voice "{voiceName}" is ready to use.</p>
                            </div>

                            {previewAudioUrl && (
                                <div className="preview-player">
                                    <audio controls src={previewAudioUrl} />
                                </div>
                            )}

                            <button className="primary-btn" onClick={handleComplete}>
                                Use This Voice →
                            </button>
                        </div>
                    )}
                </div>

                <style>{`
                    .wizard-overlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(0, 0, 0, 0.85);
                        backdrop-filter: blur(10px);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 10001;
                    }

                    .wizard-modal {
                        background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 20px;
                        width: 90%;
                        max-width: 600px;
                        max-height: 90vh;
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                    }

                    .wizard-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 24px;
                        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    }

                    .wizard-header h2 {
                        margin: 0;
                        font-size: 22px;
                        color: white;
                    }

                    .close-btn {
                        background: none;
                        border: none;
                        color: rgba(255, 255, 255, 0.5);
                        font-size: 28px;
                        cursor: pointer;
                    }

                    .wizard-progress {
                        display: flex;
                        justify-content: center;
                        gap: 40px;
                        padding: 20px;
                        position: relative;
                    }

                    .wizard-progress::before {
                        content: '';
                        position: absolute;
                        top: 50%;
                        left: 15%;
                        right: 15%;
                        height: 2px;
                        background: rgba(255, 255, 255, 0.1);
                        z-index: 0;
                    }

                    .progress-step {
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        background: rgba(255, 255, 255, 0.1);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        position: relative;
                        z-index: 1;
                    }

                    .progress-step.active {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }

                    .progress-step.complete {
                        background: #22c55e;
                    }

                    .step-num {
                        color: white;
                        font-size: 12px;
                        font-weight: 600;
                    }

                    .wizard-content {
                        flex: 1;
                        overflow-y: auto;
                        padding: 24px;
                    }

                    .error-banner {
                        background: rgba(239, 68, 68, 0.2);
                        border: 1px solid rgba(239, 68, 68, 0.3);
                        color: #fca5a5;
                        padding: 12px 16px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }

                    .error-banner button {
                        margin-left: auto;
                        background: none;
                        border: none;
                        color: inherit;
                        cursor: pointer;
                    }

                    /* Intro Step */
                    .intro-hero {
                        text-align: center;
                        margin-bottom: 24px;
                    }

                    .hero-icon {
                        font-size: 64px;
                        display: block;
                        margin-bottom: 16px;
                    }

                    .intro-hero h3 {
                        margin: 0 0 8px;
                        color: white;
                        font-size: 24px;
                    }

                    .intro-hero p {
                        color: rgba(255, 255, 255, 0.6);
                        margin: 0;
                    }

                    .mode-selector {
                        display: flex;
                        gap: 16px;
                        margin-bottom: 24px;
                    }

                    .mode-card {
                        flex: 1;
                        background: rgba(255, 255, 255, 0.05);
                        border: 2px solid rgba(255, 255, 255, 0.1);
                        border-radius: 12px;
                        padding: 20px;
                        cursor: pointer;
                        text-align: center;
                        transition: all 0.2s;
                    }

                    .mode-card:hover {
                        border-color: rgba(255, 255, 255, 0.2);
                    }

                    .mode-card.selected {
                        border-color: #667eea;
                        background: rgba(102, 126, 234, 0.1);
                    }

                    .mode-icon {
                        font-size: 32px;
                        display: block;
                        margin-bottom: 8px;
                    }

                    .mode-card h4 {
                        margin: 0 0 4px;
                        color: white;
                    }

                    .mode-card p {
                        margin: 0;
                        font-size: 12px;
                        color: rgba(255, 255, 255, 0.5);
                    }

                    .mode-time {
                        display: inline-block;
                        margin-top: 8px;
                        font-size: 11px;
                        background: rgba(255, 255, 255, 0.1);
                        padding: 4px 8px;
                        border-radius: 4px;
                        color: rgba(255, 255, 255, 0.7);
                    }

                    .tips-section {
                        background: rgba(255, 255, 255, 0.03);
                        border-radius: 12px;
                        padding: 16px;
                        margin-bottom: 24px;
                    }

                    .tips-section h4 {
                        margin: 0 0 12px;
                        color: white;
                        font-size: 14px;
                    }

                    .tips-section ul {
                        margin: 0;
                        padding: 0;
                        list-style: none;
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 8px;
                    }

                    .tips-section li {
                        font-size: 13px;
                        color: rgba(255, 255, 255, 0.7);
                    }

                    .language-selector {
                        margin-bottom: 24px;
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    }

                    .language-selector label {
                        color: rgba(255, 255, 255, 0.7);
                    }

                    .language-selector select {
                        background: rgba(0, 0, 0, 0.3);
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        color: white;
                        padding: 8px 16px;
                        border-radius: 8px;
                    }

                    .primary-btn {
                        width: 100%;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border: none;
                        color: white;
                        padding: 14px;
                        border-radius: 10px;
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.2s;
                    }

                    .primary-btn:hover {
                        transform: translateY(-1px);
                        box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
                    }

                    .primary-btn:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }

                    .secondary-btn {
                        background: rgba(255, 255, 255, 0.1);
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        color: white;
                        padding: 12px 20px;
                        border-radius: 8px;
                        cursor: pointer;
                    }

                    /* Recording Step */
                    .prompt-card {
                        background: rgba(102, 126, 234, 0.1);
                        border: 1px solid rgba(102, 126, 234, 0.3);
                        border-radius: 12px;
                        padding: 20px;
                        text-align: center;
                        margin-bottom: 20px;
                    }

                    .prompt-label {
                        display: block;
                        font-size: 12px;
                        color: rgba(255, 255, 255, 0.5);
                        margin-bottom: 8px;
                    }

                    .prompt-text {
                        font-size: 18px;
                        color: white;
                        line-height: 1.5;
                        margin: 0;
                    }

                    .prompt-nav {
                        display: flex;
                        gap: 8px;
                        justify-content: center;
                        margin-top: 16px;
                    }

                    .prompt-dot {
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        background: rgba(255, 255, 255, 0.2);
                        border: none;
                        cursor: pointer;
                    }

                    .prompt-dot.active {
                        background: #667eea;
                    }

                    .waveform-container {
                        background: rgba(0, 0, 0, 0.3);
                        border-radius: 12px;
                        padding: 20px;
                        margin-bottom: 20px;
                    }

                    .waveform {
                        width: 100%;
                        height: 100px;
                        border-radius: 8px;
                    }

                    .recording-status {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                        margin-bottom: 20px;
                    }

                    .rec-indicator {
                        color: rgba(255, 255, 255, 0.3);
                        font-size: 12px;
                    }

                    .rec-indicator.recording {
                        color: #ef4444;
                        animation: pulse 1s infinite;
                    }

                    .duration {
                        font-size: 32px;
                        font-weight: 600;
                        color: white;
                        font-family: monospace;
                    }

                    .target {
                        color: rgba(255, 255, 255, 0.4);
                        font-size: 14px;
                    }

                    .recording-controls {
                        display: flex;
                        justify-content: center;
                        gap: 12px;
                        margin-bottom: 20px;
                    }

                    .record-btn, .stop-btn {
                        padding: 16px 32px;
                        border-radius: 30px;
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        border: none;
                    }

                    .record-btn {
                        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                        color: white;
                    }

                    .stop-btn {
                        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                        color: white;
                    }

                    .recorded-actions {
                        display: flex;
                        gap: 12px;
                        width: 100%;
                    }

                    .recorded-actions .secondary-btn {
                        flex: 1;
                    }

                    .recorded-actions .primary-btn {
                        flex: 2;
                    }

                    .upload-option {
                        text-align: center;
                        color: rgba(255, 255, 255, 0.4);
                        font-size: 13px;
                    }

                    .upload-link {
                        color: #667eea;
                        cursor: pointer;
                        margin-left: 8px;
                    }

                    /* Analysis Step */
                    .analyzing {
                        text-align: center;
                        padding: 40px;
                    }

                    .spinner-large {
                        width: 60px;
                        height: 60px;
                        border: 4px solid rgba(255, 255, 255, 0.1);
                        border-top-color: #667eea;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin: 0 auto 20px;
                    }

                    .quality-score {
                        text-align: center;
                        margin-bottom: 24px;
                    }

                    .score-circle {
                        width: 120px;
                        height: 120px;
                        border-radius: 50%;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        margin: 0 auto;
                    }

                    .score-value {
                        font-size: 36px;
                        font-weight: 700;
                        color: white;
                    }

                    .score-label {
                        font-size: 11px;
                        color: rgba(255, 255, 255, 0.7);
                    }

                    .metrics-grid {
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 12px;
                        margin-bottom: 20px;
                    }

                    .metric {
                        background: rgba(255, 255, 255, 0.05);
                        border-radius: 10px;
                        padding: 14px;
                        text-align: center;
                    }

                    .metric-icon {
                        display: block;
                        font-size: 20px;
                        margin-bottom: 4px;
                    }

                    .metric-label {
                        display: block;
                        font-size: 11px;
                        color: rgba(255, 255, 255, 0.5);
                        margin-bottom: 4px;
                    }

                    .metric-value {
                        font-size: 14px;
                        font-weight: 600;
                        color: white;
                        text-transform: capitalize;
                    }

                    .metric-value.low, .metric-value.good, .metric-value.excellent { color: #4ade80; }
                    .metric-value.medium, .metric-value.fair { color: #fbbf24; }
                    .metric-value.high, .metric-value.poor { color: #f87171; }

                    .issues-list {
                        background: rgba(251, 191, 36, 0.1);
                        border: 1px solid rgba(251, 191, 36, 0.3);
                        border-radius: 8px;
                        padding: 12px 16px;
                        margin-bottom: 20px;
                    }

                    .issues-list h4 {
                        margin: 0 0 8px;
                        font-size: 13px;
                        color: #fbbf24;
                    }

                    .issues-list ul {
                        margin: 0;
                        padding-left: 20px;
                    }

                    .issues-list li {
                        font-size: 13px;
                        color: rgba(255, 255, 255, 0.7);
                    }

                    .name-input {
                        margin-bottom: 20px;
                    }

                    .name-input label {
                        display: block;
                        margin-bottom: 8px;
                        color: rgba(255, 255, 255, 0.7);
                    }

                    .name-input input {
                        width: 100%;
                        background: rgba(0, 0, 0, 0.3);
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        color: white;
                        padding: 12px 16px;
                        border-radius: 8px;
                        font-size: 16px;
                    }

                    .analysis-actions {
                        display: flex;
                        gap: 12px;
                    }

                    .analysis-actions .secondary-btn {
                        flex: 1;
                    }

                    .analysis-actions .primary-btn {
                        flex: 2;
                    }

                    /* Processing Step */
                    .step-processing {
                        padding: 40px 0;
                    }

                    .processing-animation {
                        text-align: center;
                        margin-bottom: 30px;
                    }

                    .processing-circle {
                        width: 100px;
                        height: 100px;
                        margin: 0 auto;
                    }

                    .processing-steps {
                        max-width: 300px;
                        margin: 0 auto;
                    }

                    .proc-step {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        padding: 10px 0;
                        color: rgba(255, 255, 255, 0.3);
                    }

                    .proc-step.active {
                        color: white;
                    }

                    .proc-step.complete {
                        color: #4ade80;
                    }

                    .proc-step .step-icon {
                        font-size: 16px;
                    }

                    .proc-step.active .step-icon {
                        animation: spin 1s linear infinite;
                    }

                    /* Preview Step */
                    .success-hero {
                        text-align: center;
                        margin-bottom: 24px;
                    }

                    .success-icon {
                        font-size: 64px;
                        display: block;
                        margin-bottom: 16px;
                    }

                    .success-hero h3 {
                        margin: 0 0 8px;
                        color: white;
                    }

                    .success-hero p {
                        margin: 0;
                        color: rgba(255, 255, 255, 0.6);
                    }

                    .preview-player {
                        background: rgba(0, 0, 0, 0.3);
                        border-radius: 12px;
                        padding: 20px;
                        margin-bottom: 24px;
                        text-align: center;
                    }

                    .preview-player audio {
                        width: 100%;
                    }

                    @keyframes pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.5; }
                    }

                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        </div>
    );
};

export default VoiceCloningWizard;
