import React, { useState, useEffect } from 'react';
import { systemBus } from '../services/systemBus';
import { SystemProtocol } from '../types';

interface DreamInsight {
    timestamp: number;
    content: string;
    veracity: number;
    outcome: 'ACCEPTED' | 'REJECTED' | 'MYSTERY';
    source?: string;
    narratedBy?: string;
}

export const DreamExplorer: React.FC = () => {
    const [dreams, setDreams] = useState<DreamInsight[]>([]);

    useEffect(() => {
        // Track seen content to prevent duplicates
        const seenHashes = new Set<string>();

        // Subscribe to UNIFIED NARRATED stream (first-person thoughts)
        const unsubscribeNarrative = systemBus.subscribe(SystemProtocol.NARRATIVE_UPDATE, (event) => {
            const payload = event.payload;
            if (!payload) return;

            // [FIX] Deduplicate by content hash
            const contentHash = `${payload.content?.substring(0, 50)}_${payload.source}`;
            if (seenHashes.has(contentHash)) {
                return; // Skip duplicate
            }
            seenHashes.add(contentHash);

            // Clean old hashes to prevent memory leak (keep last 100)
            if (seenHashes.size > 100) {
                const arr = Array.from(seenHashes);
                arr.slice(0, 50).forEach(h => seenHashes.delete(h));
            }

            const newDream: DreamInsight = {
                timestamp: payload.timestamp || Date.now(),
                content: payload.content || "Abstract Pattern",
                veracity: payload.coherence || 0.8,
                outcome: 'ACCEPTED',
                source: payload.source,
                narratedBy: payload.metadata?.narratedBy
            };
            setDreams(prev => [newDream, ...prev].slice(0, 15));
        });

        return () => {
            unsubscribeNarrative();
        };
    }, []);

    return (
        <div style={{ background: '#101015', padding: '15px', borderRadius: '8px', color: '#ccc', fontFamily: 'monospace' }}>
            <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '5px', marginBottom: '10px' }}>
                🌌 Dream Explorer (Subconscious)
            </h3>

            <div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '5px' }}>
                {dreams.length === 0 && (
                    <div style={{ color: '#444', fontStyle: 'italic', padding: '20px', textAlign: 'center' }}>
                        Waiting for REM cycles...
                    </div>
                )}

                {dreams.map((dream, idx) => (
                    <div key={idx} style={{
                        marginBottom: '10px',
                        padding: '10px',
                        background: '#1a1a20',
                        borderRadius: '4px',
                        borderLeft: `3px solid ${getOutcomeColor(dream.outcome)}`
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#666', marginBottom: '5px' }}>
                            <span>{new Date(dream.timestamp).toLocaleTimeString()}</span>
                            <span>Veracity: {(dream.veracity * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', color: '#eee' }}>
                            {dream.content}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

function getOutcomeColor(outcome: string) {
    if (outcome === 'ACCEPTED') return '#0f0'; // Green
    if (outcome === 'REJECTED') return '#f00'; // Red
    return '#a0f'; // Purple (Mystery)
}
