// =============================================================================
// Nexus Canvas - Adjustments Panel
// Non-destructive layer color corrections (Photoshop-style)
// =============================================================================

import React from 'react';
import { useCanvasStore, useSelectedLayer } from '../store/useCanvasStore';
import { LayerAdjustments } from '../../../types/canvas';

const DEFAULT_ADJUSTMENTS: LayerAdjustments = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0
};

interface SliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (val: number) => void;
    formatValue?: (val: number) => string;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, onChange, formatValue }) => (
    <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">{label}</span>
            <span className="text-white font-mono">{formatValue ? formatValue(value) : value}</span>
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

export const AdjustmentsPanel: React.FC = () => {
    const selectedLayer = useSelectedLayer();
    const { updateLayer } = useCanvasStore();

    if (!selectedLayer) {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xs p-4 text-center">
                Select a layer to apply adjustments
            </div>
        );
    }

    const adjustments = selectedLayer.adjustments || DEFAULT_ADJUSTMENTS;

    const handleChange = (key: keyof LayerAdjustments, value: number) => {
        const newAdjustments = { ...adjustments, [key]: value };
        updateLayer(selectedLayer.id, { adjustments: newAdjustments });
    };

    const handleReset = () => {
        updateLayer(selectedLayer.id, { adjustments: DEFAULT_ADJUSTMENTS });
    };

    return (
        <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-white">Adjustments</h3>
                <button
                    onClick={handleReset}
                    className="text-xs text-slate-400 hover:text-white underline"
                >
                    Reset
                </button>
            </div>

            <Slider
                label="Brightness"
                value={adjustments.brightness}
                min={-1}
                max={1}
                step={0.05}
                onChange={(v) => handleChange('brightness', v)}
                formatValue={(v) => Math.round(v * 100) + '%'}
            />

            <Slider
                label="Contrast"
                value={adjustments.contrast}
                min={-1}
                max={1}
                step={0.05}
                onChange={(v) => handleChange('contrast', v)}
                formatValue={(v) => Math.round(v * 100) + '%'}
            />

            <Slider
                label="Saturation"
                value={adjustments.saturation}
                min={-1}
                max={1}
                step={0.05}
                onChange={(v) => handleChange('saturation', v)}
                formatValue={(v) => Math.round(v * 100) + '%'}
            />

            <Slider
                label="Hue"
                value={adjustments.hue}
                min={-180}
                max={180}
                step={1}
                onChange={(v) => handleChange('hue', v)}
                formatValue={(v) => v + '°'}
            />

            <div className="mt-4 p-3 bg-slate-800/50 rounded-lg text-xs text-slate-500 border border-slate-700/50">
                <p>💡 These adjustments are <strong>non-destructive</strong>. You can change them later without losing quality.</p>
            </div>
        </div>
    );
};
