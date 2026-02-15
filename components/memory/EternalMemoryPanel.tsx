/**
 * ETERNAL MEMORY PANEL
 * ═══════════════════════════════════════════════════════════════
 * Displays facts, experiences, and feedback statistics from the
 * self-improvement memory system.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import './EternalMemoryPanel.css';

interface Fact {
    category: string;
    content: string;
    confidence: number;
    timestamp: number;
}

interface Experience {
    id: string;
    type: 'SUCCESS' | 'FAILURE' | 'LEARNING' | 'INSIGHT';
    context: string;
    action: string;
    outcome: string;
    timestamp: number;
}

interface FeedbackStats {
    total: number;
    positive: number;
    negative: number;
    neutral: number;
}

export const EternalMemoryPanel: React.FC = () => {
    const [facts, setFacts] = useState<Fact[]>([]);
    const [experiences, setExperiences] = useState<Experience[]>([]);
    const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'facts' | 'experiences' | 'feedback'>('facts');

    useEffect(() => {
        loadData();
        // Refresh every 30 seconds
        const interval = setInterval(loadData, 30000);
        return () => clearInterval(interval);
    }, []);

    const loadData = async () => {
        try {
            setError(null);

            // Load all data in parallel
            const [factsRes, expRes, feedbackRes] = await Promise.all([
                api.get('/memory/facts').catch(() => ({ data: { facts: [] } })) as Promise<{ data: { facts: Fact[] } }>,
                api.get('/memory/experiences').catch(() => ({ data: { experiences: [] } })) as Promise<{ data: { experiences: Experience[] } }>,
                api.get('/memory/feedback/stats').catch(() => ({ data: { stats: null } })) as Promise<{ data: { stats: FeedbackStats | null } }>
            ]);

            setFacts((factsRes as any).data?.facts || []);
            setExperiences((expRes as any).data?.experiences || []);
            setFeedbackStats((feedbackRes as any).data?.stats || null);
        } catch (e: any) {
            setError('Failed to load memory data');
            console.error('[MEMORY_PANEL]', e);
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (ts: number) => {
        const date = new Date(ts);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getTypeIcon = (type: Experience['type']) => {
        switch (type) {
            case 'SUCCESS': return '✅';
            case 'FAILURE': return '❌';
            case 'LEARNING': return '🧠';
            case 'INSIGHT': return '💡';
            default: return '📝';
        }
    };

    const getCategoryIcon = (category: string) => {
        const cat = category.toLowerCase();
        if (cat.includes('preference')) return '⭐';
        if (cat.includes('identity') || cat.includes('name')) return '👤';
        if (cat.includes('work') || cat.includes('job')) return '💼';
        if (cat.includes('location')) return '📍';
        return '📌';
    };

    if (loading) {
        return (
            <div className="eternal-memory-panel loading">
                <div className="loader"></div>
                <p>Loading Eternal Memory...</p>
            </div>
        );
    }

    return (
        <div className="eternal-memory-panel">
            <header className="panel-header">
                <h2>🧠 Eternal Memory</h2>
                <div className="tab-buttons">
                    <button
                        className={activeTab === 'facts' ? 'active' : ''}
                        onClick={() => setActiveTab('facts')}
                    >
                        Facts ({facts.length})
                    </button>
                    <button
                        className={activeTab === 'experiences' ? 'active' : ''}
                        onClick={() => setActiveTab('experiences')}
                    >
                        Experiences ({experiences.length})
                    </button>
                    <button
                        className={activeTab === 'feedback' ? 'active' : ''}
                        onClick={() => setActiveTab('feedback')}
                    >
                        Feedback
                    </button>
                </div>
            </header>

            {error && <div className="error-banner">{error}</div>}

            <div className="panel-content">
                {/* FACTS TAB */}
                {activeTab === 'facts' && (
                    <div className="facts-list">
                        {facts.length === 0 ? (
                            <div className="empty-state">
                                <p>No facts stored yet.</p>
                                <small>Chat with Silhouette to build your profile!</small>
                            </div>
                        ) : (
                            facts.map((fact, i) => (
                                <div key={i} className="fact-item">
                                    <span className="fact-icon">{getCategoryIcon(fact.category)}</span>
                                    <div className="fact-content">
                                        <span className="fact-text">{fact.content}</span>
                                        <span className="fact-category">{fact.category}</span>
                                    </div>
                                    <span className="fact-confidence" title="Confidence">
                                        {Math.round(fact.confidence * 100)}%
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* EXPERIENCES TAB */}
                {activeTab === 'experiences' && (
                    <div className="experiences-list">
                        {experiences.length === 0 ? (
                            <div className="empty-state">
                                <p>No experiences recorded yet.</p>
                                <small>Silhouette learns from successes and failures!</small>
                            </div>
                        ) : (
                            experiences.map((exp) => (
                                <div key={exp.id} className={`experience-item type-${exp.type.toLowerCase()}`}>
                                    <span className="exp-icon">{getTypeIcon(exp.type)}</span>
                                    <div className="exp-content">
                                        <span className="exp-context">{exp.context}</span>
                                        <span className="exp-outcome">{exp.outcome}</span>
                                        <span className="exp-time">{formatTime(exp.timestamp)}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* FEEDBACK TAB */}
                {activeTab === 'feedback' && (
                    <div className="feedback-stats">
                        {feedbackStats ? (
                            <>
                                <div className="stat-grid">
                                    <div className="stat-card total">
                                        <span className="stat-value">{feedbackStats.total}</span>
                                        <span className="stat-label">Total</span>
                                    </div>
                                    <div className="stat-card positive">
                                        <span className="stat-value">👍 {feedbackStats.positive}</span>
                                        <span className="stat-label">Positive</span>
                                    </div>
                                    <div className="stat-card negative">
                                        <span className="stat-value">👎 {feedbackStats.negative}</span>
                                        <span className="stat-label">Negative</span>
                                    </div>
                                </div>
                                {feedbackStats.total > 0 && (
                                    <div className="satisfaction-bar">
                                        <div
                                            className="positive-fill"
                                            style={{
                                                width: `${(feedbackStats.positive / feedbackStats.total) * 100}%`
                                            }}
                                        />
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="empty-state">
                                <p>No feedback yet.</p>
                                <small>Rate responses with 👍/👎 to help Silhouette improve!</small>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default EternalMemoryPanel;
