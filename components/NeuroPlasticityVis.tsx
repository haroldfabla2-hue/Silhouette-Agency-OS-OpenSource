
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SystemProtocol, ProtocolEvent } from '../types';
import { systemBus } from '../services/systemBus';
import { Brain, Zap, Database, Activity, Terminal } from 'lucide-react';

interface NeuralNode {
    id: string;
    x: number;
    y: number;
    connections: string[]; // IDs of connected nodes
    tier: 'SHORT' | 'LONG' | 'DEEP';
    charge: number; // 0-1 (Brightness)
}

interface LogEntry {
    id: string;
    timestamp: number;
    message: string;
    type: 'log' | 'event' | 'error';
}

const NeuroPlasticityVis: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [nodes, setNodes] = useState<NeuralNode[]>([]);
    const [isDreaming, setIsDreaming] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [stats, setStats] = useState({
        memories: 0,
        trainingExamples: 0,
        epochs: 0
    });

    // --- INITIALIZE RANDOM NETWORK ---
    useEffect(() => {
        const initialNodes: NeuralNode[] = [];
        for (let i = 0; i < 30; i++) {
            initialNodes.push({
                id: `init-${i}`,
                x: Math.random() * 800,
                y: Math.random() * 600,
                connections: [],
                tier: 'SHORT',
                charge: Math.random() * 0.5
            });
        }
        // Create random connections
        initialNodes.forEach(node => {
            const numConns = Math.floor(Math.random() * 3) + 1;
            for (let j = 0; j < numConns; j++) {
                const target = initialNodes[Math.floor(Math.random() * initialNodes.length)];
                if (target.id !== node.id) node.connections.push(target.id);
            }
        });
        setNodes(initialNodes);
    }, []);

    // --- EVENT SUBSCRIPTIONS ---
    useEffect(() => {
        const addLog = (msg: string, type: 'log' | 'event' | 'error' = 'log') => {
            setLogs(prev => [{ id: Math.random().toString(), timestamp: Date.now(), message: msg, type }, ...prev].slice(0, 50));
        };

        const subs = [
            systemBus.subscribe(SystemProtocol.MEMORY_CREATED, (e) => {
                addLog(`Memory Created: ${e.payload.content?.substring(0, 30)}...`, 'event');
                setStats(s => ({ ...s, memories: s.memories + 1 }));
                // Trigger Visual Spike
                triggerSpike();
            }),
            systemBus.subscribe(SystemProtocol.TRAINING_EXAMPLE_FOUND, (e) => {
                addLog(`Training Example Captured: [${e.payload.tags?.join(',')}]`, 'event');
                setStats(s => ({ ...s, trainingExamples: s.trainingExamples + 1 }));
                triggerSpike(true);
            }),
            systemBus.subscribe(SystemProtocol.TRAINING_START, () => {
                addLog("--- SLEEP CYCLE INITIATED (TRAINING) ---", 'event');
                setIsDreaming(true);
            }),
            systemBus.subscribe(SystemProtocol.TRAINING_COMPLETE, () => {
                addLog("--- SLEEP CYCLE COMPLETE ---", 'event');
                setIsDreaming(false);
                setStats(s => ({ ...s, epochs: s.epochs + 1 }));
            }),
            systemBus.subscribe(SystemProtocol.TRAINING_LOG, (e) => {
                addLog(`[TRAINER]: ${e.payload.message}`, 'log');
            })
        ];

        return () => subs.forEach(u => u());
    }, []);

    const triggerSpike = (intense = false) => {
        setNodes(prev => prev.map(n => ({
            ...n,
            charge: Math.random() > 0.8 ? (intense ? 1.0 : 0.8) : n.charge
        })));
    };

    // --- CANVAS RENDER LOOP ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Background Pulse (Dreaming)
            if (isDreaming) {
                ctx.fillStyle = `rgba(100, 50, 255, ${0.05 + Math.sin(Date.now() / 1000) * 0.02})`;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            // Draw Connections
            ctx.lineWidth = 1;
            nodes.forEach(node => {
                node.connections.forEach(targetId => {
                    const target = nodes.find(n => n.id === targetId);
                    if (target) {
                        const dist = Math.hypot(target.x - node.x, target.y - node.y);
                        const opacity = (node.charge + target.charge) / 2 * (1 - dist / 500);
                        if (opacity > 0) {
                            ctx.strokeStyle = isDreaming ? `rgba(200, 100, 255, ${opacity})` : `rgba(0, 255, 200, ${opacity})`;
                            ctx.beginPath();
                            ctx.moveTo(node.x, node.y);
                            ctx.lineTo(target.x, target.y);
                            ctx.stroke();
                        }
                    }
                });
            });

            // Draw Nodes
            nodes.forEach(node => {
                // Decay charge
                node.charge *= 0.95;
                if (node.charge < 0.1) node.charge = 0.1;

                // Move slightly
                node.x += (Math.random() - 0.5) * 0.5;
                node.y += (Math.random() - 0.5) * 0.5;

                const size = 3 + node.charge * 5;
                ctx.fillStyle = isDreaming ? '#d946ef' : '#0ea5e9'; // Pink if dreaming, Blue if awake
                ctx.beginPath();
                ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
                ctx.fill();

                // Glow
                if (node.charge > 0.5) {
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = ctx.fillStyle;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            });

            animationFrameId = requestAnimationFrame(render);
        };

        render();
        return () => cancelAnimationFrame(animationFrameId);
    }, [nodes, isDreaming]);

    return (
        <div className="flex h-full gap-4 text-xs font-mono">
            {/* LEFT: VISUALIZATION */}
            <div className="flex-1 relative bg-black/40 rounded-lg border border-slate-800 overflow-hidden group">
                <canvas
                    ref={canvasRef}
                    width={800}
                    height={600}
                    className="w-full h-full opacity-80 group-hover:opacity-100 transition-opacity"
                />

                {/* HUD OVERLAY */}
                <div className="absolute top-4 left-4 flex gap-4">
                    <div className="flex items-center gap-2 bg-black/60 px-3 py-1 rounded border border-slate-700">
                        <Activity className="text-cyan-400" size={14} />
                        <span className="text-cyan-400 font-bold">{stats.memories}</span>
                        <span className="text-slate-500">MEMORIES</span>
                    </div>
                    <div className="flex items-center gap-2 bg-black/60 px-3 py-1 rounded border border-slate-700">
                        <Database className="text-purple-400" size={14} />
                        <span className="text-purple-400 font-bold">{stats.trainingExamples}</span>
                        <span className="text-slate-500">EXAMPLES</span>
                    </div>
                    {isDreaming && (
                        <div className="flex items-center gap-2 bg-fuchsia-900/40 px-3 py-1 rounded border border-fuchsia-500 animate-pulse">
                            <Brain className="text-fuchsia-400" size={14} />
                            <span className="text-fuchsia-300 font-bold">DREAMING</span>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT: REAL-TIME LOGS */}
            <div className="w-80 flex flex-col bg-black/60 border border-slate-800 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-2 bg-slate-900/80 border-b border-slate-800">
                    <div className="flex items-center gap-2 text-slate-400">
                        <Terminal size={14} />
                        <span>SUBCONSCIOUS LOGGER</span>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[10px]">
                    <AnimatePresence>
                        {logs.map((log) => (
                            <motion.div
                                key={log.id}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0 }}
                                className={`
                                    p-1.5 rounded border-l-2
                                    ${log.type === 'event' ? 'border-cyan-500 bg-cyan-950/20 text-cyan-200' : ''}
                                    ${log.type === 'log' ? 'border-slate-600 text-slate-400' : ''}
                                    ${log.type === 'error' ? 'border-red-500 bg-red-950/20 text-red-300' : ''}
                                `}
                            >
                                <span className="text-slate-600 mr-2">
                                    {new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}
                                </span>
                                {log.message}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};

export default NeuroPlasticityVis;
