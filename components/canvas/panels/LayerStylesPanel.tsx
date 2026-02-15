// =============================================================================
// Nexus Canvas - Layer Styles Panel (Effects)
// Photoshop-style Layer Styles (FX)
// =============================================================================

import React from 'react';
import { useCanvasStore, useSelectedLayer } from '../store/useCanvasStore';
import { LayerEffects } from '../../../types/canvas';

interface SliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (val: number) => void;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, onChange }) => (
    <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">{label}</span>
            <span className="text-white font-mono">{Math.round(value)}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400"
        />
    </div>
);

export const LayerStylesPanel: React.FC = () => {
    const selectedLayer = useSelectedLayer();
    const { updateLayer } = useCanvasStore();

    if (!selectedLayer) {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xs p-4 text-center">
                Select a layer to apply effects (Styles)
            </div>
        );
    }

    const effects = selectedLayer.effects || {};
    const dropShadow = effects.dropShadow || {
        enabled: false,
        blur: 5,
        x: 5,
        y: 5,
        opacity: 0.5,
        color: '#000000'
    };

    const updateDropShadow = (updates: Partial<typeof dropShadow>) => {
        const newShadow = { ...dropShadow, ...updates };
        // If enabling, ensure default props are set
        if (updates.enabled && !effects.dropShadow) {
            newShadow.blur = 5;
            newShadow.x = 5;
            newShadow.y = 5;
            newShadow.opacity = 0.5;
            newShadow.color = '#000000';
        }

        updateLayer(selectedLayer.id, {
            effects: {
                ...effects,
                dropShadow: newShadow
            }
        });
    };

    return (
        <div className="flex-1 overflow-y-auto p-4">
            <h3 className="text-sm font-medium text-white mb-4">Layer Styles (FX)</h3>

            {/* Drop Shadow Section */}
            <div className="mb-6 border border-slate-700 rounded-lg p-3 bg-slate-800/30">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={dropShadow.enabled}
                            onChange={(e) => updateDropShadow({ enabled: e.target.checked })}
                            className="rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-offset-slate-900 focus:ring-cyan-500"
                            id="chk-shadow"
                        />
                        <label htmlFor="chk-shadow" className="text-sm font-medium text-slate-200 cursor-pointer">
                            Drop Shadow
                        </label>
                    </div>
                </div>

                {dropShadow.enabled && (
                    <div className="pl-6 space-y-3">
                        <Slider
                            label="Opacity (0-1)"
                            value={dropShadow.opacity}
                            min={0}
                            max={1}
                            step={0.05}
                            onChange={(v) => updateDropShadow({ opacity: v })}
                        />
                        <Slider
                            label="Distance X"
                            value={dropShadow.x}
                            min={-50}
                            max={50}
                            step={1}
                            onChange={(v) => updateDropShadow({ x: v })}
                        />
                        <Slider
                            label="Distance Y"
                            value={dropShadow.y}
                            min={-50}
                            max={50}
                            step={1}
                            onChange={(v) => updateDropShadow({ y: v })}
                        />
                        <Slider
                            label="Blur Size"
                            value={dropShadow.blur}
                            min={0}
                            max={50}
                            step={1}
                            onChange={(v) => updateDropShadow({ blur: v })}
                        />

                        <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-slate-400">Color</span>
                            <input
                                type="color"
                                value={dropShadow.color}
                                onChange={(e) => updateDropShadow({ color: e.target.value })}
                                className="w-8 h-8 rounded cursor-pointer bg-transparent border-none"
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="p-3 bg-slate-800/50 rounded-lg text-xs text-slate-500 border border-slate-700/50">
                <p>✨ <strong>Styles</strong> add effects like shadows and strokes. Combine them with Adjustments for professional finishes.</p>
            </div>
        </div>
    );
};
