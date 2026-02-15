import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Image as ImageIcon, Wand2, Sliders, Video, Check, Download, BrainCircuit, Search, Clock, Settings2, ZoomIn } from 'lucide-react';
import { AssetGrid } from './chat/AssetGrid';
import { BrandDigitalTwin, CampaignBlueprint, VideoJob } from '../types';
import { api } from '../utils/api';
import { MediaControlPanel, MediaGenerationParams } from './media/MediaControlPanel';
import type { ParsedAsset } from './chat/AssetRenderer';

// Lazy load premium components for performance
const ImageCard = lazy(() => import('./chat/ImageCard').then(m => ({ default: m.ImageCard })));
const VideoCard = lazy(() => import('./chat/VideoCard').then(m => ({ default: m.VideoCard })));
const AssetLightbox = lazy(() => import('./chat/AssetLightbox').then(m => ({ default: m.AssetLightbox })));

type StudioStage = 'STRATEGY' | 'PRODUCT' | 'SCOUT' | 'SYNTHESIZE' | 'ANIMATE' | 'QA' | 'DELIVERY';

export default function MediaStudio() {
    const [activeStage, setActiveStage] = useState<StudioStage>('STRATEGY');

    // STRATEGY STATE
    const [activeBrand, setActiveBrand] = useState<BrandDigitalTwin | null>(null);
    const [brandQuery, setBrandQuery] = useState('');
    const [brandRules, setBrandRules] = useState<string | null>(null);

    // CAMPAIGN STATE (THE DIRECTOR)
    const [campaignObjective, setCampaignObjective] = useState('');
    const [campaignPlan, setCampaignPlan] = useState<CampaignBlueprint | null>(null);
    const [isPlanning, setIsPlanning] = useState(false);

    // PRODUCT STATE
    const [productImage, setProductImage] = useState<string | null>(null);
    const [productPrompt, setProductPrompt] = useState('');
    const [isProductProcessing, setIsProductProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // SCOUT STATE
    const [searchQuery, setSearchQuery] = useState('');
    const [scoutResults, setScoutResults] = useState<any[]>([]);
    const [selectedAsset, setSelectedAsset] = useState<any>(null);
    const [isSearching, setIsSearching] = useState(false);

    // SYNTH STATE
    const [synthPrompt, setSynthPrompt] = useState('');
    const [synthOptions, setSynthOptions] = useState({ strength: 0.75, guidance: 7.5, steps: 30 });
    const [synthResult, setSynthResult] = useState<string | null>(null);
    const [isSynthesizing, setIsSynthesizing] = useState(false);

    // QA STATE (THE CRITIC)
    const [qaReport, setQaReport] = useState<any | null>(null);
    const [isCritiquing, setIsCritiquing] = useState(false);

    // ANIMATE STATE
    const [videoResult, setVideoResult] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
    const [showControlPanel, setShowControlPanel] = useState(true);

    // MEDIA GENERATION PARAMS (Central State)
    const [mediaParams, setMediaParams] = useState<MediaGenerationParams>({
        prompt: '',
        engine: 'WAN',
        aspectRatio: '16:9',
        resolution: '1024x1024',
        duration: 5,
        fps: 24,
        guidanceScale: 7.5,
        inferenceSteps: 30,
        motionStrength: 0.5,
        stylePreset: 'none'
    });

    // VRAM STATUS
    const [vramStatus, setVramStatus] = useState<any>(null);

    // [PREMIUM DISPLAY] Lightbox state for full-screen previews
    const [lightboxAsset, setLightboxAsset] = useState<ParsedAsset | null>(null);

    // Fetch VRAM status periodically
    useEffect(() => {
        const fetchVram = async () => {
            try {
                const status = await api.get<any>('/v1/media/vram-status');
                setVramStatus(status);
            } catch (e) {
                // Silent fail
            }
        };
        fetchVram();
        const interval = setInterval(fetchVram, 10000); // Every 10s
        return () => clearInterval(interval);
    }, []);

    // --- POLLING EFFECT ---
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (videoJob && videoJob.status !== 'COMPLETED' && videoJob.status !== 'FAILED') {
            interval = setInterval(async () => {
                try {
                    // Poll the specific job status (or the queue and filter)
                    // Currently backend returns active queue. We can fetch and find ours.
                    const queue = await api.get<VideoJob[]>('/v1/media/queue');
                    const myJob = queue.find(j => j.id === videoJob.id);

                    if (myJob) {
                        setVideoJob(myJob);
                        if (myJob.status === 'COMPLETED' && myJob.videoPath) {
                            // Backend path might be local file path, we need to map to URL if served statically.
                            // Assuming backend updates videoPath to a web-accessible URL or we need a proxy.
                            // For now, let's assume raw path needs adjustment or provided url.
                            // Actually, localVideoService updates path.
                            // Let's assume server serves data/outputs/video via static.
                            // We might need to construct valid URL.
                            setVideoResult(myJob.videoPath); // May need fix
                            setIsAnimating(false);
                        } else if (myJob.status === 'FAILED') {
                            setIsAnimating(false);
                            alert("Video Generation Failed");
                        }
                    } else {
                        // Job disappeared?
                        console.warn("Job lost from queue:", videoJob.id);
                    }
                } catch (e) {
                    console.error("Polling error", e);
                }
            }, 3000); // 3s polling
        }

        return () => clearInterval(interval);
    }, [videoJob]);

    // DELIVERY STATE (THE ARCHIVE)
    const [upscaledResult, setUpscaledResult] = useState<string | null>(null);
    const [isUpscaling, setIsUpscaling] = useState(false);

    // --- HANDLERS ---

    const handleLoadBrand = async () => {
        const brandId = prompt("Enter Brand ID to Load (e.g., 'brand_nike_001'):", "brand_nike_001");
        if (!brandId) return;

        try {
            try {
                const brand = await api.get<BrandDigitalTwin>(`/v1/media/brand/${brandId}`);
                setActiveBrand(brand);

                const { rules } = await api.get<{ rules: string }>(`/v1/media/brand/${brand.id}/rules?objective=general`);
                setBrandRules(rules);
            } catch (e) {
                console.error("Failed to load brand", e);
                alert("Brand not found in Vector Memory.");
            }
        } catch (e) {
            console.error("Failed to load brand", e);
            alert("Error loading brand.");
        }
    };

    const handleCreateCampaign = async () => {
        if (!activeBrand || !campaignObjective) return;
        setIsPlanning(true);
        try {
            const plan = await api.post<CampaignBlueprint>('/v1/media/campaign/create', { objective: campaignObjective, brandId: activeBrand.id });
            setCampaignPlan(plan);
        } catch (e) {
            console.error(e);
            alert("Director Failed to Plan Campaign");
        } finally {
            setIsPlanning(false);
        }
    };

    const handleSelectShot = (shot: any) => {
        // 1. Set the creative prompt
        setProductPrompt(shot.description);

        // 2. If we have an Auto-Scout Anchor, set it as the selected asset
        if (shot.referenceImage) {
            setSelectedAsset({
                id: 'auto-scout-' + shot.id,
                url: shot.referenceImage,
                thumb: shot.referenceThumb || shot.referenceImage,
                author: { name: 'Unsplash Auto-Scout' }
            });
            console.log("[MediaStudio] Auto-Scout Anchor Selected:", shot.referenceImage);
        }

        // 3. Navigate intelligently
        if (productImage) {
            // If we already have a product, go straight to Synthesis to merge them
            setActiveStage('SYNTHESIZE');
            setSynthPrompt(shot.description); // Pre-fill synth prompt too
        } else {
            // Otherwise, go to Product stage to get the product first
            setActiveStage('PRODUCT');
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) setProductImage(ev.target.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleGenerateProduct = async () => {
        if (!productPrompt) return;
        setIsProductProcessing(true);
        try {
            const { url } = await api.post<{ url: string }>('/v1/media/generate/image', {
                prompt: productPrompt,
                style: mediaParams.stylePreset !== 'none' ? mediaParams.stylePreset : undefined
            });
            setProductImage(url);
        } catch (e) {
            console.error(e);
            alert("Product Generation Failed");
        } finally {
            setIsProductProcessing(false);
        }
    };

    const handleEnhanceProduct = async () => {
        if (!productImage) return;
        setIsProductProcessing(true);
        try {
            // Enhance using NanoBanana (low strength img2img)
            const { url } = await api.post<{ url: string }>('/v1/media/enhance', {
                image: productImage,
                prompt: "high quality product photography, 8k, studio lighting",
                strength: 0.3
            });
            setProductImage(url);
        } catch (e) {
            console.error(e);
            alert("Enhancement Failed");
        } finally {
            setIsProductProcessing(false);
        }
    };

    const handleSearch = async () => {
        if (!searchQuery) return;
        setIsSearching(true);
        try {
            // Inject Brand DNA into search if available
            let finalQuery = searchQuery;
            if (activeBrand) {
                const vibe = activeBrand.manifesto.emotionalSpectrum.secondary.join(' ');
                finalQuery = `${searchQuery} ${vibe} style`;
            }

            const results = await api.get<any[]>(`/v1/media/search?query=${encodeURIComponent(finalQuery)}`);
            setScoutResults(results);
        } catch (e) {
            console.error(e);
        } finally {
            setIsSearching(false);
        }
    };

    const handleAnimate = async () => {
        if (!synthResult) return;
        setIsAnimating(true);
        setVideoResult(null); // Clear previous
        try {
            // Queue the job with full parameters from control panel
            const response = await api.post<{ success: boolean, message: VideoJob }>('/v1/media/queue', {
                prompt: mediaParams.prompt || synthPrompt,
                image: synthResult,
                engine: mediaParams.engine || 'WAN',
                duration: mediaParams.duration,
                fps: mediaParams.fps,
                aspect_ratio: mediaParams.aspectRatio,
                motion_strength: mediaParams.motionStrength,
                guidance_scale: mediaParams.guidanceScale,
                inference_steps: mediaParams.inferenceSteps,
                negative_prompt: mediaParams.negativePrompt,
                seed: mediaParams.seed,
                style_preset: mediaParams.stylePreset
            });

            if (response.success && response.message && typeof response.message === 'object') {
                setVideoJob(response.message);
                // Polling effect handles the rest
            } else {
                console.error("Unexpected response from queue", response);
                alert("Failed to queue video.");
                setIsAnimating(false);
            }

        } catch (e) {
            console.error(e);
            alert("Animation Queue Failed");
            setIsAnimating(false);
        }
    };

    const handleSynthesize = async () => {
        if (!productImage) return; // Must have a product
        if (!synthPrompt) return;

        setIsSynthesizing(true);
        try {
            // Determine Anchor Image (from Auto-Scout)
            const anchorImage = selectedAsset?.url;

            // Inject Brand Rules into Prompt
            let finalPrompt = synthPrompt;
            if (activeBrand) {
                const { rules } = await api.get<{ rules: string }>(`/v1/media/brand/${activeBrand.id}/rules?objective=${encodeURIComponent(synthPrompt)}`);
                finalPrompt = `${synthPrompt}. ${rules}`;
            }

            // Execute Real-Hybrid Pipeline
            const result = await api.post<{ relit: string }>('/v1/media/composite', { productImage, anchorImage, prompt: finalPrompt });

            setSynthResult(result.relit);

            // AUTO-ADVANCE TO CRITIC (QA) INSTEAD OF ANIMATE
            setActiveStage('QA');
            handleCritique(result.relit, finalPrompt);

        } catch (e) {
            console.error(e);
            alert("Real-Hybrid Synthesis Failed");
        } finally {
            setIsSynthesizing(false);
        }
    };

    const handleCritique = async (imageUrl: string, prompt: string) => {
        if (!activeBrand) {
            // If no brand, skip QA
            setActiveStage('ANIMATE');
            return;
        }

        setIsCritiquing(true);
        try {
            const report = await api.post<any>('/v1/media/critique', { image: imageUrl, brand: activeBrand, prompt });
            setQaReport(report);
        } catch (e) {
            console.error("Critique failed", e);
        } finally {
            setIsCritiquing(false);
        }
    };

    const handleAutoFix = async () => {
        if (!qaReport || !synthResult) return;

        // Re-run synthesis with feedback injected
        const fixPrompt = `${synthPrompt}. IMPORTANT FIX: ${qaReport.feedback}`;
        setSynthPrompt(fixPrompt); // Update UI
        setActiveStage('SYNTHESIZE'); // Go back
        // User can then click "Generate" again
    };

    const handleUpscale = async () => {
        if (!synthResult) return;
        setIsUpscaling(true);
        try {
            const { url } = await api.post<{ url: string }>('/v1/media/upscale', { image: synthResult, scale: 4 });
            setUpscaledResult(url);
        } catch (e) {
            console.error(e);
            alert("Upscaling Failed");
        } finally {
            setIsUpscaling(false);
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-slate-900 border-l border-slate-800">

            {/* HEADER */}
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                <h2 className="text-sm font-bold text-cyan-400 flex items-center gap-2">
                    <Wand2 size={16} /> MEDIA CORTEX
                </h2>
                <div className="flex gap-1 bg-slate-800 p-1 rounded-lg">
                    {(['STRATEGY', 'PRODUCT', 'SCOUT', 'SYNTHESIZE', 'QA', 'ANIMATE'] as any[]).map(stage => (
                        <button
                            key={stage}
                            onClick={() => setActiveStage(stage)}
                            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${activeStage === stage
                                ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                                : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            {stage}
                        </button>
                    ))}
                </div>
            </div>

            {/* CONTENT AREA */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">

                {/* ... (Existing Stages: STRATEGY, PRODUCT, SCOUT) ... */}
                {activeStage === 'STRATEGY' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="p-6 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
                            <div className="flex items-center gap-3 text-cyan-400">
                                <BrainCircuit size={24} />
                                <h3 className="font-bold text-lg">Brand Digital Twin</h3>
                            </div>
                            <p className="text-slate-400 text-sm">
                                Load a Brand Manifesto to enforce strict visual rules (Colors, Tone, Typography) across all generated assets.
                            </p>

                            {!activeBrand ? (
                                <button
                                    onClick={handleLoadBrand}
                                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors"
                                >
                                    LOAD DEMO BRAND (NIKE)
                                </button>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-green-400 bg-green-900/20 p-3 rounded-lg border border-green-900">
                                        <Check size={16} />
                                        <span className="font-bold">{activeBrand.name} Twin Active</span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                                            <h4 className="text-xs font-mono text-slate-500 mb-2">PRIMARY EMOTION</h4>
                                            <div className="text-white font-bold">{activeBrand.manifesto.emotionalSpectrum.primary}</div>
                                        </div>
                                        <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                                            <h4 className="text-xs font-mono text-slate-500 mb-2">FORBIDDEN</h4>
                                            <div className="text-red-400 text-xs">{activeBrand.manifesto.emotionalSpectrum.forbidden.join(', ')}</div>
                                        </div>
                                    </div>

                                    <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                                        <h4 className="text-xs font-mono text-slate-500 mb-2">DESIGN SYSTEM RULES</h4>
                                        <p className="text-slate-300 text-xs italic">"{brandRules}"</p>
                                    </div>

                                    {/* CAMPAIGN DIRECTOR UI */}
                                    <div className="pt-4 border-t border-slate-800 space-y-3">
                                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                            <Video size={16} className="text-purple-400" /> THE DIRECTOR
                                        </h4>
                                        <textarea
                                            value={campaignObjective}
                                            onChange={(e) => setCampaignObjective(e.target.value)}
                                            placeholder="What is the goal of this campaign? (e.g. 'Launch a new neon running shoe for urban night runners')"
                                            className="w-full h-20 bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-white focus:border-purple-500 outline-none resize-none"
                                        />
                                        <button
                                            onClick={handleCreateCampaign}
                                            disabled={isPlanning || !campaignObjective}
                                            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition-all"
                                        >
                                            {isPlanning ? 'DIRECTOR IS THINKING...' : 'GENERATE CAMPAIGN PLAN'}
                                        </button>
                                    </div>

                                    {/* SHOTLIST DISPLAY */}
                                    {campaignPlan && (
                                        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                                            <div className="bg-slate-900 p-3 rounded-lg border border-purple-500/30">
                                                <h5 className="text-xs font-bold text-purple-300 mb-2">SHOTLIST: {campaignPlan.name}</h5>
                                                <div className="space-y-2">
                                                    {campaignPlan.shotlist?.map((shot, idx) => (
                                                        <div key={shot.id} className="p-2 bg-slate-950 rounded border border-slate-800 hover:border-cyan-500 cursor-pointer group relative overflow-hidden" onClick={() => handleSelectShot(shot)}>
                                                            {/* Auto-Scout Background */}
                                                            {shot.referenceImage && (
                                                                <div className="absolute inset-0 opacity-20 group-hover:opacity-40 transition-opacity">
                                                                    <img src={shot.referenceImage} className="w-full h-full object-cover" />
                                                                </div>
                                                            )}

                                                            <div className="relative z-10">
                                                                <div className="flex justify-between items-start mb-1">
                                                                    <span className="text-[10px] font-mono text-slate-500 bg-black/50 px-1 rounded">SHOT {idx + 1}</span>
                                                                    <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 px-1 rounded">PRODUCE &rarr;</span>
                                                                </div>
                                                                <p className="text-xs text-slate-300 line-clamp-2 drop-shadow-md">{shot.description}</p>
                                                                <div className="flex gap-2 mt-2">
                                                                    <span className="text-[9px] bg-slate-800/80 px-1 rounded text-slate-400 border border-slate-700">{shot.angle}</span>
                                                                    <span className="text-[9px] bg-slate-800/80 px-1 rounded text-slate-400 border border-slate-700">{shot.lighting}</span>
                                                                    {shot.referenceImage && <span className="text-[9px] bg-green-900/80 text-green-400 px-1 rounded border border-green-800">ANCHORED</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeStage === 'PRODUCT' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="grid grid-cols-2 gap-6">
                            {/* Left: Input Methods */}
                            <div className="space-y-4">
                                <div className="p-4 border border-dashed border-slate-700 rounded-lg hover:border-cyan-500 transition-colors group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept="image/*" />
                                    <div className="flex flex-col items-center gap-2 text-slate-500 group-hover:text-cyan-400">
                                        <ImageIcon size={24} />
                                        <span className="text-xs font-bold">UPLOAD PRODUCT</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-mono text-slate-400">OR GENERATE NEW</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={productPrompt}
                                            onChange={(e) => setProductPrompt(e.target.value)}
                                            placeholder="e.g., 'Futuristic Sneaker made of glass'"
                                            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-cyan-500 outline-none"
                                        />
                                        <button
                                            onClick={handleGenerateProduct}
                                            disabled={isProductProcessing}
                                            className="bg-purple-600 hover:bg-purple-500 text-white p-2 rounded-lg"
                                        >
                                            <Wand2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Preview & Enhance */}
                            <div className="space-y-2">
                                <label className="text-xs font-mono text-slate-400">PRODUCT PREVIEW</label>
                                <div className="aspect-square rounded-lg overflow-hidden border border-slate-700 bg-black relative group">
                                    {productImage ? (
                                        <>
                                            <img src={productImage} className="w-full h-full object-contain" />
                                            <div className="absolute bottom-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={handleEnhanceProduct}
                                                    disabled={isProductProcessing}
                                                    className="bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 shadow-lg"
                                                >
                                                    <Sliders size={12} /> ENHANCE (4K)
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                                            No Product Loaded
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {productImage && (
                            <button
                                onClick={() => setActiveStage('SCOUT')}
                                className="w-full bg-cyan-500 hover:bg-cyan-400 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all"
                            >
                                NEXT: SCOUT BACKGROUND <Search size={16} />
                            </button>
                        )}
                    </div>
                )}

                {activeStage === 'SCOUT' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="space-y-2">
                            <label className="text-xs font-mono text-slate-400">1. SEARCH REAL ASSETS (UNSPLASH)</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    placeholder="e.g., 'Cyberpunk City', 'Luxury Watch', 'Forest'"
                                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-sm text-white focus:border-cyan-500 outline-none"
                                />
                                <button
                                    onClick={handleSearch}
                                    disabled={isSearching}
                                    className="bg-slate-800 hover:bg-slate-700 text-white p-2 rounded-lg transition-colors"
                                >
                                    {isSearching ? <Wand2 className="animate-spin" size={18} /> : <Search size={18} />}
                                </button>
                            </div>
                        </div>

                        {scoutResults.length > 0 && (
                            <div className="space-y-2">
                                <label className="text-xs font-mono text-slate-400">SELECT BASE PLATE</label>
                                <AssetGrid
                                    assets={scoutResults}
                                    selectedId={selectedAsset?.id}
                                    onSelect={(asset) => {
                                        setSelectedAsset(asset);
                                        // Optional: Auto-advance or show notification
                                    }}
                                />
                            </div>
                        )}

                        {selectedAsset && (
                            <button
                                onClick={() => setActiveStage('SYNTHESIZE')}
                                className="w-full bg-cyan-500 hover:bg-cyan-400 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all"
                            >
                                NEXT: SYNTHESIZE <Wand2 size={16} />
                            </button>
                        )}
                    </div>
                )}

                {/* STAGE 3: SYNTHESIZE */}
                {activeStage === 'SYNTHESIZE' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex gap-4">
                            {/* Left: Base Asset */}
                            <div className="w-1/3 space-y-2">
                                <label className="text-xs font-mono text-slate-400">BASE ASSET</label>
                                {selectedAsset || productImage ? (
                                    <div className="relative rounded-lg overflow-hidden border border-slate-700 aspect-square">
                                        <img src={productImage || selectedAsset?.thumb} className="w-full h-full object-cover opacity-50" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <ImageIcon className="text-white/50" size={32} />
                                        </div>
                                        <div className="absolute bottom-2 left-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded">
                                            {productImage ? "Using Product" : "Using Stock"}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-32 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-center text-slate-600 text-xs">
                                        No Asset Selected
                                    </div>
                                )}
                            </div>

                            {/* Right: Controls */}
                            <div className="flex-1 space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-mono text-slate-400">CREATIVE PROMPT</label>
                                    <textarea
                                        value={synthPrompt}
                                        onChange={(e) => setSynthPrompt(e.target.value)}
                                        placeholder="Describe the transformation..."
                                        className="w-full h-24 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:border-cyan-500 outline-none resize-none"
                                    />
                                </div>

                                {/* NanoBanana Controls */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px] text-slate-400">
                                            <span>INFLUENCE</span>
                                            <span>{synthOptions.strength}</span>
                                        </div>
                                        <input
                                            type="range" min="0.1" max="1.0" step="0.05"
                                            value={synthOptions.strength}
                                            onChange={(e) => setSynthOptions({ ...synthOptions, strength: parseFloat(e.target.value) })}
                                            className="w-full accent-cyan-500"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px] text-slate-400">
                                            <span>CREATIVITY</span>
                                            <span>{synthOptions.guidance}</span>
                                        </div>
                                        <input
                                            type="range" min="1" max="20" step="0.5"
                                            value={synthOptions.guidance}
                                            onChange={(e) => setSynthOptions({ ...synthOptions, guidance: parseFloat(e.target.value) })}
                                            className="w-full accent-purple-500"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleSynthesize}
                            disabled={isSynthesizing || (!selectedAsset && !productImage)}
                            className={`w-full font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all ${isSynthesizing ? 'bg-slate-800 text-slate-500' : 'bg-purple-600 hover:bg-purple-500 text-white'
                                }`}
                        >
                            {isSynthesizing ? 'SYNTHESIZING...' : 'GENERATE COMPOSITE (NANOBANANA)'}
                        </button>

                        {synthResult && (
                            <div className="mt-4">
                                <Suspense fallback={<div className="rounded-xl h-48 bg-slate-800 animate-pulse" />}>
                                    <ImageCard
                                        asset={{
                                            id: 'synth-result',
                                            type: 'image',
                                            url: synthResult,
                                            alt: synthPrompt,
                                            provider: 'NanoBanana'
                                        }}
                                        onClick={() => setLightboxAsset({
                                            id: 'synth-result',
                                            type: 'image',
                                            url: synthResult,
                                            alt: synthPrompt,
                                            provider: 'NanoBanana'
                                        })}
                                        onAction={(action) => {
                                            if (action === 'regenerate') handleSynthesize();
                                        }}
                                    />
                                </Suspense>
                            </div>
                        )}
                    </div>
                )}

                {/* STAGE 4: QA (THE CRITIC) */}
                {activeStage === 'QA' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="grid grid-cols-2 gap-6">
                            {/* Left: Image */}
                            <div className="space-y-2">
                                <label className="text-xs font-mono text-slate-400">CANDIDATE ASSET</label>
                                {synthResult ? (
                                    <div className="rounded-lg overflow-hidden border border-slate-700">
                                        <img src={synthResult} className="w-full h-auto" />
                                    </div>
                                ) : (
                                    <div className="p-8 text-center text-slate-500">No Asset</div>
                                )}
                            </div>

                            {/* Right: Report */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-cyan-400">
                                    <BrainCircuit size={20} />
                                    <h3 className="font-bold">THE CRITIC (GEMINI VISION)</h3>
                                </div>

                                {isCritiquing ? (
                                    <div className="p-6 bg-slate-950 border border-slate-800 rounded-lg flex flex-col items-center justify-center gap-4">
                                        <Wand2 className="animate-spin text-purple-500" size={32} />
                                        <span className="text-slate-400 text-sm animate-pulse">Analyzing Brand Compliance...</span>
                                    </div>
                                ) : qaReport ? (
                                    <div className={`p-4 rounded-lg border ${qaReport.pass ? 'bg-green-900/20 border-green-800' : 'bg-red-900/20 border-red-800'}`}>
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <h4 className={`text-lg font-bold ${qaReport.pass ? 'text-green-400' : 'text-red-400'}`}>
                                                        SCORE: {qaReport.score}/100
                                                    </h4>
                                                    {qaReport.pass ? <Check size={20} className="text-green-400" /> : <Video size={20} className="text-red-400" />}
                                                </div>

                                                {/* Visual Score Bar */}
                                                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
                                                    <div
                                                        className={`h-full ${qaReport.pass ? 'bg-green-500' : 'bg-red-500'} transition-all duration-1000 ease-out`}
                                                        style={{ width: `${qaReport.score}%` }}
                                                    />
                                                </div>

                                                <span className="text-xs text-slate-400 font-mono">
                                                    {qaReport.pass ? 'APPROVED FOR RELEASE' : 'REMEDIATION REQUIRED'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500">REASONING</label>
                                                <p className="text-sm text-slate-300">{qaReport.reasoning}</p>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500">FEEDBACK</label>
                                                <p className="text-sm text-slate-300 italic">"{qaReport.feedback}"</p>
                                            </div>
                                        </div>

                                        <div className="mt-4 pt-4 border-t border-white/10 flex gap-2">
                                            {!qaReport.pass && (
                                                <button
                                                    onClick={handleAutoFix}
                                                    className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-2 rounded flex items-center justify-center gap-2"
                                                >
                                                    <Wand2 size={14} /> AUTO-FIX
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setActiveStage('ANIMATE')}
                                                className={`flex-1 text-xs font-bold py-2 rounded flex items-center justify-center gap-2 ${qaReport.pass ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-slate-800 text-slate-500 hover:text-white'}`}
                                            >
                                                {qaReport.pass ? 'PROCEED TO MOTION' : 'FORCE APPROVE'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-slate-500 text-sm">Waiting for critique...</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* STAGE 5: ANIMATE (Professional Control Panel) */}
                {activeStage === 'ANIMATE' && (
                    <div className="flex gap-4 h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* LEFT: Preview & Actions */}
                        <div className="flex-1 space-y-4">
                            {/* Source Frame Preview */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-xs font-mono text-slate-400">SOURCE FRAME</label>
                                    <button
                                        onClick={() => setShowControlPanel(!showControlPanel)}
                                        className="text-xs text-slate-500 hover:text-cyan-400 flex items-center gap-1"
                                    >
                                        <Settings2 size={12} />
                                        {showControlPanel ? 'Hide' : 'Show'} Controls
                                    </button>
                                </div>
                                {synthResult ? (
                                    <div className="rounded-lg overflow-hidden border border-slate-700 aspect-video">
                                        <img src={synthResult} className="w-full h-full object-cover" />
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg aspect-video flex items-center justify-center">
                                        Generate a composite first.
                                    </div>
                                )}
                            </div>

                            {/* Generation Status / Button */}
                            {videoJob && videoJob.status !== 'FAILED' ? (
                                <div className="p-6 bg-slate-950 border border-slate-800 rounded-lg flex flex-col items-center gap-3">
                                    {videoJob.status === 'QUEUED' && (
                                        <div className="flex items-center gap-2 text-yellow-500">
                                            <Clock className="animate-pulse" size={20} />
                                            <span className="font-bold text-sm">WAITING IN QUEUE</span>
                                        </div>
                                    )}
                                    {videoJob.status === 'PROCESSING' && (
                                        <div className="flex items-center gap-2 text-cyan-400">
                                            <Wand2 className="animate-spin" size={20} />
                                            <span className="font-bold text-sm">GENERATING FRAMES...</span>
                                        </div>
                                    )}
                                    <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                                        <div className={`h-full ${videoJob.status === 'PROCESSING' ? 'bg-cyan-500 w-2/3 animate-pulse' : 'bg-yellow-500 w-1/3'} transition-all duration-500 rounded-full`} />
                                    </div>
                                    <div className="flex items-center gap-4 text-[10px] text-slate-500 font-mono">
                                        <span>JOB: {videoJob.id.split('-')[0]}</span>
                                        <span>ENGINE: {mediaParams.engine}</span>
                                        <span>FPS: {mediaParams.fps}</span>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={handleAnimate}
                                    disabled={isAnimating || !synthResult}
                                    className={`w-full font-bold py-4 rounded-lg flex items-center justify-center gap-3 transition-all text-lg ${isAnimating ? 'bg-slate-800 text-slate-500' : 'bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20'}`}
                                >
                                    <Video size={20} />
                                    {isAnimating ? 'REQUESTING...' : `GENERATE (${mediaParams.engine})`}
                                </button>
                            )}

                            {/* Video Result */}
                            {videoResult && (
                                <div className="space-y-2">
                                    <Suspense fallback={<div className="rounded-xl h-48 bg-slate-800 animate-pulse" />}>
                                        <VideoCard
                                            asset={{
                                                id: 'video-result',
                                                type: 'video',
                                                url: videoResult,
                                                alt: mediaParams.prompt || synthPrompt,
                                                provider: mediaParams.engine
                                            }}
                                            onClick={() => setLightboxAsset({
                                                id: 'video-result',
                                                type: 'video',
                                                url: videoResult,
                                                alt: mediaParams.prompt || synthPrompt,
                                                provider: mediaParams.engine
                                            })}
                                            onAction={(action) => {
                                                if (action === 'regenerate') handleAnimate();
                                            }}
                                            autoplayOnHover={false}
                                        />
                                    </Suspense>
                                    <div className="flex justify-between items-center px-2">
                                        <span className="text-xs text-green-400 font-mono">✓ RENDER COMPLETE</span>
                                        <button
                                            onClick={() => setActiveStage('DELIVERY')}
                                            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-colors"
                                        >
                                            PROCEED TO DELIVERY →
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* RIGHT: Control Panel */}
                        {showControlPanel && (
                            <div className="w-80 flex-shrink-0">
                                <MediaControlPanel
                                    params={mediaParams}
                                    onChange={(updates) => setMediaParams(prev => ({ ...prev, ...updates }))}
                                    mode="video"
                                    isGenerating={isAnimating}
                                    vramStatus={vramStatus}
                                    hasInputImage={!!synthResult}
                                    hasInputVideo={false}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* STAGE 6: DELIVERY (THE ARCHIVE) */}
                {activeStage === 'DELIVERY' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="p-6 bg-slate-950 border border-slate-800 rounded-xl space-y-6 text-center">
                            <div className="flex flex-col items-center gap-2 text-purple-400">
                                <div className="p-3 bg-purple-900/20 rounded-full">
                                    <Download size={32} />
                                </div>
                                <h3 className="font-bold text-xl text-white">THE ARCHIVE</h3>
                                <p className="text-slate-400 text-sm max-w-md">
                                    Your asset is ready for global distribution. Upscale to 4K for print/broadcast quality.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-6 text-left">
                                {/* Original Asset */}
                                <div className="space-y-2">
                                    <label className="text-xs font-mono text-slate-500">ORIGINAL (1024x1024)</label>
                                    {synthResult && (
                                        <Suspense fallback={<div className="rounded-lg h-32 bg-slate-800 animate-pulse" />}>
                                            <ImageCard
                                                asset={{
                                                    id: 'delivery-original',
                                                    type: 'image',
                                                    url: synthResult,
                                                    alt: 'Original render',
                                                    provider: 'NanoBanana'
                                                }}
                                                onClick={() => setLightboxAsset({
                                                    id: 'delivery-original',
                                                    type: 'image',
                                                    url: synthResult,
                                                    alt: 'Original render'
                                                })}
                                                compact
                                            />
                                        </Suspense>
                                    )}
                                </div>

                                {/* Upscaled Asset */}
                                <div className="space-y-2">
                                    <label className="text-xs font-mono text-purple-400 font-bold">PRODUCTION MASTER (4K)</label>
                                    {upscaledResult ? (
                                        <Suspense fallback={<div className="rounded-lg h-32 bg-slate-800 animate-pulse" />}>
                                            <ImageCard
                                                asset={{
                                                    id: 'delivery-upscaled',
                                                    type: 'image',
                                                    url: upscaledResult,
                                                    alt: '4K Upscaled',
                                                    provider: 'Real-ESRGAN'
                                                }}
                                                onClick={() => setLightboxAsset({
                                                    id: 'delivery-upscaled',
                                                    type: 'image',
                                                    url: upscaledResult,
                                                    alt: '4K Upscaled'
                                                })}
                                            />
                                        </Suspense>
                                    ) : (
                                        <div className="aspect-square rounded-lg border border-dashed border-slate-700 flex flex-col items-center justify-center gap-4 bg-slate-900/50">
                                            <button
                                                onClick={handleUpscale}
                                                disabled={isUpscaling}
                                                className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg shadow-lg hover:shadow-purple-500/25 transition-all flex items-center gap-2"
                                            >
                                                {isUpscaling ? <Wand2 className="animate-spin" /> : <Sliders size={18} />}
                                                {isUpscaling ? 'UPSCALING...' : 'UPSCALE TO 4K'}
                                            </button>
                                            <span className="text-[10px] text-slate-500">Est. time: 15s</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Package Download & Reset */}
                            <div className="pt-6 border-t border-slate-800 flex justify-between items-center">
                                <button className="text-slate-400 hover:text-white text-xs flex items-center gap-2 transition-colors">
                                    <Download size={14} /> Download Full Campaign Package
                                </button>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="text-cyan-400 hover:text-cyan-300 text-xs font-bold flex items-center gap-2"
                                >
                                    START NEW CAMPAIGN →
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>

            {/* [PREMIUM DISPLAY] Lightbox for full-screen previews */}
            {lightboxAsset && (
                <Suspense fallback={null}>
                    <AssetLightbox
                        asset={lightboxAsset}
                        onClose={() => setLightboxAsset(null)}
                    />
                </Suspense>
            )}
        </div>
    );
}
