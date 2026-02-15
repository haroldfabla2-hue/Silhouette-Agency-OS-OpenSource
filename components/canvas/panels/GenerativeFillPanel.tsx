// =============================================================================
// Nexus Canvas - Generative Fill Panel
// AI-powered inpainting interface
// =============================================================================

import React, { useState } from 'react';
import { useCanvasStore, useSelectedLayer, useIsGenerating } from '../store/useCanvasStore';
import { inpaint } from '../api';

interface GenerativeFillPanelProps {
    /** Get current canvas as base64 */
    getCanvasImage: () => Promise<string>;
    /** Get current selection mask as base64 */
    getSelectionMask: () => string | null;
}

export const GenerativeFillPanel: React.FC<GenerativeFillPanelProps> = ({
    getCanvasImage,
    getSelectionMask
}) => {
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('blurry, low quality, artifacts');
    const [preferLocal, setPreferLocal] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isGenerating = useIsGenerating();
    const { startGeneration, updateGenerationProgress, completeGeneration, cancelGeneration } = useCanvasStore();

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            setError('Please enter a prompt');
            return;
        }

        const mask = getSelectionMask();
        if (!mask) {
            setError('Please make a selection first');
            return;
        }

        setError(null);
        startGeneration();

        try {
            updateGenerationProgress(10);
            const image = await getCanvasImage();

            updateGenerationProgress(30);
            const result = await inpaint(image, mask, prompt, {
                negativePrompt: negativePrompt || undefined,
                preferLocal
            });

            updateGenerationProgress(90);
            completeGeneration(result.imageBase64);

            // Clear prompt after success
            setPrompt('');

        } catch (e: any) {
            setError(e.message || 'Generation failed');
            cancelGeneration();
        }
    };

    return (
        <div className="p-3 bg-slate-800/90 backdrop-blur-sm border-t border-slate-700">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">✨</span>
                <span className="text-sm font-medium text-white">Generative Fill</span>
                {preferLocal && (
                    <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
                        Local
                    </span>
                )}
            </div>

            {/* Prompt input */}
            <div className="mb-3">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what to generate in the selection..."
                    className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
                    rows={2}
                    disabled={isGenerating}
                />
            </div>

            {/* Negative prompt (collapsible) */}
            <details className="mb-3">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">
                    Advanced options
                </summary>
                <div className="mt-2 space-y-2">
                    <input
                        type="text"
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        placeholder="Negative prompt..."
                        className="w-full px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-500"
                        disabled={isGenerating}
                    />
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                        <input
                            type="checkbox"
                            checked={preferLocal}
                            onChange={(e) => setPreferLocal(e.target.checked)}
                            className="rounded bg-slate-700 border-slate-600"
                            disabled={isGenerating}
                        />
                        Prefer local generation (ComfyUI)
                    </label>
                </div>
            </details>

            {/* Error message */}
            {error && (
                <div className="mb-3 px-2 py-1.5 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-xs">
                    {error}
                </div>
            )}

            {/* Generate button */}
            <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className={`w-full py-2 rounded-lg font-medium text-sm transition-all ${isGenerating
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white shadow-lg shadow-purple-500/20'
                    }`}
            >
                {isGenerating ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                        Generating...
                    </span>
                ) : (
                    '🎨 Generate'
                )}
            </button>

            {/* Tips */}
            <div className="mt-3 text-xs text-slate-500">
                <p>💡 <strong>Tip:</strong> Make a selection first, then describe what you want to appear in that area.</p>
            </div>
        </div>
    );
};
