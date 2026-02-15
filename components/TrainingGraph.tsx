import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ForceGraph3D from 'react-force-graph-3d';
import { Maximize2, RefreshCw, Minimize2, MousePointer2, Move, ZoomIn, ZoomOut, Brain, Terminal } from 'lucide-react';
import { api, API_BASE_URL } from '../utils/api';
import * as THREE from 'three';
import { TrainingExample } from '../types';
import { DEFAULT_API_CONFIG } from '../constants';

// --- STRICT TYPES ---
interface GraphNode {
    id: string;
    label: string; // 'Event' | 'Tag' | 'Input' | 'Output'
    name?: string;
    val?: number;
    color?: string;
    x?: number;
    y?: number;
    z?: number;
    originalData?: any;
}

interface GraphLink {
    source: string | GraphNode;
    target: string | GraphNode;
    id?: string;
}

interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
}

type InteractionMode = 'ROTATE' | 'PAN';

// --- CONFIGURATION CONSTANTS (Training Specific) ---
const GRAPH_CONFIG = {
    REFRESH_INTERVAL: 5000,
    ANIMATION_DURATION: 2000,
    NODE_REL_SIZE: 4,
    NODE_RESOLUTION: 16,
    COLORS: {
        EVENT: '#ff5500',    // Orange for Learning Events
        TAG: '#a855f7',      // Purple for Concepts
        INPUT: '#06b6d4',    // Cyan for Input Context
        OUTPUT: '#22c55e',   // Green for Output Action
        DIMMED: 'rgba(255,255,255,0.05)',
        LINK: 'rgba(100,200,255,0.1)'
    },
    CONTROLS: {
        DAMPING: 0.1,
        ROTATE_SPEED: 0.3,
        ZOOM_SPEED: 1.0,
        PAN_SPEED: 1.0
    }
};

