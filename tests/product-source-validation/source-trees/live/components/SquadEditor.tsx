import React, { useState } from 'react';
import { Agent } from '../types';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';
import { api } from '../utils/api';

interface SquadEditorProps {
    agents: Agent[];
}

const SQUADS = [
    { id: 'TEAM_INSTALL', name: '💾 Installation (Setup)' },
    { id: 'TEAM_CORE', name: '🧠 Core (Cognition)' },
    { id: 'TEAM_STRATEGY', name: '🎯 Strategy (Planning)' },
    { id: 'TEAM_CONTEXT', name: '📚 Context (Memory)' },
    { id: 'TEAM_SCIENCE', name: '🔬 Research (Curiosity)' },
    { id: 'TEAM_DEV', name: '⚡ Dev (Execution)' },
    { id: 'TEAM_OPTIMIZE', name: '⚙️ Optimization (QA)' },
    { id: 'TEAM_QA', name: '🛡️ QA (Safety)' },
    { id: 'TEAM_FIX', name: '🔧 Remediation' },
    { id: 'TEAM_INTEGRATION', name: '🧩 Integration' },
    { id: 'TEAM_MKT', name: '🎨 Marketing (Creative)' }
];

export const SquadEditor: React.FC<SquadEditorProps> = ({ agents }) => {
    const [draggingAgent, setDraggingAgent] = useState<string | null>(null);
    // Local state for optimistic updates
    const [optimisticAgents, setOptimisticAgents] = useState<Agent[]>(agents);

    // Sync prop changes to local state
    React.useEffect(() => {
        setOptimisticAgents(agents);
    }, [agents]);

    const agentsBySquad = SQUADS.reduce((acc, squad) => {
        acc[squad.id] = optimisticAgents.filter(a => a.teamId === squad.id);
        return acc;
    }, {} as Record<string, Agent[]>);

    const onDragStart = (e: React.DragEvent, agentId: string) => {
        e.dataTransfer.setData("agentId", agentId);
        setDraggingAgent(agentId);
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const onDrop = async (e: React.DragEvent, targetSquadId: string) => {
        const agentId = e.dataTransfer.getData("agentId");

        console.log(`[SquadEditor] Dropped ${agentId} into ${targetSquadId}`);

        // 1. OPTIMISTIC UPDATE
        const previousAgents = [...optimisticAgents];
        setOptimisticAgents(prev => prev.map(a =>
            a.id === agentId ? { ...a, teamId: targetSquadId } : a
        ));

        try {
            // 2. BACKEND CALL
            const res = await api.post('/v1/orchestrator/reassign', {
                agentId,
                targetSquadId
            });
            console.log("[SquadEditor] Reassignment Success:", res);
        } catch (err) {
            console.error("[SquadEditor] Reassignment failed", err);
            alert("Failed to reassign agent. Reverting change.");

            // 3. REVERT ON FAILURE
            setOptimisticAgents(previousAgents);
        }

        setDraggingAgent(null);
    };

    return (
        <div style={{ display: 'flex', gap: '10px', padding: '20px', overflowX: 'auto', background: '#111', borderRadius: '8px' }}>
            {SQUADS.map(squad => (
                <div
                    key={squad.id}
                    onDragOver={onDragOver}
                    onDrop={(e) => onDrop(e, squad.id)}
                    style={{
                        flex: '0 0 200px',
                        minHeight: '300px',
                        background: '#1a1a1a',
                        padding: '10px',
                        borderRadius: '6px',
                        border: draggingAgent ? '1px dashed #444' : '1px solid #333'
                    }}
                >
                    <h4 style={{ color: '#888', marginBottom: '10px', fontSize: '0.9rem' }}>{squad.name}</h4>

                    {agentsBySquad[squad.id]?.map(agent => (
                        <div
                            key={agent.id}
                            draggable
                            onDragStart={(e) => onDragStart(e, agent.id)}
                            style={{
                                background: '#222',
                                padding: '8px',
                                marginBottom: '8px',
                                borderRadius: '4px',
                                cursor: 'grab',
                                borderLeft: `3px solid ${getStatusColor(agent.status)}`,
                                fontSize: '0.8rem',
                                color: '#eee'
                            }}
                        >
                            <strong>{agent.name}</strong>
                            <div style={{ fontSize: '0.7rem', color: '#666' }}>{agent.role}</div>
                        </div>
                    ))}

                    {agentsBySquad[squad.id]?.length === 0 && (
                        <div style={{ padding: '20px', color: '#444', fontStyle: 'italic', fontSize: '0.8rem', textAlign: 'center' }}>
                            Empty Squad
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

// Helper for status colors
function getStatusColor(status: string) {
    switch (status) {
        case 'IDLE': return '#666';
        case 'WORKING': return '#0f0';
        case 'THINKING': return '#0ff';
        case 'WAITING': return '#FFA500';
        default: return '#f00';
    }
}
