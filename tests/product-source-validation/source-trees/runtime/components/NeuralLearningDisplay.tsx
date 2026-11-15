
import React, { useState, useEffect } from 'react';
import { Activity, Brain, CheckCircle, Database, GitBranch, Terminal, Zap, Loader } from 'lucide-react';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

interface LearningEvent {
    id: string;
    type: 'EUREKA' | 'TRAINING_START' | 'TRAINING_STEP' | 'TRAINING_COMPLETE' | 'GRAPH_UPDATE';
    message: string;
    timestamp: number;
    details?: any;
}

const NeuralLearningDisplay: React.FC = () => {
    const [events, setEvents] = useState<LearningEvent[]>([]);
    const [isTraining, setIsTraining] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        // --- LISTENERS ---

        // 1. EUREKA MOMENTS
        const unsubEureka = systemBus.subscribe(SystemProtocol.INTUITION_CONSOLIDATED, (e) => {
            addEvent('EUREKA', `Eureka Moment: "${e.payload.idea.substring(0, 40)}..."`, e.payload);
        });

        // 2. TRAINING START
        const unsubTrainStart = systemBus.subscribe(SystemProtocol.TRAINING_START, (e) => {
            setIsTraining(true);
            setProgress(0);
            addEvent('TRAINING_START', "Initiating Neural Plasticity Cycle...", e.payload);
        });

        // 3. TRAINING LOGS
        const unsubTrainLog = systemBus.subscribe(SystemProtocol.TRAINING_LOG, (e) => {
            if (e.payload.type === 'log') {
                // Heuristic progress estimation based on log content
                if (e.payload.message.includes('Step')) {
                    setProgress(prev => Math.min(prev + 5, 90));
                    addEvent('TRAINING_STEP', e.payload.message, null);
                } else if (e.payload.message.includes('Save')) {
                    setProgress(95);
                    addEvent('TRAINING_STEP', "Saving Weights...", null);
                }
            }
        });

        // 4. TRAINING COMPLETE
        const unsubTrainComplete = systemBus.subscribe(SystemProtocol.TRAINING_COMPLETE, (e) => {
            setIsTraining(false);
            setProgress(100);
            const status = e.payload.success ? "Success" : "Failed";
            addEvent('TRAINING_COMPLETE', `Neural Synapse Updated: ${status}`, e.payload);

            // Auto-clear success state after 5 seconds to reset visual
            if (e.payload.success) {
                setTimeout(() => setProgress(0), 5000);
            }
        });

        return () => {
            unsubEureka();
            unsubTrainStart();
            unsubTrainLog();
            unsubTrainComplete();
        };
    }, []);

    const addEvent = (type: LearningEvent['type'], message: string, details: any) => {
        setEvents(prev => [{
            id: Date.now().toString() + Math.random(),
            type,
            message,
            timestamp: Date.now(),
            details
        }, ...prev].slice(0, 8)); // Keep last 8 events
    };

    return (
        <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 font-mono text-sm relative overflow-hidden">
            {/* HEADER */}
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2">
                <div className="flex items-center gap-2 text-indigo-400">
                    <Brain className="w-4 h-4" />
                    <span className="font-bold tracking-wider">NEURAL PLASTICITY MONITOR</span>
                </div>
                {isTraining && (
                    <div className="flex items-center gap-2 text-xs text-yellow-400 animate-pulse">
                        <Activity className="w-3 h-3" />
                        <span>SYNAPTIC FORGE ACTIVE</span>
                    </div>
                )}
            </div>

            {/* PROGRESS BAR (Only visible during learning) */}
            <div className={`transition-all duration-500 overflow-hidden ${isTraining ? 'h-6 opacity-100 mb-4' : 'h-0 opacity-0 mb-0'}`}>
                <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                        className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Introspection</span>
                    <span>Consolidation</span>
                    <span>Integration</span>
                </div>
            </div>

            {/* EVENT LOG */}
            <div className="space-y-3">
                {events.length === 0 && (
                    <div className="text-gray-600 text-center py-4 italic">
                        Waiting for neural activity...
                    </div>
                )}
                {events.map((evt) => (
                    <div key={evt.id} className="flex gap-3 items-start animate-in fade-in slide-in-from-left-4 duration-300">
                        {/* ICON */}
                        <div className="mt-0.5 shrink-0">
                            {evt.type === 'EUREKA' && <Zap className="w-4 h-4 text-yellow-400" />}
                            {evt.type === 'TRAINING_START' && <Database className="w-4 h-4 text-blue-400" />}
                            {evt.type === 'TRAINING_STEP' && <Terminal className="w-4 h-4 text-gray-400" />}
                            {evt.type === 'TRAINING_COMPLETE' && <CheckCircle className="w-4 h-4 text-green-400" />}
                            {evt.type === 'GRAPH_UPDATE' && <GitBranch className="w-4 h-4 text-purple-400" />}
                        </div>

                        {/* CONTENT */}
                        <div className="flex-1 min-w-0">
                            <div className={`leading-none ${evt.type === 'EUREKA' ? 'text-yellow-100 font-bold' :
                                    evt.type === 'TRAINING_COMPLETE' ? 'text-green-100 font-bold' :
                                        'text-gray-300'
                                }`}>
                                {evt.message}
                            </div>
                            <div className="text-[10px] text-gray-600 mt-1">
                                {new Date(evt.timestamp).toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* DECORATIVE BACKGROUND */}
            <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                <DnaIcon className="w-32 h-32 text-indigo-500" />
            </div>
        </div>
    );
};

// Simple SVG Component for Decoration
const DnaIcon = (props: any) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
    >
        <path d="M2 15c6.667-6 13.333 0 20-6" />
        <path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993" />
        <path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993" />
        <path d="M17 6l-2.5-2.5" />
        <path d="M14 8l-1-1" />
        <path d="M7 18l2.5 2.5" />
        <path d="M3.5 14.5l-1 1" />
        <path d="M20.5 9.5l1-1" />
        <path d="M14.5 9.5L9.5 14.5" />
    </svg>
);

export default NeuralLearningDisplay;
