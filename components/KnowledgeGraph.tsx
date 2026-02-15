import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ForceGraph3D from 'react-force-graph-3d';
import { Maximize2, RefreshCw, Minimize2, MousePointer2, Move, ZoomIn, ZoomOut, Settings, X, Info } from 'lucide-react';
import { api } from '../utils/api';
import * as THREE from 'three';

// --- STRICT TYPES ---
interface GraphNode {
    id: string;
    label: string;
    name?: string;
    val?: number;
    color?: string;
    x?: number;
    y?: number;
    z?: number;
    [key: string]: any; // Allow extra properties from Neo4j
}

interface GraphLink {
    source: string | GraphNode;
    target: string | GraphNode;
    id?: string;
    [key: string]: any;
}

interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
}

type InteractionMode = 'ROTATE' | 'PAN';

// --- CONFIGURATION CONSTANTS ---
const GRAPH_CONFIG = {
    REFRESH_INTERVAL: 5000,
    ANIMATION_DURATION: 2000,
    // VISUAL TUNING (User Request: Smaller nodes to see connections)
    NODE_REL_SIZE: 4, // Reduced from 6
    NODE_VAL_COMMUNITY: 20, // Reduced from 40
    NODE_VAL_DEFAULT: 5, // Reduced from 8
    NODE_RESOLUTION: 32,
    LINK_WIDTH_DEFAULT: 0.5,
    LINK_WIDTH_HIGHLIGHT: 2,
    PARTICLE_WIDTH: 3,
    COLORS: {
        COMMUNITY: '#ff00ff',
        DEFAULT_NODE: 'rgba(255,255,255,0.9)',
        DIMMED_NODE: 'rgba(255,255,255,0.05)',
        DEFAULT_LINK: 'rgba(100,200,255,0.2)',
        DIMMED_LINK: 'rgba(255,255,255,0.05)',
        HIGHLIGHT_PARTICLE: '#ffffff'
    },
    CONTROLS: {
        DAMPING: 0.1,
        ROTATE_SPEED: 0.3,
        ZOOM_SPEED: 1.0,
        PAN_SPEED: 1.0
    }
};

