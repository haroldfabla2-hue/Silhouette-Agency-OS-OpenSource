import React, { useState, ReactNode, lazy, Suspense } from 'react';
import { ChevronDown, ChevronUp, Settings, Wand2, Zap, Cpu, Palette, Video, Image, Move, Frame, Camera, Mic, Library } from 'lucide-react';

// Lazy load advanced panels for better performance
const AssetLibraryBrowser = lazy(() => import('./AssetLibraryBrowser'));
const VoiceLipSyncPanel = lazy(() => import('./VoiceLipSyncPanel'));
const MotionBrushEditor = lazy(() => import('./MotionBrushEditor'));

// ==================== TYPES ====================

export interface MediaGenerationParams {
    // Common
    prompt: string;
    negativePrompt?: string;
    seed?: number;

    // Image/Video Dimensions
    resolution?: '512x512' | '768x768' | '1024x1024' | '2048x2048' | '4K';
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:2' | '21:9';

    // Generation Quality
    guidanceScale?: number;
    inferenceSteps?: number;
    strength?: number; // For img2img

    // Video Specific
    duration?: number;
    fps?: 12 | 24 | 30 | 60;
    motionStrength?: number;
    loop?: boolean;

    // === KLING-INSPIRED: KEYFRAMES ===
    keyframeStart?: string;  // Image URL for start frame
    keyframeEnd?: string;    // Image URL for end frame

    // === KLING-INSPIRED: CAMERA CONTROL ===
    camera?: {
        movement: 'static' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down'
        | 'zoom_in' | 'zoom_out' | 'orbit' | 'dolly_in' | 'dolly_out' | 'crane_up' | 'crane_down';
        speed: 'slow' | 'medium' | 'fast';
    };

    // === KLING-INSPIRED: ASSET REFERENCES ===
    assetRefs?: {
        id: string;
        role: 'subject' | 'background' | 'prop';
    }[];

    // Engine/Model
    engine?: 'WAN' | 'SVD' | 'ANIMATEDIFF' | 'VID2VID' | 'KLING' | 'VEO' | 'SDXL' | 'FLUX' | 'NANOBANANA';
    provider?: 'REPLICATE' | 'COMFYUI' | 'GEMINI' | 'KLING';

    // Style
    stylePreset?: 'photorealistic' | 'cinematic' | 'anime' | 'illustration' | 'none';
    styleReference?: string; // Image URL for style transfer

    // === COST OPTIMIZATION ===
    preferLocal?: boolean;      // Use free local generation (DreamShaper) first
    saveToLibrary?: boolean;    // Auto-register generated images as assets
}

export interface ControlPanelProps {
    params: MediaGenerationParams;
    onChange: (updates: Partial<MediaGenerationParams>) => void;
    mode: 'image' | 'video' | 'audio';
    isGenerating?: boolean;
    vramStatus?: { currentOwner: string; isVideoActive: boolean; queueLength: number };
    hasInputImage?: boolean; // Prop-driven state
    hasInputVideo?: boolean;
}

// ==================== SECTION COMPONENT ====================

interface SectionProps {
    title: string;
    icon: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, icon, defaultOpen = true, children }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border border-slate-700/50 rounded-lg overflow-hidden mb-3">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-4 py-3 flex items-center justify-between bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
            >
                <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    {icon}
                    {title}
                </div>
                {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {isOpen && (
                <div className="p-4 bg-slate-900/50 space-y-4 animate-in slide-in-from-top-2 duration-200">
                    {children}
                </div>
            )}
        </div>
    );
};

// ==================== SLIDER COMPONENT ====================

interface SliderControlProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    tooltip?: string;
}

const SliderControl: React.FC<SliderControlProps> = ({ label, value, min, max, step = 1, onChange, tooltip }) => (
    <div className="space-y-2">
        <div className="flex justify-between items-center">
            <label className="text-xs text-slate-400" title={tooltip}>{label}</label>
            <span className="text-xs font-mono text-cyan-400 bg-slate-800 px-2 py-0.5 rounded">{value}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer
                bg-slate-700 
                [&::-webkit-slider-thumb]:appearance-none 
                [&::-webkit-slider-thumb]:w-4 
                [&::-webkit-slider-thumb]:h-4 
                [&::-webkit-slider-thumb]:rounded-full 
                [&::-webkit-slider-thumb]:bg-cyan-500
                [&::-webkit-slider-thumb]:hover:bg-cyan-400
                [&::-webkit-slider-thumb]:transition-colors"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
            <span>{min}</span>
            <span>{max}</span>
        </div>
    </div>
);

