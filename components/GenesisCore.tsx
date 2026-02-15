import React, { useState, useEffect, useRef } from 'react';
import ReactFlow, { Background, Controls, useNodesState, useEdgesState, Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { NeuroLinkNode } from '../types';

interface GenesisCoreProps {
    nodes: NeuroLinkNode[];
    logs: string[];
    activeCategories: string[];
}

const proOptions = { hideAttribution: true };
const nodeTypes = {};
const edgeTypes = {};

export const GenesisCore: React.FC<GenesisCoreProps> = ({ nodes: propNodes, logs, activeCategories }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    // --- DYNAMIC TOPOLOGY (Real-time Agent Mapping) ---
    const center = { x: 250, y: 150 };
    const radius = 200;

    useEffect(() => {
        if (!propNodes || propNodes.length === 0) return;

        // 1. Create Central Core Node
        const coreNode: Node = {
            id: 'master',
            type: 'input',
            data: { label: 'Silhouette Core' },
            position: { x: center.x, y: center.y },
            style: { background: '#FF0055', color: '#fff', border: 'none', boxShadow: '0 0 20px #FF0055', width: 120, textAlign: 'center' },
            draggable: false
        };

        // 2. Map Agents to Radial Layout
        const uniqueNodes = Array.from(new Map(propNodes.map(node => [node.id, node])).values());

        const agentNodes: Node[] = uniqueNodes.map((agent, i) => {
            const angle = (i / uniqueNodes.length) * 2 * Math.PI;
            return {
                id: agent.id,
                data: { label: agent.category ? `${agent.category}: ${agent.id.substring(0, 4)}` : agent.id },
                position: {
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle)
                },
                style: {
                    background: agent.status === 'CONNECTED' ? '#111' : '#333',
                    color: '#fff',
                    border: agent.status === 'CONNECTED' ? '1px solid #0ff' : '1px solid #555',
                    fontSize: '10px',
                    width: 100,
                    textAlign: 'center'
                },
            };
        });

        // 3. Create Edges
        const dynamicEdges: Edge[] = uniqueNodes.map(agent => ({
            id: `e-master-${agent.id}`,
            source: 'master',
            target: agent.id,
            animated: agent.status === 'CONNECTED',
            style: { stroke: agent.status === 'CONNECTED' ? '#0ff' : '#555', strokeWidth: agent.status === 'CONNECTED' ? 2 : 1 }
        }));

        setNodes([coreNode, ...agentNodes]);
        setEdges(dynamicEdges);

    }, [propNodes, setNodes, setEdges]);

    // Terminal Logic (Simplified for brevity, assuming it was there before)
    useEffect(() => {
        if (!terminalRef.current || xtermRef.current) return;

        const term = new Terminal({
            theme: { background: '#000000', foreground: '#00ff00' },
            fontSize: 12,
            rows: 10
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);

        // Fix: Wait for layout to settle before fitting
        setTimeout(() => {
            fitAddon.fit();
        }, 100);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        term.writeln('Welcome to Silhouette Genesis Core v2.0');

        return () => {
            term.dispose();
        };
    }, []);

    // Log Streaming
    useEffect(() => {
        if (xtermRef.current && logs.length > 0) {
            const lastLog = logs[logs.length - 1];
            xtermRef.current.writeln(`> ${lastLog}`);
        }
    }, [logs]);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: '200px', position: 'relative' }}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    fitView
                    proOptions={proOptions}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                >
                    <Background color="#222" gap={16} />
                    <Controls />
                </ReactFlow>
            </div>
            <div style={{ height: '150px', background: '#000', padding: '5px' }}>
                <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
            </div>
        </div>
    );
}