const TrainingGraph: React.FC = () => {
    const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);
    const [mode, setMode] = useState<InteractionMode>('ROTATE');

    const fgRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dataRef = useRef<GraphData>({ nodes: [], links: [] });
    const isFirstLoad = useRef(true);

    const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
    const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
    const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);

    // --- PHYSICS STATE (Persisted) ---
    const [nodeSize, setNodeSize] = useState(() => Number(localStorage.getItem('training_nodeSize')) || 4);
    const [repulsion, setRepulsion] = useState(() => Number(localStorage.getItem('training_repulsion')) || 100);
    const [linkDistance, setLinkDistance] = useState(() => Number(localStorage.getItem('training_linkDistance')) || 50);

    // Persist Physics
    useEffect(() => {
        localStorage.setItem('training_nodeSize', String(nodeSize));
        localStorage.setItem('training_repulsion', String(repulsion));
        localStorage.setItem('training_linkDistance', String(linkDistance));
    }, [nodeSize, repulsion, linkDistance]);

    // Apply Physics
    useEffect(() => {
        if (fgRef.current) {
            fgRef.current.d3Force('charge').strength(-repulsion);
            fgRef.current.d3Force('link').distance(linkDistance);
            fgRef.current.d3ReheatSimulation();
        }
    }, [repulsion, linkDistance, nodeSize]);

    // --- ZOOM LOGIC ---
    const handleZoom = (delta: number) => {
        if (!fgRef.current) return;
        const cam = fgRef.current.camera();
        const direction = new THREE.Vector3();
        cam.getWorldDirection(direction);
        cam.position.addScaledVector(direction, delta * 100);
        fgRef.current.refresh();
    };

    // --- FETCH DATA ---
    const fetchGraph = useCallback(async () => {
        try {
            // Fetch last 100 training examples for a richer graph
            const response = await api.get<{ examples: TrainingExample[] }>('/v1/training/latest?limit=100');
            const examples = response.examples || [];

            const nodes: GraphNode[] = [];
            const links: GraphLink[] = [];
            const nodeSet = new Set<string>();

            examples.forEach((ex) => {
                // 1. Central Event Node
                if (!nodeSet.has(ex.id)) {
                    nodes.push({
                        id: ex.id,
                        label: 'Event',
                        name: `Training Event ${new Date(ex.timestamp).toLocaleTimeString()}`,
                        val: 10,
                        color: GRAPH_CONFIG.COLORS.EVENT,
                        originalData: ex
                    });
                    nodeSet.add(ex.id);
                }

                // 2. Tag Nodes (Concepts)
                ex.tags.forEach(tag => {
                    if (!tag) return;
                    const tagId = `tag-${tag}`;
                    if (!nodeSet.has(tagId)) {
                        nodes.push({
                            id: tagId,
                            label: 'Tag',
                            name: tag,
                            val: 6,
                            color: GRAPH_CONFIG.COLORS.TAG
                        });
                        nodeSet.add(tagId);
                    }
                    // Link Event -> Tag
                    links.push({ source: ex.id, target: tagId });

                    // 3. Connect related tags (Heuristic: If two tags share an event, link them weakly)
                    // ... (Omitted for performance, but could add "Co-occurrence" links)
                });
            });

            // Preserve existing physics state
            const currentNodesMap = new Map(dataRef.current.nodes.map(n => [n.id, n]));
            const mergedNodes = nodes.map(n => {
                const existing = currentNodesMap.get(n.id);
                return existing ? Object.assign(existing, n) : n;
            });

            const finalData = { nodes: mergedNodes, links };
            dataRef.current = finalData;
            setData(finalData);
            setLoading(false);
            if (isFirstLoad.current) isFirstLoad.current = false;

        } catch (e) {
            console.error("TrainingGraph Error:", e);
        }
    }, []);

    useEffect(() => {
        fetchGraph();
        const interval = setInterval(fetchGraph, GRAPH_CONFIG.REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [fetchGraph]);

    // --- CONTROLS CONFIGURATION ---
    useEffect(() => {
        if (fgRef.current) {
            const controls = fgRef.current.controls();
            if (controls) {
                controls.enableDamping = true;
                controls.dampingFactor = GRAPH_CONFIG.CONTROLS.DAMPING;
                controls.rotateSpeed = GRAPH_CONFIG.CONTROLS.ROTATE_SPEED;
                controls.zoomSpeed = GRAPH_CONFIG.CONTROLS.ZOOM_SPEED;
                controls.panSpeed = GRAPH_CONFIG.CONTROLS.PAN_SPEED;
                controls.screenSpacePanning = true;

                // Dynamic Mapping
                controls.mouseButtons = {
                    LEFT: mode === 'PAN' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
                    MIDDLE: THREE.MOUSE.DOLLY,
                    RIGHT: THREE.MOUSE.ROTATE
                };
            }
        }
    }, [loading, isExpanded, mode]);

    // Dimensions (ResizeObserver)
    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setDimensions({ width, height });
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [isExpanded]);

    // Interactions
    const handleNodeHover = (node: GraphNode | null) => {
        setHoverNode(node);
        const newHighlights = new Set<string>();
        if (node) {
            newHighlights.add(node.id);
            data.links.forEach((link: any) => {
                if (link.source.id === node.id) newHighlights.add(link.target.id);
                if (link.target.id === node.id) newHighlights.add(link.source.id);
            });
        }
        setHighlightNodes(newHighlights);
    };

    const toggleExpand = () => setIsExpanded(!isExpanded);

    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

    // --- SLEEP / TRAINING LOGIC ---
    const [trainingLogs, setTrainingLogs] = useState<{ type: string, message: string }[] | null>(null);
    const [isTraining, setIsTraining] = useState(false);
    const terminalEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll terminal
    useEffect(() => {
        terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [trainingLogs]);

    const triggerSleep = useCallback(() => {
        setTrainingLogs([]);
        setIsTraining(true);

        const eventSource = new EventSource(`${API_BASE_URL}/v1/training/sleep?apiKey=${DEFAULT_API_CONFIG.apiKey}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'done') {
                setIsTraining(false);
                eventSource.close();
                setTrainingLogs(prev => [...(prev || []), { type: 'success', message: '✨ TRAINING CYCLE COMPLETE. MODEL UPDATED.' }]);
                fetchGraph(); // Refresh graph to maybe show learned nodes? (or clear them as "consolidated")
            } else {
                setTrainingLogs(prev => [...(prev || []), data]);
            }
        };

        eventSource.onerror = (err) => {
            console.error("Training Stream Error", err);
            setIsTraining(false);
            eventSource.close();
            setTrainingLogs(prev => [...(prev || []), { type: 'error', message: 'CRITICAL: CONNECTION LOST' }]);
        };

    }, []);

    // ... (Existing Interactions)

    const handleNodeClick = useCallback((node: GraphNode) => {
        if (!node) return;

        // Focus Camera
        const distance = 40;
        const distRatio = 1 + distance / Math.hypot(node.x || 1, node.y || 1, node.z || 1);

        fgRef.current?.cameraPosition(
            { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio }, // new position
            node, // lookAt ({ x, y, z })
            2000  // ms transition duration
        );

        // Select Node if it has data
        if (node.label === 'Event' && node.originalData) {
            setSelectedNode(node);
        }
    }, [fgRef]);



    const containerClass = isExpanded
        ? "fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-sm group"
        : "relative h-full w-full bg-transparent overflow-hidden flex flex-col group transition-all duration-500";

    const content = (
        <div ref={containerRef} className={containerClass}>
            {/* ... (Existing Headers) ... */}

            <div className="absolute top-4 left-4 z-10 flex items-center gap-2 pointer-events-none">
                <Brain size={16} className="text-orange-500" />
                <h3 className="text-xs font-bold text-orange-100 uppercase tracking-widest">Neural Plasticity Matrix</h3>
            </div>

            {/* TRAINING CARD OVERLAY (When Node Selected) */}
            {selectedNode && selectedNode.originalData && (
                <div className="absolute top-20 right-4 z-[70] w-80 bg-slate-900/90 backdrop-blur-md border border-orange-500/30 rounded-lg shadow-2xl p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-right-10">
                    <div className="flex justify-between items-start border-b border-white/10 pb-2">
                        <div>
                            <h4 className="text-sm font-bold text-orange-400 flex items-center gap-2">
                                <Terminal size={14} />
                                TRAINING EVENT
                            </h4>
                            <span className="text-[10px] text-slate-500 font-mono">{selectedNode.originalData.id.substring(0, 8)}...</span>
                        </div>
                        <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-white">
                            <Minimize2 size={14} />
                        </button>
                    </div>

                    <div className="space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        <div>
                            <span className="text-[10px] uppercase text-slate-500 font-bold">Concept Tags</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {selectedNode.originalData.tags.map((tag: string, i: number) => (
                                    <span key={i} className="px-1.5 py-0.5 bg-purple-900/40 text-purple-300 text-[10px] rounded border border-purple-500/20">
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="bg-black/30 p-2 rounded border border-slate-800">
                            <span className="text-[10px] uppercase text-cyan-500 font-bold block mb-1">Stimulus (Input)</span>
                            <p className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">
                                {selectedNode.originalData.input}
                            </p>
                        </div>

                        <div className="bg-black/30 p-2 rounded border border-slate-800">
                            <span className="text-[10px] uppercase text-green-500 font-bold block mb-1">Response (Output)</span>
                            <p className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">
                                {selectedNode.originalData.output}
                            </p>
                        </div>

                        <div className="flex justify-between items-center text-[10px] text-slate-500 pt-2 border-t border-white/5">
                            <span>Score: {selectedNode.originalData.score || 'N/A'}</span>
                            <span>{new Date(selectedNode.originalData.timestamp).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ERROR / LOADING DISPLAY */}
            {loading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
                    <div className="p-4 bg-black/50 backdrop-blur rounded border border-orange-500/20 text-orange-400 text-xs font-mono animate-pulse">
                        SYNAPSING...
                    </div>
                </div>
            )}

            {/* PHYSICS CONTROLS (Top Left Overlay - HOVER) */}
            <div className="absolute top-12 left-4 z-[60] bg-black/60 backdrop-blur-md p-3 rounded-lg border border-slate-800 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-auto w-48">
                <div className="space-y-3">
                    <h4 className="text-[10px] font-bold text-slate-300 uppercase border-b border-slate-700 pb-1">Matrix Properties</h4>
                    <div>
                        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                            <span>Node Size</span>
                            <span>{nodeSize}</span>
                        </div>
                        <input
                            type="range" min="1" max="15" step="1"
                            value={nodeSize}
                            onChange={(e) => setNodeSize(Number(e.target.value))}
                            className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                            <span>Repulsion</span>
                            <span>{repulsion}</span>
                        </div>
                        <input
                            type="range" min="10" max="500" step="10"
                            value={repulsion}
                            onChange={(e) => setRepulsion(Number(e.target.value))}
                            className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                            <span>Link Tension</span>
                            <span>{linkDistance}</span>
                        </div>
                        <input
                            type="range" min="10" max="200" step="5"
                            value={linkDistance}
                            onChange={(e) => setLinkDistance(Number(e.target.value))}
                            className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                        />
                    </div>
                </div>
            </div>

            {/* TOP RIGHT ACTIONS */}
            <div className="absolute top-4 right-4 z-[60] flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
                <button
                    onClick={toggleExpand}
                    className="p-1.5 bg-slate-800 rounded hover:bg-slate-700 text-slate-300 transition-colors border border-slate-600"
                    title={isExpanded ? "Minimize" : "Maximize"}
                >
                    {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                <button
                    onClick={() => fgRef.current?.zoomToFit(1000, 100)}
                    className="p-1.5 bg-slate-800 rounded hover:bg-slate-700 text-slate-300 transition-colors border border-slate-600"
                    title="Reset View"
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* BOTTOM NAVIGATION BAR */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-black/60 backdrop-blur-md p-1.5 rounded-full border border-slate-700 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="flex bg-slate-800/50 rounded-full p-0.5 border border-slate-700">
                    <button
                        onClick={() => setMode('ROTATE')}
                        className={`p-2 rounded-full transition-all ${mode === 'ROTATE' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        title="Rotate Mode"
                    >
                        <MousePointer2 size={16} />
                    </button>
                    <button
                        onClick={() => setMode('PAN')}
                        className={`p-2 rounded-full transition-all ${mode === 'PAN' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        title="Pan Mode"
                    >
                        <Move size={16} />
                    </button>
                </div>

                <div className="w-px h-6 bg-slate-700 mx-1"></div>

                {/* TRAINING TRIGGER BUTTON */}
                <button
                    onClick={triggerSleep}
                    className="flex items-center gap-2 px-3 py-1.5 bg-purple-900/50 hover:bg-purple-600 text-purple-200 hover:text-white rounded-full border border-purple-500/30 transition-all shadow-[0_0_10px_rgba(168,85,247,0.2)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]"
                    title="Initiate Neural Training (Sleep Mode)"
                >
                    <Brain size={14} />
                    <span className="text-[10px] font-bold tracking-wide">SLEEP CYCLE</span>
                </button>

                <div className="w-px h-6 bg-slate-700 mx-1"></div>

                <button onClick={() => handleZoom(1)} className="p-2 bg-slate-800/50 hover:bg-slate-700 rounded-full text-slate-300 border border-slate-700">
                    <ZoomIn size={16} />
                </button>
                <button onClick={() => handleZoom(-1)} className="p-2 bg-slate-800/50 hover:bg-slate-700 rounded-full text-slate-300 border border-slate-700">
                    <ZoomOut size={16} />
                </button>
            </div>

            {/* TERMINAL OVERLAY FOR TRAINING LOGS */}
            {trainingLogs && (
                <div className="absolute inset-0 z-[80] bg-black/90 backdrop-blur flex flex-col p-8 animate-in fade-in duration-300">
                    <div className="flex justify-between items-center mb-4 border-b border-purple-500/30 pb-4">
                        <h2 className="text-xl font-bold text-purple-400 flex items-center gap-3">
                            <Brain className="animate-pulse" />
                            REM SLEEP: NEURAL ADAPTATION
                        </h2>
                        <button
                            onClick={() => setTrainingLogs(null)}
                            className="text-slate-400 hover:text-white uppercase text-xs font-bold tracking-widest border border-slate-700 px-3 py-1 rounded hover:bg-slate-800"
                        >
                            {isTraining ? 'TRAINING IN PROGRESS...' : 'WAKE UP (CLOSE)'}
                        </button>
                    </div>
                    <div className="flex-1 bg-black rounded-lg border border-slate-800 p-4 font-mono text-xs overflow-y-auto custom-scrollbar shadow-inner">
                        {trainingLogs.map((log, i) => (
                            <div key={i} className={`mb-1 ${log.type === 'error' ? 'text-red-400' : 'text-purple-200/80'}`}>
                                <span className="opacity-30 mr-2">[{new Date().toLocaleTimeString()}]</span>
                                {log.message}
                            </div>
                        ))}
                        <div ref={terminalEndRef} />
                    </div>
                </div>
            )}

            {/* Control Mouse Mapping effect */}
            {/* Note: React-Force-Graph exposes THREE controls via ref, handle in useEffect */}

            {data.nodes.length > 0 && dimensions.width > 0 && dimensions.height > 0 ? (
                <ForceGraph3D
                    ref={fgRef}
                    graphData={data}
                    width={dimensions.width}
                    height={dimensions.height}
                    nodeLabel="name"
                    nodeAutoColorBy="label"

                    // Visuals
                    nodeColor={(node: any) => highlightNodes.size > 0 && !highlightNodes.has(node.id) ? GRAPH_CONFIG.COLORS.DIMMED : node.color}
                    nodeVal={(node: any) => nodeSize} // Use State
                    nodeResolution={GRAPH_CONFIG.NODE_RESOLUTION}

                    linkWidth={1}
                    linkColor={(link: any) => highlightNodes.size > 0 && !highlightNodes.has(link.source.id) && !highlightNodes.has(link.target.id) ? 'rgba(0,0,0,0)' : GRAPH_CONFIG.COLORS.LINK}

                    onNodeHover={handleNodeHover as any}
                    onNodeClick={handleNodeClick as any}

                    backgroundColor="rgba(0,0,0,0)"
                    showNavInfo={false}

                    // Controls
                    controlType={mode === 'PAN' ? 'orbit' : 'orbit'} // ForceGraph3D handles this via config really, but we can hack it or just use mouse buttons
                />
            ) : (
                <div className="flex items-center justify-center h-full text-white/40">
                    {loading ? 'Loading training data...' : 'No training data available'}
                </div>
            )}
        </div>
    );

    if (isExpanded) {
        return (
            <>
                <div className="h-full w-full opacity-0 pointer-events-none" />
                {createPortal(content, document.body)}
            </>
        );
    }

    return content;
};

export default TrainingGraph;