// ==================== SELECT COMPONENT ====================

interface SelectControlProps {
    label: string;
    value: string;
    options: { value: string; label: string; description?: string }[];
    onChange: (value: string) => void;
}

const SelectControl: React.FC<SelectControlProps> = ({ label, value, options, onChange }) => (
    <div className="space-y-2">
        <label className="text-xs text-slate-400">{label}</label>
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-200
                focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500
                text-sm appearance-none cursor-pointer"
        >
            {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
    </div>
);

// ==================== ENGINE SELECTOR ====================

interface EngineSelectorProps {
    value: string;
    onChange: (engine: string) => void;
    hasInputImage: boolean;
    hasInputVideo: boolean;
}

const EngineSelector: React.FC<EngineSelectorProps> = ({ value, onChange, hasInputImage, hasInputVideo }) => {
    const engines = [
        { id: 'NANOBANANA', name: 'NanoBanana Pro', desc: 'Text → Image (50+ styles)', icon: '🍌', recommended: !hasInputImage && !hasInputVideo, premium: false },
        { id: 'WAN', name: 'WAN 2.1', desc: 'Text → Video (Local)', icon: '🌊', recommended: false, premium: false },
        { id: 'SVD', name: 'SVD XT', desc: 'Image → Video (Cinematic)', icon: '🎬', recommended: hasInputImage && !hasInputVideo, premium: false },
        { id: 'ANIMATEDIFF', name: 'AnimateDiff', desc: 'Image → Video (Fast)', icon: '⚡', recommended: false, premium: false },
        { id: 'VID2VID', name: 'Vid2Vid', desc: 'Video → Video', icon: '🔄', recommended: hasInputVideo, premium: false },
        { id: 'VEO', name: 'Veo 3.1', desc: '4K + Audio (Cloud)', icon: '✨', recommended: false, premium: true },
    ];

    return (
        <div className="space-y-2">
            <label className="text-xs text-slate-400">Animation Engine</label>
            <div className="grid grid-cols-2 gap-2">
                {engines.map(eng => (
                    <button
                        key={eng.id}
                        onClick={() => onChange(eng.id)}
                        className={`p-3 rounded-lg border text-left transition-all relative
                            ${value === eng.id
                                ? 'border-cyan-500 bg-cyan-500/10 text-white'
                                : eng.premium
                                    ? 'border-amber-600/50 bg-amber-500/5 text-slate-300 hover:border-amber-500'
                                    : 'border-slate-600 bg-slate-800/50 text-slate-300 hover:border-slate-500'}`}
                    >
                        {eng.recommended && (
                            <span className="absolute -top-2 -right-2 text-[10px] bg-green-500 text-white px-1.5 py-0.5 rounded-full font-medium">
                                AI ✓
                            </span>
                        )}
                        {eng.premium && !eng.recommended && (
                            <span className="absolute -top-2 -right-2 text-[10px] bg-gradient-to-r from-amber-500 to-orange-500 text-white px-1.5 py-0.5 rounded-full font-medium">
                                PRO
                            </span>
                        )}
                        <div className="flex items-center gap-2">
                            <span className="text-lg">{eng.icon}</span>
                            <div>
                                <div className="text-sm font-medium">{eng.name}</div>
                                <div className="text-[10px] text-slate-400">{eng.desc}</div>
                            </div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};

// ==================== ASPECT RATIO SELECTOR ====================

interface AspectRatioSelectorProps {
    value: string;
    onChange: (ratio: string) => void;
}

const AspectRatioSelector: React.FC<AspectRatioSelectorProps> = ({ value, onChange }) => {
    const ratios = [
        { id: '1:1', label: '1:1', icon: '◻️', desc: 'Square' },
        { id: '16:9', label: '16:9', icon: '▭', desc: 'Landscape' },
        { id: '9:16', label: '9:16', icon: '▯', desc: 'Portrait' },
        { id: '4:3', label: '4:3', icon: '▭', desc: 'Classic' },
    ];

    return (
        <div className="space-y-2">
            <label className="text-xs text-slate-400">Aspect Ratio</label>
            <div className="flex gap-2">
                {ratios.map(r => (
                    <button
                        key={r.id}
                        onClick={() => onChange(r.id)}
                        title={r.desc}
                        className={`flex-1 py-2 px-3 rounded-lg border text-center transition-all
                            ${value === r.id
                                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                                : 'border-slate-600 bg-slate-800/50 text-slate-400 hover:border-slate-500'}`}
                    >
                        <div className="text-lg">{r.icon}</div>
                        <div className="text-[10px]">{r.label}</div>
                    </button>
                ))}
            </div>
        </div>
    );
};

// ==================== CAMERA CONTROL SELECTOR (KLING-INSPIRED) ====================

interface CameraControlProps {
    movement: string;
    speed: string;
    onMovementChange: (movement: string) => void;
    onSpeedChange: (speed: string) => void;
}

const CameraControlSelector: React.FC<CameraControlProps> = ({ movement, speed, onMovementChange, onSpeedChange }) => {
    const movements = [
        { id: 'static', label: 'Static', icon: '🎯' },
        { id: 'pan_left', label: 'Pan ←', icon: '◀️' },
        { id: 'pan_right', label: 'Pan →', icon: '▶️' },
        { id: 'tilt_up', label: 'Tilt ↑', icon: '🔼' },
        { id: 'tilt_down', label: 'Tilt ↓', icon: '🔽' },
        { id: 'zoom_in', label: 'Zoom In', icon: '🔍' },
        { id: 'zoom_out', label: 'Zoom Out', icon: '🔎' },
        { id: 'orbit', label: 'Orbit', icon: '🔄' },
        { id: 'dolly_in', label: 'Dolly In', icon: '🎬' },
        { id: 'dolly_out', label: 'Dolly Out', icon: '📹' },
        { id: 'crane_up', label: 'Crane ↑', icon: '🏗️' },
        { id: 'crane_down', label: 'Crane ↓', icon: '⬇️' },
    ];

    const speeds = [
        { id: 'slow', label: 'Slow', desc: 'Cinematic' },
        { id: 'medium', label: 'Medium', desc: 'Natural' },
        { id: 'fast', label: 'Fast', desc: 'Dynamic' },
    ];

    return (
        <div className="space-y-4">
            {/* Movement Grid */}
            <div className="space-y-2">
                <label className="text-xs text-slate-400">Camera Movement</label>
                <div className="grid grid-cols-4 gap-1.5">
                    {movements.map(m => (
                        <button
                            key={m.id}
                            onClick={() => onMovementChange(m.id)}
                            title={m.label}
                            className={`p-2 rounded-lg border text-center transition-all
                                ${movement === m.id
                                    ? 'border-cyan-500 bg-cyan-500/10 text-white'
                                    : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'}`}
                        >
                            <div className="text-sm">{m.icon}</div>
                            <div className="text-[8px] mt-0.5 truncate">{m.label}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Speed */}
            <div className="space-y-2">
                <label className="text-xs text-slate-400">Speed</label>
                <div className="flex gap-2">
                    {speeds.map(s => (
                        <button
                            key={s.id}
                            onClick={() => onSpeedChange(s.id)}
                            className={`flex-1 py-2 rounded-lg border text-center transition-all
                                ${speed === s.id
                                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                                    : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'}`}
                        >
                            <div className="text-xs font-medium">{s.label}</div>
                            <div className="text-[9px] text-slate-500">{s.desc}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ==================== KEYFRAME INPUTS (KLING-INSPIRED) ====================

interface KeyframeInputsProps {
    startFrame?: string;
    endFrame?: string;
    onStartChange: (url: string) => void;
    onEndChange: (url: string) => void;
}

const KeyframeInputs: React.FC<KeyframeInputsProps> = ({ startFrame, endFrame, onStartChange, onEndChange }) => {
    return (
        <div className="space-y-3">
            <p className="text-[10px] text-slate-500 italic">
                💡 Define start & end frames for precise motion control. AI fills the gap.
            </p>

            {/* Start Frame */}
            <div className="space-y-1.5">
                <label className="text-xs text-slate-400 flex items-center gap-1">
                    <span className="w-5 h-5 bg-green-500/20 text-green-400 rounded text-[9px] flex items-center justify-center">A</span>
                    Start Frame
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Image URL or upload..."
                        value={startFrame || ''}
                        onChange={(e) => onStartChange(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-200
                            focus:outline-none focus:border-green-500 text-xs placeholder:text-slate-500"
                    />
                    {startFrame && (
                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-green-500/50">
                            <img src={startFrame} alt="Start" className="w-full h-full object-cover" />
                        </div>
                    )}
                </div>
            </div>

            {/* End Frame */}
            <div className="space-y-1.5">
                <label className="text-xs text-slate-400 flex items-center gap-1">
                    <span className="w-5 h-5 bg-red-500/20 text-red-400 rounded text-[9px] flex items-center justify-center">B</span>
                    End Frame
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Image URL or upload..."
                        value={endFrame || ''}
                        onChange={(e) => onEndChange(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-200
                            focus:outline-none focus:border-red-500 text-xs placeholder:text-slate-500"
                    />
                    {endFrame && (
                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-red-500/50">
                            <img src={endFrame} alt="End" className="w-full h-full object-cover" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ==================== STYLE PRESETS (EXPANDED - 50+ STYLES) ====================

import { IMAGE_STYLE_CATEGORIES, ImageStyleCategory } from '../../types/imageStyles';

interface StylePresetsProps {
    value: string;
    onChange: (style: string) => void;
}

const StylePresets: React.FC<StylePresetsProps> = ({ value, onChange }) => {
    const [activeCategory, setActiveCategory] = useState<ImageStyleCategory>('artistic');

    const categories = Object.entries(IMAGE_STYLE_CATEGORIES) as [ImageStyleCategory, typeof IMAGE_STYLE_CATEGORIES[ImageStyleCategory]][];
    const currentCategory = IMAGE_STYLE_CATEGORIES[activeCategory];

    return (
        <div className="space-y-3">
            {/* Category Tabs */}
            <div className="space-y-2">
                <label className="text-xs text-slate-400">Style Category</label>
                <div className="flex gap-1 flex-wrap">
                    {categories.map(([key, cat]) => (
                        <button
                            key={key}
                            onClick={() => setActiveCategory(key)}
                            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all flex items-center gap-1
                                ${activeCategory === key
                                    ? `bg-gradient-to-r ${cat.color} text-white shadow-lg`
                                    : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'}`}
                        >
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Style Grid */}
            <div className="space-y-2">
                <label className="text-xs text-slate-400 flex items-center gap-2">
                    <span className="text-lg">{currentCategory.icon}</span>
                    {currentCategory.label} Styles
                    {value && value !== 'none' && (
                        <span className="ml-auto text-cyan-400 text-[10px] bg-cyan-500/10 px-2 py-0.5 rounded">
                            Selected: {value}
                        </span>
                    )}
                </label>
                <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                    {/* None option */}
                    <button
                        onClick={() => onChange('none')}
                        className={`p-2 rounded-lg border text-left transition-all
                            ${value === 'none' || !value
                                ? 'border-cyan-500 bg-cyan-500/10 text-white'
                                : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'}`}
                    >
                        <div className="text-[10px] font-medium truncate">None</div>
                        <div className="text-[8px] text-slate-500 truncate">Default</div>
                    </button>

                    {currentCategory.styles.map(style => (
                        <button
                            key={style.id}
                            onClick={() => onChange(style.id)}
                            title={style.desc}
                            className={`p-2 rounded-lg border text-left transition-all
                                ${value === style.id
                                    ? 'border-cyan-500 bg-cyan-500/10 text-white'
                                    : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-200'}`}
                        >
                            <div className="text-[10px] font-medium truncate">{style.label}</div>
                            <div className="text-[8px] text-slate-500 truncate">{style.desc}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ==================== VRAM STATUS BAR ====================

interface VramStatusBarProps {
    status?: { currentOwner: string; isVideoActive: boolean; queueLength: number };
}

const VramStatusBar: React.FC<VramStatusBarProps> = ({ status }) => {
    if (!status) return null;

    return (
        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-t border-slate-700 text-xs">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                    <Cpu size={12} className={status.isVideoActive ? 'text-green-400' : 'text-slate-400'} />
                    <span className={status.isVideoActive ? 'text-green-400' : 'text-slate-400'}>
                        {status.isVideoActive ? 'GPU Reserved' : status.currentOwner || 'Idle'}
                    </span>
                </div>
                {status.queueLength > 0 && (
                    <div className="text-amber-400">
                        Queue: {status.queueLength} job{status.queueLength > 1 ? 's' : ''}
                    </div>
                )}
            </div>
        </div>
    );
};

// ==================== MAIN CONTROL PANEL ====================

export const MediaControlPanel: React.FC<ControlPanelProps> = ({
    params,
    onChange,
    mode,
    isGenerating,
    vramStatus,
    hasInputImage = false,
    hasInputVideo = false
}) => {
    // State removed in favor of props

    return (
        <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700">
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                <h3 className="font-semibold text-white flex items-center gap-2">
                    <Settings size={16} className="text-cyan-400" />
                    Control Panel
                </h3>
                <button className="text-xs text-slate-400 hover:text-cyan-400 flex items-center gap-1">
                    <Wand2 size={12} /> AI Recommend
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1">

                {/* Engine Section (Video only) */}
                {mode === 'video' && (
                    <Section title="Animation Engine" icon={<Zap size={14} />} defaultOpen={true}>
                        <EngineSelector
                            value={params.engine || 'WAN'}
                            onChange={(v) => onChange({ engine: v as any })}
                            hasInputImage={hasInputImage}
                            hasInputVideo={hasInputVideo}
                        />
                    </Section>
                )}

                {/* Camera Control Section (Video only) - KLING-INSPIRED */}
                {mode === 'video' && (
                    <Section title="Camera Control" icon={<Camera size={14} />} defaultOpen={false}>
                        <CameraControlSelector
                            movement={params.camera?.movement || 'static'}
                            speed={params.camera?.speed || 'medium'}
                            onMovementChange={(m) => onChange({ camera: { ...params.camera, movement: m as any, speed: params.camera?.speed || 'medium' } })}
                            onSpeedChange={(s) => onChange({ camera: { ...params.camera, movement: params.camera?.movement || 'static', speed: s as any } })}
                        />
                    </Section>
                )}

                {/* Keyframes Section (Video only) - KLING-INSPIRED */}
                {mode === 'video' && (
                    <Section title="Keyframes (A→B)" icon={<Frame size={14} />} defaultOpen={false}>
                        <KeyframeInputs
                            startFrame={params.keyframeStart}
                            endFrame={params.keyframeEnd}
                            onStartChange={(url) => onChange({ keyframeStart: url || undefined })}
                            onEndChange={(url) => onChange({ keyframeEnd: url || undefined })}
                        />
                    </Section>
                )}

                {/* Dimensions Section */}
                <Section title="Dimensions" icon={<Settings size={14} />} defaultOpen={true}>
                    <AspectRatioSelector
                        value={params.aspectRatio || '16:9'}
                        onChange={(v) => onChange({ aspectRatio: v as any })}
                    />

                    <SelectControl
                        label="Resolution"
                        value={params.resolution || '1024x1024'}
                        options={[
                            { value: '512x512', label: '512 × 512' },
                            { value: '768x768', label: '768 × 768' },
                            { value: '1024x1024', label: '1024 × 1024' },
                            { value: '2048x2048', label: '2048 × 2048' },
                            { value: '4K', label: '4K (Upscale)' },
                        ]}
                        onChange={(v) => onChange({ resolution: v as any })}
                    />

                    {mode === 'video' && (
                        <>
                            <SliderControl
                                label="Duration (seconds)"
                                value={params.duration || 5}
                                min={2}
                                max={30}
                                onChange={(v) => onChange({ duration: v })}
                            />
                            <SelectControl
                                label="Frame Rate"
                                value={String(params.fps || 24)}
                                options={[
                                    { value: '12', label: '12 FPS (Stylized)' },
                                    { value: '24', label: '24 FPS (Cinematic)' },
                                    { value: '30', label: '30 FPS (Smooth)' },
                                    { value: '60', label: '60 FPS (Ultra Smooth)' },
                                ]}
                                onChange={(v) => onChange({ fps: parseInt(v) as any })}
                            />
                        </>
                    )}
                </Section>

                {/* Advanced Section */}
                <Section title="Advanced" icon={<Settings size={14} />} defaultOpen={false}>
                    <SliderControl
                        label="Guidance Scale"
                        value={params.guidanceScale || 7.5}
                        min={1}
                        max={20}
                        step={0.5}
                        onChange={(v) => onChange({ guidanceScale: v })}
                        tooltip="How closely to follow the prompt. Higher = more literal."
                    />
                    <SliderControl
                        label="Inference Steps"
                        value={params.inferenceSteps || 30}
                        min={10}
                        max={100}
                        step={5}
                        onChange={(v) => onChange({ inferenceSteps: v })}
                        tooltip="More steps = higher quality but slower."
                    />
                    {mode === 'video' && (
                        <SliderControl
                            label="Motion Strength"
                            value={params.motionStrength || 0.5}
                            min={0.1}
                            max={1.0}
                            step={0.1}
                            onChange={(v) => onChange({ motionStrength: v })}
                            tooltip="Amount of motion in the video."
                        />
                    )}
                    <div className="space-y-2">
                        <label className="text-xs text-slate-400">Seed (optional)</label>
                        <input
                            type="number"
                            placeholder="Random"
                            value={params.seed || ''}
                            onChange={(e) => onChange({ seed: e.target.value ? parseInt(e.target.value) : undefined })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-200
                                focus:outline-none focus:border-cyan-500 text-sm placeholder:text-slate-500"
                        />
                    </div>
                </Section>

                {/* Style Section */}
                <Section title="Style" icon={<Palette size={14} />} defaultOpen={false}>
                    <StylePresets
                        value={params.stylePreset || 'none'}
                        onChange={(v) => onChange({ stylePreset: v as any })}
                    />
                    <div className="space-y-2">
                        <label className="text-xs text-slate-400">Negative Prompt</label>
                        <textarea
                            placeholder="What to avoid..."
                            value={params.negativePrompt || ''}
                            onChange={(e) => onChange({ negativePrompt: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-200
                                focus:outline-none focus:border-cyan-500 text-sm resize-none h-20
                                placeholder:text-slate-500"
                        />
                    </div>
                </Section>

                {/* Cost Optimization Section (Image mode) */}
                {mode === 'image' && (
                    <Section title="Cost Optimization" icon={<Cpu size={14} />} defaultOpen={false}>
                        <div className="space-y-3">
                            {/* Prefer Local Toggle */}
                            <label className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={params.preferLocal || false}
                                    onChange={(e) => onChange({ preferLocal: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-500 text-green-500 focus:ring-green-500 bg-slate-700"
                                />
                                <div className="flex-1">
                                    <div className="text-sm text-white flex items-center gap-2">
                                        🆓 Use Free/Local Mode
                                        <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                                            DreamShaper 8
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                        Generate locally first (512x512). Falls back to cloud if unavailable.
                                    </div>
                                </div>
                            </label>

                            {/* Save to Library Toggle */}
                            <label className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={params.saveToLibrary || false}
                                    onChange={(e) => onChange({ saveToLibrary: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-500 text-cyan-500 focus:ring-cyan-500 bg-slate-700"
                                />
                                <div className="flex-1">
                                    <div className="text-sm text-white flex items-center gap-2">
                                        📚 Auto-Save to Library
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                        Register generated images as assets for @mentions and video.
                                    </div>
                                </div>
                            </label>
                        </div>
                    </Section>
                )}

                {/* Asset Library Section */}
                <Section title="Asset Library" icon={<Library size={14} />} defaultOpen={false}>
                    <Suspense fallback={<div className="text-center py-4 text-slate-500">Loading...</div>}>
                        <AssetLibraryBrowser
                            onInsertMention={(mention) => {
                                const newPrompt = params.prompt ? `${params.prompt} ${mention}` : mention;
                                onChange({ prompt: newPrompt });
                            }}
                        />
                    </Suspense>
                </Section>

                {/* Voice & Lip Sync Section (Video mode only) */}
                {mode === 'video' && (
                    <Section title="Voice & Lip Sync" icon={<Mic size={14} />} defaultOpen={false}>
                        <Suspense fallback={<div className="text-center py-4 text-slate-500">Loading...</div>}>
                            <VoiceLipSyncPanel
                                onVoiceGenerated={(audioUrl) => {
                                    console.log('[MediaControlPanel] Voice generated:', audioUrl);
                                }}
                                onLipSyncApplied={(videoUrl) => {
                                    console.log('[MediaControlPanel] LipSync applied:', videoUrl);
                                }}
                            />
                        </Suspense>
                    </Section>
                )}

            </div>

            {/* VRAM Status Bar */}
            <VramStatusBar status={vramStatus} />
        </div>
    );
};

export default MediaControlPanel;
