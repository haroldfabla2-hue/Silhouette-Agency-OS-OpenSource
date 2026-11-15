// =============================================================================
// Nexus Canvas - AI Tools Panel
// Photoshop-competitive AI-powered editing tools
// =============================================================================

import React, { useState } from 'react';
import { useCanvasStore, useSelectedLayer, useIsGenerating } from '../store/useCanvasStore';
import { visualAnalysis } from '../../../services/visualAnalysisService';

interface AIToolsPanelProps {
    /** Get current canvas as base64 */
    getCanvasImage: () => Promise<string>;
    /** Apply a generated mask to current selection */
    applyMask: (maskBase64: string, boundingBox?: { x: number; y: number; width: number; height: number }) => void;
    /** Apply a generated mask as a Layer Mask */
    addLayerMask: (maskBase64: string) => void;
}

interface AIButtonProps {
    onClick: () => void;
    disabled: boolean;
    active: boolean;
    icon: string;
    label: string;
    description: string;
}

const AIButton: React.FC<AIButtonProps> = ({ onClick, disabled, active, icon, label, description }) => (
    <div className="relative group w-full">
        <button
            onClick={onClick}
            disabled={disabled}
            className={`w-full p-2 rounded-lg text-xs font-medium flex flex-col items-center gap-1 transition-all ${active
                ? 'bg-cyan-600 text-white'
                : disabled
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
                }`}
        >
            <span className="text-lg">{icon}</span>
            <span>{label}</span>
        </button>

        {/* Rich Tooltip (Left Side) */}
        {!disabled && (
            <div className="absolute right-full top-1/2 -translate-y-1/2 mr-3 z-50 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
                <div className="font-bold text-white text-sm mb-1">{label}</div>
                <p className="text-xs text-slate-400 leading-tight">
                    {description}
                </p>
                {/* Arrow */}
                <div className="absolute left-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-t-transparent border-l-[6px] border-l-slate-900 border-b-[6px] border-b-transparent" />
            </div>
        )}
    </div>
);

export const AIToolsPanel: React.FC<AIToolsPanelProps> = ({
    getCanvasImage,
    applyMask,
    addLayerMask
}) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeOperation, setActiveOperation] = useState<string | null>(null);
    const [result, setResult] = useState<{ type: string; data: any } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const selectedLayer = useSelectedLayer();
    const isGenerating = useIsGenerating();

    const handleSelectSubject = async () => {
        setIsProcessing(true);
        setActiveOperation('select-subject');
        setError(null);

        try {
            const image = await getCanvasImage();
            const maskResult = await visualAnalysis.selectSubject(image);

            if (maskResult) {
                applyMask(maskResult.maskBase64, maskResult.boundingBox);
                setResult({
                    type: 'subject',
                    data: {
                        label: maskResult.boundingBox.label,
                        confidence: maskResult.confidence
                    }
                });
            } else {
                setError('Could not detect subject');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsProcessing(false);
            setActiveOperation(null);
        }
    };

    const handleRemoveBackground = async () => {
        setIsProcessing(true);
        setActiveOperation('remove-bg');
        setError(null);

        try {
            const image = await getCanvasImage();
            const maskResult = await visualAnalysis.removeBackground(image);

            if (maskResult) {
                // Non-destructive: Add as Layer Mask instead of selection
                addLayerMask(maskResult.maskBase64);

                setResult({
                    type: 'background',
                    data: {
                        label: maskResult.boundingBox.label,
                        confidence: maskResult.confidence
                    }
                });
            } else {
                setError('Could not detect background');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsProcessing(false);
            setActiveOperation(null);
        }
    };

    const handleAnalyzeComposition = async () => {
        setIsProcessing(true);
        setActiveOperation('analyze');
        setError(null);

        try {
            const image = await getCanvasImage();
            const analysis = await visualAnalysis.analyzeComposition(image);

            if (analysis) {
                setResult({
                    type: 'composition',
                    data: analysis
                });
            } else {
                setError('Analysis failed');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsProcessing(false);
            setActiveOperation(null);
        }
    };

    const disabled = isProcessing || isGenerating;

    return (
        <div className="p-3 bg-slate-800/90 backdrop-blur-sm border-t border-slate-700">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🧠</span>
                <span className="text-sm font-medium text-white">AI Tools</span>
                <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
                    Pro
                </span>
            </div>

            {/* AI Action Buttons */}
            <div className="grid grid-cols-2 gap-2 mb-3">
                <AIButton
                    onClick={handleSelectSubject}
                    disabled={disabled}
                    active={activeOperation === 'select-subject'}
                    icon="🎯"
                    label="Select Subject"
                    description="Automatically finds and selects the main subject."
                />

                <AIButton
                    onClick={handleRemoveBackground}
                    disabled={disabled}
                    active={activeOperation === 'remove-bg'}
                    icon="🪄"
                    label="Remove BG"
                    description="Instantly removes the background."
                />

                <div className="col-span-2">
                    <AIButton
                        onClick={handleAnalyzeComposition}
                        disabled={disabled}
                        active={activeOperation === 'analyze'}
                        icon="🎨"
                        label="Analyze Composition"
                        description="Get insights on color, mood, and style."
                    />
                </div>
            </div>

            {/* Processing indicator */}
            {isProcessing && (
                <div className="flex items-center justify-center gap-2 py-2 text-cyan-400 text-xs">
                    <span className="animate-spin w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full" />
                    Processing with AI...
                </div>
            )}

            {/* Error message */}
            {error && (
                <div className="px-2 py-1.5 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-xs mb-2">
                    {error}
                </div>
            )}

            {/* Result display */}
            {result && !isProcessing && (
                <div className="p-2 bg-slate-900/50 rounded-lg text-xs">
                    {result.type === 'subject' && (
                        <div className="text-green-400">
                            ✅ Subject detected: <strong>{result.data.label}</strong>
                            <span className="ml-2 text-slate-400">
                                ({Math.round(result.data.confidence * 100)}% confidence)
                            </span>
                        </div>
                    )}

                    {result.type === 'background' && (
                        <div className="text-green-400">
                            ✅ Foreground isolated: <strong>{result.data.label}</strong>
                            <span className="ml-2 text-slate-400">
                                ({Math.round(result.data.confidence * 100)}% confidence)
                            </span>
                        </div>
                    )}

                    {result.type === 'composition' && (
                        <div className="space-y-2">
                            <div>
                                <span className="text-slate-400">Style:</span>{' '}
                                <span className="text-white">{result.data.style}</span>
                            </div>
                            <div>
                                <span className="text-slate-400">Mood:</span>{' '}
                                <span className="text-white">{result.data.mood}</span>
                            </div>
                            <div className="flex gap-1">
                                {result.data.dominantColors?.map((color: string, i: number) => (
                                    <div
                                        key={i}
                                        className="w-6 h-6 rounded border border-slate-600"
                                        style={{ backgroundColor: color }}
                                        title={color}
                                    />
                                ))}
                            </div>
                            {result.data.suggestedPrompts?.length > 0 && (
                                <div>
                                    <span className="text-slate-400">Suggested prompts:</span>
                                    <ul className="mt-1 text-slate-300 list-disc list-inside">
                                        {result.data.suggestedPrompts.slice(0, 2).map((p: string, i: number) => (
                                            <li key={i} className="truncate">{p}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Tips */}
            <div className="mt-3 text-xs text-slate-500">
                <p>💡 AI-powered tools analyze your image using computer vision.</p>
            </div>
        </div>
    );
};
