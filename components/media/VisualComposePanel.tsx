/**
 * VisualComposePanel — Visual Cortex local composition UI.
 * Talks to the real /v1/visual/* service (PhotoCraft engine, local, zero cost).
 * Honest availability: UNAVAILABLE banner ONLY when the engine health check says so.
 */
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Download, RefreshCw, Layers } from 'lucide-react';
import { api } from '../../utils/api';

type Health = { state: 'loading' | 'ok' | 'unavailable'; commands?: number; reason?: string };
type TextLayer = { text: string; x: number; y: number; size: number; color: string };
type ImageLayer = { path: string; fit: boolean };
type ComposeResult = { url: string; output: string; log: string[] };

const PRESETS: Array<{ label: string; w: number; h: number }> = [
    { label: 'Post 1080×1080', w: 1080, h: 1080 },
    { label: 'Portrait 1080×1350', w: 1080, h: 1350 },
    { label: 'Wide 1920×1080', w: 1920, h: 1080 },
    { label: 'Story 1080×1920', w: 1080, h: 1920 },
];

export const VisualComposePanel: React.FC = () => {
    const [health, setHealth] = useState<Health>({ state: 'loading' });

    const [preset, setPreset] = useState(0);
    const [custom, setCustom] = useState(false);
    const [width, setWidth] = useState(1080);
    const [height, setHeight] = useState(1080);

    const [bgMode, setBgMode] = useState<'gradient' | 'color'>('gradient');
    const [from, setFrom] = useState('#0f2050');
    const [to, setTo] = useState('#501478');
    const [angle, setAngle] = useState(45);
    const [solid, setSolid] = useState('#101010');

    const [texts, setTexts] = useState<TextLayer[]>([{ text: 'HEADLINE', x: 120, y: 540, size: 72, color: '#ffffff' }]);
    const [images, setImages] = useState<ImageLayer[]>([]);
    const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png');

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ComposeResult | null>(null);

    const checkHealth = () => {
        setHealth({ state: 'loading' });
        api.get<{ available: boolean; commands?: number; error?: string }>('/v1/visual/health')
            .then(res => setHealth(res?.available
                ? { state: 'ok', commands: res.commands ?? undefined }
                : { state: 'unavailable', reason: res?.error || 'Engine reported unavailable' }))
            .catch((e: any) => setHealth({ state: 'unavailable', reason: e?.message || 'Health check failed' }));
    };

    useEffect(checkHealth, []);

    const applyPreset = (i: number) => {
        setPreset(i); setCustom(false);
        setWidth(PRESETS[i].w); setHeight(PRESETS[i].h);
    };

    const compose = async () => {
        setBusy(true); setError(null); setResult(null);
        const stamp = Date.now();
        const out = `/opt/silhouette/output/visual/ui-${stamp}.${format}`;
        const spec: any = {
            width, height, out,
            background: bgMode === 'gradient'
                ? { type: 'gradient', from, to, angle }
                : { type: 'color', color: solid },
        };
        if (texts.length > 0) spec.texts = texts;
        if (images.length > 0) spec.images = images;
        try {
            const res = await api.post<any>('/v1/visual/compose', spec);
            if (!res?.success) throw new Error(res?.error || 'Compose failed');
            const rel = String(res.output).substring(String(res.output).lastIndexOf('/output/') + '/output/'.length);
            setResult({ url: `/visual-output/${rel}?t=${stamp}`, output: res.output, log: res.log || [] });
        } catch (e: any) {
            setError(e?.message || 'Compose failed');
        } finally {
            setBusy(false);
        }
    };

    if (health.state === 'unavailable') {
        return (
            <div className="p-6 bg-red-950/30 border border-red-900/50 rounded-lg text-red-300 text-xs space-y-2">
                <div className="font-bold">VISUAL CORTEX UNAVAILABLE</div>
                <div>El motor local de composición no está instalado o no responde: {health.reason}</div>
                <div className="text-red-400/70">Nada se simula: sin motor no hay composición. Reintenta o revisa el servicio.</div>
                <button onClick={checkHealth} className="mt-2 px-3 py-1.5 bg-red-900/50 hover:bg-red-900 rounded text-red-200 text-[10px] font-bold flex items-center gap-1">
                    <RefreshCw size={12} /> RETRY
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">
                    Motor local PhotoCraft — composición y edición real en este servidor. Sin cloud, sin costo.
                    {health.state === 'ok' && <span className="text-emerald-400 ml-2">● {health.commands} comandos</span>}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* LEFT: Canvas + background */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-mono text-slate-400">CANVAS</label>
                        <div className="flex flex-wrap gap-1">
                            {PRESETS.map((p, i) => (
                                <button key={p.label} onClick={() => applyPreset(i)}
                                    className={`px-2 py-1 text-[10px] font-bold rounded ${!custom && preset === i ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                                    {p.label}
                                </button>
                            ))}
                            <button onClick={() => setCustom(true)}
                                className={`px-2 py-1 text-[10px] font-bold rounded ${custom ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                                CUSTOM
                            </button>
                        </div>
                        {custom && (
                            <div className="flex gap-2">
                                <input type="number" value={width} min={1} max={30000} onChange={e => setWidth(parseInt(e.target.value) || 1)}
                                    className="w-24 bg-slate-950 border border-slate-800 rounded p-2 text-sm text-white" placeholder="W" />
                                <input type="number" value={height} min={1} max={30000} onChange={e => setHeight(parseInt(e.target.value) || 1)}
                                    className="w-24 bg-slate-950 border border-slate-800 rounded p-2 text-sm text-white" placeholder="H" />
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-mono text-slate-400">BACKGROUND</label>
                        <div className="flex gap-1">
                            <button onClick={() => setBgMode('gradient')} className={`px-2 py-1 text-[10px] font-bold rounded ${bgMode === 'gradient' ? 'bg-purple-500 text-white' : 'bg-slate-800 text-slate-400'}`}>GRADIENT</button>
                            <button onClick={() => setBgMode('color')} className={`px-2 py-1 text-[10px] font-bold rounded ${bgMode === 'color' ? 'bg-purple-500 text-white' : 'bg-slate-800 text-slate-400'}`}>SOLID</button>
                        </div>
                        {bgMode === 'gradient' ? (
                            <div className="flex items-center gap-3">
                                <input type="color" value={from} onChange={e => setFrom(e.target.value)} className="w-10 h-10 rounded cursor-pointer bg-transparent" title="From" />
                                <span className="text-slate-500 text-xs">→</span>
                                <input type="color" value={to} onChange={e => setTo(e.target.value)} className="w-10 h-10 rounded cursor-pointer bg-transparent" title="To" />
                                <input type="number" value={angle} min={0} max={360} onChange={e => setAngle(parseInt(e.target.value) || 0)}
                                    className="w-16 bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white" title="Angle" />
                                <div className="w-16 h-10 rounded border border-slate-700" style={{ background: `linear-gradient(${angle}deg, ${from}, ${to})` }} />
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <input type="color" value={solid} onChange={e => setSolid(e.target.value)} className="w-10 h-10 rounded cursor-pointer bg-transparent" />
                                <span className="text-xs text-slate-500">{solid}</span>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-mono text-slate-400">IMAGE LAYERS (paths under workspace)</label>
                        {images.map((img, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <input value={img.path} onChange={e => setImages(images.map((x, j) => j === i ? { ...x, path: e.target.value } : x))}
                                    placeholder="/opt/silhouette/workspace/visual/bg.png"
                                    className="flex-1 bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white" />
                                <label className="text-[10px] text-slate-400 flex items-center gap-1">
                                    <input type="checkbox" checked={img.fit} onChange={e => setImages(images.map((x, j) => j === i ? { ...x, fit: e.target.checked } : x))} /> fit
                                </label>
                                <button onClick={() => setImages(images.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                            </div>
                        ))}
                        <button onClick={() => setImages([...images, { path: '', fit: true }])}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-[10px] font-bold text-slate-300 flex items-center gap-1">
                            <Plus size={12} /> IMAGE
                        </button>
                    </div>
                </div>

                {/* RIGHT: Text layers + output */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-mono text-slate-400">TEXT LAYERS</label>
                        {texts.map((t, i) => (
                            <div key={i} className="p-2 bg-slate-950 border border-slate-800 rounded space-y-2">
                                <div className="flex gap-2">
                                    <input value={t.text} onChange={e => setTexts(texts.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                                        className="flex-1 bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-white" placeholder="Text" />
                                    <button onClick={() => setTexts(texts.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                                </div>
                                <div className="flex gap-2 items-center text-[10px] text-slate-500">
                                    <span>X</span><input type="number" value={t.x} onChange={e => setTexts(texts.map((x, j) => j === i ? { ...x, x: parseInt(e.target.value) || 0 } : x))} className="w-16 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-white" />
                                    <span>Y</span><input type="number" value={t.y} onChange={e => setTexts(texts.map((x, j) => j === i ? { ...x, y: parseInt(e.target.value) || 0 } : x))} className="w-16 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-white" />
                                    <span>SIZE</span><input type="number" value={t.size} onChange={e => setTexts(texts.map((x, j) => j === i ? { ...x, size: parseInt(e.target.value) || 1 } : x))} className="w-16 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-white" />
                                    <input type="color" value={t.color} onChange={e => setTexts(texts.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} className="w-8 h-7 rounded cursor-pointer bg-transparent" />
                                </div>
                            </div>
                        ))}
                        <button onClick={() => setTexts([...texts, { text: '', x: 60, y: 60 + texts.length * 80, size: 48, color: '#ffffff' }])}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-[10px] font-bold text-slate-300 flex items-center gap-1">
                            <Plus size={12} /> TEXT
                        </button>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-mono text-slate-400">FORMAT</label>
                        <div className="flex gap-1">
                            {(['png', 'jpg', 'webp'] as const).map(f => (
                                <button key={f} onClick={() => setFormat(f)}
                                    className={`px-2 py-1 text-[10px] font-bold rounded uppercase ${format === f ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-400'}`}>{f}</button>
                            ))}
                        </div>
                    </div>

                    <button onClick={compose} disabled={busy || health.state !== 'ok'}
                        className="w-full py-3 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-lg text-white text-sm font-bold hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
                        <Layers size={16} /> {busy ? 'COMPOSING…' : 'COMPOSE'}
                    </button>

                    {error && (
                        <div className="p-3 bg-red-950/40 border border-red-900/50 rounded text-red-300 text-xs whitespace-pre-wrap">{error}</div>
                    )}
                </div>
            </div>

            {result && (
                <div className="space-y-3">
                    <label className="text-xs font-mono text-slate-400">RESULT</label>
                    <div className="rounded-lg overflow-hidden border border-slate-700 bg-slate-950 max-w-xl">
                        <img src={result.url} alt="Composed asset" className="w-full h-auto" />
                    </div>
                    <div className="flex items-center gap-3">
                        <a href={result.url} download className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs font-bold flex items-center gap-1">
                            <Download size={14} /> DOWNLOAD
                        </a>
                        <span className="text-[10px] text-slate-500 font-mono">{result.output}</span>
                    </div>
                    {result.log.length > 0 && (
                        <details className="text-[10px] text-slate-500">
                            <summary className="cursor-pointer hover:text-slate-300">Engine log ({result.log.length} commands)</summary>
                            <pre className="mt-1 p-2 bg-slate-950 border border-slate-800 rounded overflow-x-auto">{result.log.join('\n')}</pre>
                        </details>
                    )}
                </div>
            )}
        </div>
    );
};

export default VisualComposePanel;
