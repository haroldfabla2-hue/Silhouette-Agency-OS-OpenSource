/**
 * EXPERIENCE BUFFER SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Records experiences (successes, failures, learnings) for self-improvement.
 * These experiences are then used by IntrospectionEngine during reflection.
 * 
 * Storage: ContinuumMemory (LanceDB + Qdrant) with EXPERIENCE tag
 * Rate Limit Safe: Only uses local storage, no LLM calls
 */

import { continuum } from './continuumMemory';
import { MemoryTier } from '../types';

export type ExperienceType = 'SUCCESS' | 'FAILURE' | 'LEARNING' | 'INSIGHT';

export interface Experience {
    id: string;
    type: ExperienceType;
    context: string;       // What was the situation
    action: string;        // What action was taken
    outcome: string;       // What was the result
    lesson?: string;       // Optional: What was learned
    agentId?: string;      // Which agent had this experience
    timestamp: number;
}

class ExperienceBufferService {
    private buffer: Experience[] = [];
    private readonly MAX_BUFFER = 100; // Keep last 100 experiences in RAM

    /**
     * Record a new experience (async save to memory)
     */
    async record(exp: Omit<Experience, 'id' | 'timestamp'>): Promise<void> {
        const experience: Experience = {
            ...exp,
            id: crypto.randomUUID(),
            timestamp: Date.now()
        };

        // Add to RAM buffer
        this.buffer.unshift(experience);
        if (this.buffer.length > this.MAX_BUFFER) {
            this.buffer.pop();
        }

        // Format for storage
        const content = this.formatExperience(experience);

        // Store in ContinuumMemory with EXPERIENCE tag (eternal storage)
        try {
            await continuum.store(
                content,
                MemoryTier.LONG,  // Long-term = permanent
                ['EXPERIENCE', experience.type, `agent:${exp.agentId || 'SYSTEM'}`]
            );
            console.log(`[EXPERIENCE] 📝 Recorded ${exp.type}: "${exp.context.substring(0, 30)}..."`);
        } catch (e) {
            console.warn('[EXPERIENCE] Failed to persist:', e);
        }
    }

    /**
     * Record a SUCCESS experience
     */
    async recordSuccess(context: string, action: string, outcome: string, agentId?: string): Promise<void> {
        await this.record({
            type: 'SUCCESS',
            context,
            action,
            outcome,
            lesson: `This approach worked: ${action}`,
            agentId
        });
    }

    /**
     * Record a FAILURE experience (for learning from mistakes)
     */
    async recordFailure(context: string, action: string, outcome: string, lesson?: string, agentId?: string): Promise<void> {
        await this.record({
            type: 'FAILURE',
            context,
            action,
            outcome,
            lesson: lesson || `Avoid in future: ${action}`,
            agentId
        });
    }

    /**
     * Record a LEARNING experience (insight without success/failure)
     */
    async recordLearning(context: string, insight: string, agentId?: string): Promise<void> {
        await this.record({
            type: 'LEARNING',
            context,
            action: 'reflection',
            outcome: insight,
            lesson: insight,
            agentId
        });
    }

    /**
     * Get recent experiences from RAM buffer
     */
    getRecent(count: number = 10, type?: ExperienceType): Experience[] {
        let filtered = this.buffer;
        if (type) {
            filtered = this.buffer.filter(e => e.type === type);
        }
        return filtered.slice(0, count);
    }

    /**
     * Get experiences relevant to a context (from eternal memory)
     */
    async getRelevant(context: string, count: number = 5): Promise<Experience[]> {
        try {
            const memories = await continuum.retrieve(context, 'EXPERIENCE', undefined);
            return memories.slice(0, count).map(m => this.parseExperience(m.content));
        } catch (e) {
            console.warn('[EXPERIENCE] Failed to retrieve:', e);
            return [];
        }
    }

    /**
     * Format experience for storage
     */
    private formatExperience(exp: Experience): string {
        return `[EXPERIENCE:${exp.type}] Context: ${exp.context} | Action: ${exp.action} | Outcome: ${exp.outcome}${exp.lesson ? ` | Lesson: ${exp.lesson}` : ''}`;
    }

    /**
     * Parse experience from stored string
     */
    private parseExperience(content: string): Experience {
        // Basic parsing - robust enough for our format
        const typeMatch = content.match(/\[EXPERIENCE:(\w+)\]/);
        const contextMatch = content.match(/Context: ([^|]+)/);
        const actionMatch = content.match(/Action: ([^|]+)/);
        const outcomeMatch = content.match(/Outcome: ([^|]+)/);
        const lessonMatch = content.match(/Lesson: (.+)$/);

        return {
            id: crypto.randomUUID(),
            type: (typeMatch?.[1] as ExperienceType) || 'LEARNING',
            context: contextMatch?.[1]?.trim() || content,
            action: actionMatch?.[1]?.trim() || '',
            outcome: outcomeMatch?.[1]?.trim() || '',
            lesson: lessonMatch?.[1]?.trim(),
            timestamp: Date.now()
        };
    }

    /**
     * Get stats about experiences
     */
    getStats(): { total: number; byType: Record<ExperienceType, number> } {
        const byType: Record<ExperienceType, number> = {
            SUCCESS: 0,
            FAILURE: 0,
            LEARNING: 0,
            INSIGHT: 0
        };

        for (const exp of this.buffer) {
            byType[exp.type]++;
        }

        return { total: this.buffer.length, byType };
    }
}

export const experienceBuffer = new ExperienceBufferService();
