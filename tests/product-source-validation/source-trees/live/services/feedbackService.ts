/**
 * FEEDBACK SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Stores user feedback (👍/👎) on AI responses for learning.
 * Uses in-memory storage with JSON persistence (simpler than SQLite direct access).
 * 
 * Storage: JSON file in data directory
 */

import * as fs from 'fs';
import * as path from 'path';

export type FeedbackRating = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export interface FeedbackEntry {
    id: string;
    messageId: string;
    sessionId: string;
    query: string;
    response: string;
    rating: FeedbackRating;
    comment?: string;
    timestamp: number;
}

const FEEDBACK_FILE = path.join(process.cwd(), 'data', 'feedback.json');

class FeedbackService {
    private entries: FeedbackEntry[] = [];
    private loaded = false;

    /**
     * Load feedback from file
     */
    private load(): void {
        if (this.loaded) return;

        try {
            if (fs.existsSync(FEEDBACK_FILE)) {
                const data = fs.readFileSync(FEEDBACK_FILE, 'utf-8');
                this.entries = JSON.parse(data);
            }
            this.loaded = true;
        } catch (e) {
            console.warn('[FEEDBACK] Failed to load:', e);
            this.entries = [];
            this.loaded = true;
        }
    }

    /**
     * Save feedback to file
     */
    private save(): void {
        try {
            const dir = path.dirname(FEEDBACK_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(this.entries, null, 2));
        } catch (e) {
            console.warn('[FEEDBACK] Failed to save:', e);
        }
    }

    /**
     * Record user feedback on a response
     */
    async recordFeedback(
        messageId: string,
        sessionId: string,
        query: string,
        response: string,
        rating: FeedbackRating,
        comment?: string
    ): Promise<boolean> {
        this.load();

        try {
            const entry: FeedbackEntry = {
                id: crypto.randomUUID(),
                messageId,
                sessionId,
                query,
                response,
                rating,
                comment,
                timestamp: Date.now()
            };

            this.entries.unshift(entry);

            // Keep max 1000 entries
            if (this.entries.length > 1000) {
                this.entries = this.entries.slice(0, 1000);
            }

            this.save();
            console.log(`[FEEDBACK] 📝 Recorded ${rating} feedback for message ${messageId}`);

            // If negative, also record as experience for learning
            if (rating === 'NEGATIVE') {
                try {
                    const { experienceBuffer } = await import('./experienceBuffer');
                    await experienceBuffer.recordFailure(
                        `Response to: "${query.substring(0, 50)}..."`,
                        `Generated: "${response.substring(0, 50)}..."`,
                        `User marked as negative${comment ? `: ${comment}` : ''}`,
                        `Avoid similar response patterns`,
                        'CHAT'
                    );
                } catch (e) { /* non-critical */ }
            }

            return true;
        } catch (e) {
            console.error('[FEEDBACK] Failed to record:', e);
            return false;
        }
    }

    /**
     * Get feedback statistics
     */
    getStats(): { total: number; positive: number; negative: number; neutral: number } {
        this.load();

        const stats = { total: 0, positive: 0, negative: 0, neutral: 0 };

        for (const entry of this.entries) {
            stats.total++;
            if (entry.rating === 'POSITIVE') stats.positive++;
            else if (entry.rating === 'NEGATIVE') stats.negative++;
            else stats.neutral++;
        }

        return stats;
    }

    /**
     * Get recent feedback entries
     */
    getRecent(limit: number = 10): FeedbackEntry[] {
        this.load();
        return this.entries.slice(0, limit);
    }

    /**
     * Get negative feedback for analysis/training
     */
    getNegativeFeedback(limit: number = 50): FeedbackEntry[] {
        this.load();
        return this.entries
            .filter(e => e.rating === 'NEGATIVE')
            .slice(0, limit);
    }
}

export const feedbackService = new FeedbackService();