const KnowledgeGraph: React.FC = () => {
    const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);
    const [mode, setMode] = useState<InteractionMode>('ROTATE');

    // Refs for performance and stability
    const fgRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dataRef = useRef<GraphData>({ nodes: [], links: [] });
    const lastDataStr = useRef<string>("");
    const isFirstLoad = useRef(true);

    // Dynamic Sizing State
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Interaction State
    const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
    const [highlightLinks, setHighlightLinks] = useState<Set<GraphLink>>(new Set());
    const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);

    const [error, setError] = useState<string | null>(null);

    // Physics Controls State (with Persistence)
    // [UI FIX 2026-01-07] Made these adjustable via sliders with wider ranges
    const [nodeSize, setNodeSize] = useState(() => Number(localStorage.getItem('graph_nodeSize')) || 5);
    const [repulsion, setRepulsion] = useState(() => Number(localStorage.getItem('graph_repulsion')) || 100);
    const [linkDistance, setLinkDistance] = useState(() => Number(localStorage.getItem('graph_linkDistance')) || 50);

    // NEW: Control panel visibility and selected node for details
    const [showControls, setShowControls] = useState(false);
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [connectedNodes, setConnectedNodes] = useState<string[]>([]);

    // [HUB VISUALIZATION] Calculate node degrees from links
    // This creates a Map of nodeId -> connectionCount for Hub visualization
    const nodeDegreeMap = useMemo(() => {
        const degreeMap = new Map<string, number>();
        for (const link of data.links) {
            const sourceId = typeof link.source === 'object' ? (link.source as GraphNode).id : link.source;
            const targetId = typeof link.target === 'object' ? (link.target as GraphNode).id : link.target;
            degreeMap.set(sourceId, (degreeMap.get(sourceId) || 0) + 1);
            degreeMap.set(targetId, (degreeMap.get(targetId) || 0) + 1);
        }
        return degreeMap;
    }, [data.links]);

    // Save Settings on Change
    useEffect(() => {
        localStorage.setItem('graph_nodeSize', String(nodeSize));
        localStorage.setItem('graph_repulsion', String(repulsion));
        localStorage.setItem('graph_linkDistance', String(linkDistance));
    }, [nodeSize, repulsion, linkDistance]);

    // Apply Physics on Change
    useEffect(() => {
        if (fgRef.current) {
            fgRef.current.d3Force('charge').strength(-repulsion);
            fgRef.current.d3Force('link').distance(linkDistance);
        }
    }, [repulsion, linkDistance, data]); // Re-apply when data updates too

    const fetchGraph = useCallback(async () => {
        try {
            const graphData = await api.get<any>('/v1/graph/visualize'); // Connect to real endpoint

            // Validate data structure to avoid crashes
            if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.links)) {
                console.warn("KnowledgeGraph: Invalid data structure from API", graphData);
                return;
            }

            const { nodes, links } = graphData;

            // Check for changes to avoid re-renders
            const dataStr = JSON.stringify({ n: nodes.length, l: links.length, n1: nodes[0]?.id });
            if (dataStr === lastDataStr.current && !isFirstLoad.current) return;
            lastDataStr.current = dataStr;

            // Create node ID set for link validation
            const nodeIdSet = new Set(nodes.map((n: any) => n.id));

            // Filter links: only keep links whose source and target exist in nodes
            const validLinks = links.filter((link: any) => {
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                return nodeIdSet.has(sourceId) && nodeIdSet.has(targetId);
            });

            // Preserve existing physics state
            const currentNodesMap = new Map(dataRef.current.nodes.map(n => [n.id, n]));
            const mergedNodes = nodes.map((n: any) => {
                const existing = currentNodesMap.get(n.id);
                return existing ? Object.assign(existing, n) : n;
            });

            const finalData = { nodes: mergedNodes, links: validLinks };
            dataRef.current = finalData;
            setData(finalData);
            setLoading(false);

            if (isFirstLoad.current) {
                isFirstLoad.current = false;
                // Initial camera positioning could go here
            }

        } catch (e: any) {
            console.error(`KnowledgeGraph: Fetch failed ${e.message}`);
            setError(e.message);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Initial fetch
        fetchGraph();

        // Polling interaction
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
                if (width > 0 && height > 0) {
                    setDimensions({ width, height });
                }
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

    // Handle node click - show details popup
    const handleNodeClick = (node: GraphNode | null) => {
        if (!node) {
            setSelectedNode(null);
            return;
        }

        // Find connected nodes
        const connected: string[] = [];
        data.links.forEach((link: any) => {
            if (link.source.id === node.id) connected.push(link.target.label || link.target.id);
            if (link.target.id === node.id) connected.push(link.source.label || link.source.id);
        });
        setConnectedNodes(connected);
        setSelectedNode(node);

        // Also move camera to node
        if (fgRef.current) {
            const distance = 100;
            const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
            fgRef.current.cameraPosition(
                { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
                node as any,
                1000
            );
        }
    };

    const toggleExpand = () => setIsExpanded(!isExpanded);

    // Zoom Helpers
    const handleZoom = (direction: number) => {
        if (fgRef.current) {
            const cam = fgRef.current.camera();
            // Simple zoom by moving camera along Z vector or just distance change
            // ForceGraph3D doesn't have a direct 'zoom' method on ref, usually manipulate camera
            // Or use graph2d method. For 3D typically we move the camera. 
            // Using underlying Threejs controls or distance.
            // Accessing internal threejs camera via fgRef.current.camera()
            const currentPos = cam.position;
            // Naive zoom: move closer/further
            const factor = direction > 0 ? 0.8 : 1.2;
            fgRef.current.cameraPosition(
                { x: currentPos.x * factor, y: currentPos.y * factor, z: currentPos.z * factor },
                null, // lookAt (keep same)
                500   // ms transition
            );
        }
    };

    const graphContent = (
        <div
            ref={containerRef}
            className={`transition-all duration-300 relative ${isExpanded ? 'fixed inset-0 z-50 bg-black' : 'flex-1 min-h-[400px]'}`}
        >
            {/* TOOLBAR OVERLAY */}
            <div className="absolute top-4 right-4 z-10 flex gap-2">
                <div className="flex bg-neutral-900/80 backdrop-blur rounded-lg p-1 border border-white/10">
                    <button
                        onClick={() => setMode('ROTATE')}
                        className={`p-1.5 rounded ${mode === 'ROTATE' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/40 hover:text-white'}`}
                        title="Rotate Camera"
                    >
                        <MousePointer2 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setMode('PAN')}
                        className={`p-1.5 rounded ${mode === 'PAN' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/40 hover:text-white'}`}
                        title="Pan Camera"
                    >
                        <MousePointer2 className="w-4 h-4" />
                    </button>
                </div>

                <button
                    onClick={fetchGraph}
                    className="p-2 bg-neutral-900/80 backdrop-blur rounded-lg hover:bg-white/10 text-white/60 hover:text-cyan-400 border border-white/10 transition-colors"
                    title="Refresh Data"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>

                <button
                    onClick={toggleExpand}
                    className="p-2 bg-neutral-900/80 backdrop-blur rounded-lg hover:bg-white/10 text-white/60 hover:text-purple-400 border border-white/10 transition-colors"
                    title={isExpanded ? "Exit Fullscreen" : "Fullscreen"}
                >
                    {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>

                {/* Settings Toggle */}
                <button
                    onClick={() => setShowControls(!showControls)}
                    className={`p-2 bg-neutral-900/80 backdrop-blur rounded-lg hover:bg-white/10 border border-white/10 transition-colors ${showControls ? 'text-yellow-400' : 'text-white/60 hover:text-yellow-400'}`}
                    title="Graph Controls"
                >
                    <Settings className="w-4 h-4" />
                </button>
            </div>

            {/* CONTROL PANEL - Physics Sliders */}
            {showControls && (
                <div className="absolute top-16 right-4 z-20 bg-neutral-900/95 backdrop-blur-lg rounded-lg p-4 border border-white/10 w-64">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-white font-bold text-sm">Graph Controls</h3>
                        <button onClick={() => setShowControls(false)} className="text-white/40 hover:text-white">
                            <X size={14} />
                        </button>
                    </div>

                    <div className="space-y-4">
                        {/* Node Size Slider */}
                        <div>
                            <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>Node Size</span>
                                <span className="text-cyan-400">{nodeSize}</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="100"
                                value={nodeSize}
                                onChange={(e) => setNodeSize(Number(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                            />
                        </div>

                        {/* Repulsion Slider */}
                        <div>
                            <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>Repulsion (Spread)</span>
                                <span className="text-purple-400">{repulsion}</span>
                            </div>
                            <input
                                type="range"
                                min="10"
                                max="1000"
                                value={repulsion}
                                onChange={(e) => setRepulsion(Number(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
                        </div>

                        {/* Link Distance Slider */}
                        <div>
                            <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>Link Distance</span>
                                <span className="text-orange-400">{linkDistance}</span>
                            </div>
                            <input
                                type="range"
                                min="10"
                                max="500"
                                value={linkDistance}
                                onChange={(e) => setLinkDistance(Number(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                            />
                        </div>

                        {/* Reset Button */}
                        <button
                            onClick={() => {
                                setNodeSize(5);
                                setRepulsion(100);
                                setLinkDistance(50);
                            }}
                            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors"
                        >
                            Reset to Defaults
                        </button>
                    </div>
                </div>
            )}

            {/* NODE DETAIL POPUP */}
            {selectedNode && (
                <div className="absolute bottom-16 left-4 z-20 bg-neutral-900/95 backdrop-blur-lg rounded-lg p-4 border border-cyan-500/30 w-80 max-h-[300px] overflow-y-auto">
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                            <Info size={16} className="text-cyan-400" />
                            <h3 className="text-white font-bold text-sm">Node Details</h3>
                        </div>
                        <button onClick={() => setSelectedNode(null)} className="text-white/40 hover:text-white">
                            <X size={14} />
                        </button>
                    </div>

                    <div className="space-y-2 text-xs">
                        <div>
                            <span className="text-slate-500">Label:</span>
                            <span className="text-white ml-2 font-mono">{selectedNode.label}</span>
                        </div>

                        <div>
                            <span className="text-slate-500">ID:</span>
                            <span className="text-slate-400 ml-2 font-mono text-[10px] break-all">{selectedNode.id}</span>
                        </div>

                        {selectedNode.tier && (
                            <div>
                                <span className="text-slate-500">Tier:</span>
                                <span className="text-purple-400 ml-2">{selectedNode.tier}</span>
                            </div>
                        )}

                        {selectedNode.content && (
                            <div>
                                <span className="text-slate-500 block mb-1">Content:</span>
                                <p className="text-slate-300 bg-black/30 p-2 rounded text-[10px] leading-relaxed max-h-20 overflow-y-auto">
                                    {selectedNode.content}
                                </p>
                            </div>
                        )}

                        {selectedNode.tags && selectedNode.tags.length > 0 && (
                            <div>
                                <span className="text-slate-500 block mb-1">Tags:</span>
                                <div className="flex flex-wrap gap-1">
                                    {selectedNode.tags.map((tag: string, i: number) => (
                                        <span key={i} className="px-1.5 py-0.5 bg-cyan-900/30 border border-cyan-500/30 rounded text-cyan-300 text-[9px]">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {connectedNodes.length > 0 && (
                            <div>
                                <span className="text-slate-500 block mb-1">Connected to ({connectedNodes.length}):</span>
                                <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                                    {connectedNodes.slice(0, 10).map((node, i) => (
                                        <span key={i} className="px-1.5 py-0.5 bg-purple-900/30 border border-purple-500/30 rounded text-purple-300 text-[9px]">
                                            {node}
                                        </span>
                                    ))}
                                    {connectedNodes.length > 10 && (
                                        <span className="text-slate-500 text-[9px]">+{connectedNodes.length - 10} more</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex-1 flex items-center justify-center text-cyan-500/50 animate-pulse">
                    Initializing Neural Matrix...
                </div>
            ) : (
                <div style={{ width: '100%', height: '100%' }}>
                    {dimensions.width > 0 && dimensions.height > 0 && (
                        <ForceGraph3D
                            ref={fgRef}
                            graphData={data}
                            width={isExpanded ? window.innerWidth : dimensions.width}
                            height={isExpanded ? window.innerHeight : dimensions.height}
                            nodeLabel={(node: any) => {
                                // Show more meaningful labels including degree
                                const label = node.label || 'Unknown';
                                const content = node.content ? node.content.substring(0, 50) + '...' : '';
                                const degree = nodeDegreeMap.get(node.id) || 0;
                                const hubIndicator = degree >= 10 ? ' [HUB]' : '';
                                return `${label}${hubIndicator} (${degree} connections)${content ? '\n' + content : ''}`;
                            }}
                            nodeAutoColorBy="label"

                            // [HUB VISUALIZATION] Degree-based coloring
                            // Blue (low) → Cyan → Yellow → Red (high/Hub)
                            nodeColor={(node: any) => {
                                if (hoverNode && !highlightNodes.has(node.id)) return GRAPH_CONFIG.COLORS.DIMMED_NODE;

                                const degree = nodeDegreeMap.get(node.id) || 0;
                                if (degree >= 15) return '#ff4444'; // Red: Major Hub
                                if (degree >= 10) return '#ff9933'; // Orange: Hub
                                if (degree >= 5) return '#ffff00';  // Yellow: Mini-Hub
                                if (degree >= 3) return '#00ffff';  // Cyan: Connected
                                return 'rgba(100,200,255,0.8)';     // Blue: Standard
                            }}

                            // [HUB VISUALIZATION] Degree-based sizing
                            // Hubs are visually larger to stand out
                            nodeVal={(node: any) => {
                                const degree = nodeDegreeMap.get(node.id) || 0;
                                const hubMultiplier = Math.min(1 + degree * 0.15, 4); // Max 4x size
                                return nodeSize * hubMultiplier;
                            }}
                            nodeResolution={GRAPH_CONFIG.NODE_RESOLUTION}
                            nodeOpacity={0.9}

                            // Links
                            linkWidth={link => highlightLinks.has(link as GraphLink) ? GRAPH_CONFIG.LINK_WIDTH_HIGHLIGHT : GRAPH_CONFIG.LINK_WIDTH_DEFAULT}
                            linkDirectionalParticles={link => highlightLinks.has(link as GraphLink) ? 4 : 0}
                            linkDirectionalParticleWidth={GRAPH_CONFIG.PARTICLE_WIDTH}
                            linkColor={() => hoverNode ? GRAPH_CONFIG.COLORS.DIMMED_LINK : GRAPH_CONFIG.COLORS.DEFAULT_LINK}
                            linkOpacity={0.3}

                            // Interaction
                            onNodeClick={handleNodeClick as any}
                            onNodeHover={handleNodeHover as any}

                            // Physics
                            backgroundColor="rgba(0,0,0,0)"
                            showNavInfo={false}
                            nodeRelSize={GRAPH_CONFIG.NODE_REL_SIZE}

                            // Stability
                            d3AlphaDecay={0.02}
                            d3VelocityDecay={GRAPH_CONFIG.CONTROLS.DAMPING}
                            warmupTicks={100}
                            onEngineStop={() => {
                                if (isFirstLoad.current && fgRef.current) {
                                    fgRef.current.zoomToFit(400);
                                }
                            }}
                        />
                    )}
                    {(dimensions.width === 0 || dimensions.height === 0) && (
                        <div className="absolute inset-0 flex items-center justify-center text-white/20">
                            Waiting for container...
                        </div>
                    )}
                </div>
            )}

            <div className="absolute bottom-2 right-2 text-[10px] text-slate-600 font-mono pointer-events-none">
                NODES: {data.nodes.length} | EDGES: {data.links.length}
            </div>
        </div>
    );

    if (isExpanded) {
        return (
            <>
                <div className="relative h-[450px] opacity-0 pointer-events-none" /> {/* Placeholder to prevent layout shift */}
                {createPortal(graphContent, document.body)}
            </>
        );
    }

    return graphContent;
};

export default KnowledgeGraph;
