/**
 * VisualEditorStage — full PhotoCraft editor (WASM) embedded, bridged to the
 * Silhouette workspace: open workspace files in the editor, editor saves land
 * back in the workspace (bridge: scripts/photocraft-web-bridge.js).
 */
import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, Save } from 'lucide-react';
import { api } from '../../utils/api';

type WorkspaceFile = { path: string; name: string; size: number; mtime: string };

export const VisualEditorStage: React.FC = () => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [files, setFiles] = useState<WorkspaceFile[]>([]);
    const [selected, setSelected] = useState('');
    const [status, setStatus] = useState<string | null>(null);

    const loadFiles = () => {
        api.get<{ files: WorkspaceFile[] }>('/v1/visual/files')
            .then(res => setFiles(res?.files || []))
            .catch(() => setFiles([]));
    };

    useEffect(() => {
        loadFiles();
        const onMsg = (ev: MessageEvent) => {
            const d = ev.data || {};
            if (d.type === 'silhouette:saved') { setStatus(`✓ ${d.name} guardado en el workspace de Silhouette`); loadFiles(); }
            if (d.type === 'silhouette:save-error') setStatus(`✗ No se pudo guardar ${d.name} en el workspace (la descarga local sí ocurre)`);
            if (d.type === 'silhouette:opened') setStatus(`✓ ${d.name} abierto en el editor`);
            if (d.type === 'silhouette:open-error') setStatus(`✗ No se pudo abrir ${d.name} en el editor`);
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, []);

    const openInEditor = () => {
        if (!selected || !iframeRef.current?.contentWindow) return;
        const f = files.find(x => x.path === selected);
        if (!f) return;
        iframeRef.current.contentWindow.postMessage(
            { type: 'silhouette:open', name: f.name, url: `/v1/visual/file?path=${encodeURIComponent(f.path)}` },
            window.location.origin
        );
        setStatus(`Enviando ${f.name} al editor…`);
    };

    return (
        <div className="space-y-3 h-full flex flex-col">
            <div className="text-xs text-slate-400">
                Editor completo PhotoCraft (motor real, WebAssembly en tu navegador): capas, filtros, PSD, vectores, brushes.
                Guardar/exportar en el editor también escribe el archivo en el workspace de Silhouette.
            </div>

            {/* Workspace bridge toolbar */}
            <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-900 border border-slate-800 rounded-lg">
                <FolderOpen size={14} className="text-cyan-400 shrink-0" />
                <select value={selected} onChange={e => setSelected(e.target.value)}
                    className="flex-1 min-w-[160px] bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-white">
                    <option value="">— archivo del workspace —</option>
                    {files.map(f => (
                        <option key={f.path} value={f.path}>{f.name} ({(f.size / 1024).toFixed(0)} KB)</option>
                    ))}
                </select>
                <button onClick={openInEditor} disabled={!selected}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded text-white text-[10px] font-bold whitespace-nowrap">
                    OPEN IN EDITOR
                </button>
                <button onClick={loadFiles} title="Refrescar lista"
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300">
                    <RefreshCw size={12} />
                </button>
                <span className="text-[10px] text-slate-500 whitespace-nowrap hidden md:flex items-center gap-1">
                    <Save size={11} /> saves → workspace/visual/
                </span>
            </div>

            {status && <div className="text-[11px] font-mono text-slate-300 px-1">{status}</div>}

            <div className="md:hidden text-[11px] text-amber-300/80 px-1">
                El editor PhotoCraft es de escritorio (su interfaz es un lienzo WASM fijo). En pantalla pequena gira el telefono o usa COMPOSE para piezas rapidas.
            </div>

            <iframe
                ref={iframeRef}
                src="/visual-editor/"
                title="PhotoCraft Editor"
                className="flex-1 w-full min-h-[70vh] rounded-lg border border-slate-700 bg-[#262626]"
            />
        </div>
    );
};

export default VisualEditorStage;
