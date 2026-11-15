import React, { useRef, useState, useEffect } from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, Cell } from 'recharts';
import { NeuroLinkNode, NeuroLinkStatus } from '../types';

interface TopologyVisualizerProps {
    nodes: NeuroLinkNode[];
    height?: string;
}

export const TopologyVisualizer: React.FC<TopologyVisualizerProps> = ({ nodes, height = '200px' }) => {
    // [ROBUSTNESS] Zero-Dimension Fix for Recharts
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!containerRef.current) return;

        const updateDimensions = () => {
            if (containerRef.current) {
                const { offsetWidth, offsetHeight } = containerRef.current;
                setDimensions(prev => {
                    if (Math.abs(prev.width - offsetWidth) < 2 && Math.abs(prev.height - offsetHeight) < 2) return prev;
                    return { width: offsetWidth, height: offsetHeight };
                });
            }
        };

        updateDimensions();
        const observer = new ResizeObserver(updateDimensions);
        observer.observe(containerRef.current);

        return () => observer.disconnect();
    }, []);

    // Transform nodes into scatter data
    const data = nodes.map((node, index) => {
        const angle = (index / (nodes.length || 1)) * 2 * Math.PI;
        const r = 50 + (Math.random() * 20);
        return {
            x: 100 + r * Math.cos(angle),
            y: 100 + r * Math.sin(angle),
            z: node.latency,
            name: node.projectId,
            status: node.status,
            cpu: node.resources.cpu
        };
    });

    // Add Central Hub
    data.push({ x: 100, y: 100, z: 100, name: 'SILHOUETTE CORE', status: NeuroLinkStatus.CONNECTED, cpu: 0 });

    return (
        <div
            ref={containerRef}
            className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden relative"
            style={{ height, minHeight: '100px' }}
        >
            <div className="absolute top-2 left-2 text-[10px] text-slate-500 font-mono z-10">
                NEURO-LINK TOPOLOGY
            </div>
            {dimensions.width > 0 && dimensions.height > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <XAxis type="number" dataKey="x" name="x" hide domain={[0, 200]} />
                        <YAxis type="number" dataKey="y" name="y" hide domain={[0, 200]} />
                        <ZAxis type="number" dataKey="z" range={[50, 400]} name="latency" />
                        <Tooltip
                            cursor={{ strokeDasharray: '3 3' }}
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const d = payload[0].payload;
                                    return (
                                        <div className="bg-slate-900 border border-cyan-500/50 p-2 rounded text-xs text-white shadow-xl">
                                            <p className="font-bold">{d.name}</p>
                                            <p className="text-slate-400">Status: {d.status}</p>
                                            {d.cpu > 0 && <p className="text-slate-400">CPU: {d.cpu.toFixed(0)}%</p>}
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Scatter name="Nodes" data={data} fill="#8884d8">
                            {data.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={entry.name === 'SILHOUETTE CORE' ? '#06b6d4' : (entry.status === NeuroLinkStatus.CONNECTED ? '#22c55e' : '#eab308')}
                                />
                            ))}
                        </Scatter>
                    </ScatterChart>
                </ResponsiveContainer>
            )}
        </div>
    );
};

