/**
 * FEEDBACK BUTTONS COMPONENT
 * ═══════════════════════════════════════════════════════════════
 * Simple 👍/👎 buttons for rating AI responses
 * Can be attached to any chat message
 */

import React, { useState } from 'react';
import { api } from '../../utils/api';
import './FeedbackButtons.css';

interface FeedbackButtonsProps {
    messageId: string;
    query?: string;
    response?: string;
    sessionId?: string;
}

export const FeedbackButtons: React.FC<FeedbackButtonsProps> = ({
    messageId,
    query = '',
    response = '',
    sessionId = 'default'
}) => {
    const [submitted, setSubmitted] = useState<'POSITIVE' | 'NEGATIVE' | null>(null);
    const [loading, setLoading] = useState(false);

    const handleFeedback = async (rating: 'POSITIVE' | 'NEGATIVE') => {
        if (submitted || loading) return;

        setLoading(true);
        try {
            await api.post('/memory/feedback', {
                messageId,
                sessionId,
                query,
                response,
                rating
            });
            setSubmitted(rating);
        } catch (e) {
            console.error('[FEEDBACK] Failed to submit:', e);
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <div className="feedback-buttons submitted">
                <span className="feedback-thanks">
                    {submitted === 'POSITIVE' ? '👍 Thanks!' : '👎 Noted!'}
                </span>
            </div>
        );
    }

    return (
        <div className="feedback-buttons">
            <button
                className="feedback-btn positive"
                onClick={() => handleFeedback('POSITIVE')}
                disabled={loading}
                title="Good response"
            >
                👍
            </button>
            <button
                className="feedback-btn negative"
                onClick={() => handleFeedback('NEGATIVE')}
                disabled={loading}
                title="Bad response"
            >
                👎
            </button>
        </div>
    );
};

export default FeedbackButtons;
