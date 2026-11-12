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
import { MemoryTier, type MemoryNode } from '../types';

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
    /** Legacy text had no original experience UUID/time. These fields then
     * identify the actual memory node, not a recovered original experience. */
    identityProvenance?: 'legacy-memory-node';
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

        // Format for storage
        const content = this.formatExperience(experience);

        // Store in ContinuumMemory with EXPERIENCE tag (eternal storage)
        try {
            await continuum.store(
                content,
                MemoryTier.LONG,  // Long-term = permanent
                ['EXPERIENCE', experience.type, `agent:${exp.agentId || 'SYSTEM'}`, `experience:${experience.id}`]
            );
            const readback = await continuum.getLatestObservation(`experience:${experience.id}`);
            if (!readback || readback.content !== content) throw new Error('Experience persistence unverified');
            this.buffer.unshift(experience);
            if (this.buffer.length > this.MAX_BUFFER) this.buffer.pop();
            console.log(`[EXPERIENCE] 📝 Recorded ${exp.type}: "${exp.context.substring(0, 30)}..."`);
        } catch (e) {
            console.warn('[EXPERIENCE] Failed to persist:', e);
            throw e;
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

    /** Bounded canonical history, independent of process-local RAM and semantic
     * search. Failure is observable: unreadable durable data must not be
     * reported as a successful empty learning window. Does not rewrite memory. */
    async getRecentDurable(count: number = 100, type?: ExperienceType): Promise<Experience[]> {
        if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Experience history limit must be 1..100');
        const nodes = await continuum.getRecentObservations(type ? ['EXPERIENCE', type] : ['EXPERIENCE'], count);
        return nodes.map(n => {
            const experience = this.parseExperience(n);
            if (!experience || (type && experience.type !== type)) throw new Error(`Invalid durable experience ${n.id}`);
            return experience;
        })
            .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id)).slice(0, count);
    }

    /**
     * Get experiences relevant to a context (from eternal memory)
     */
    async getRelevant(context: string, count: number = 5): Promise<Experience[]> {
        try {
            const memories = await continuum.retrieve(context, 'EXPERIENCE', undefined);
            return memories.slice(0, count).map(m => this.parseExperience(m)).filter((e): e is Experience => e !== null);
        } catch (e) {
            console.warn('[EXPERIENCE] Failed to retrieve:', e);
            return [];
        }
    }

    /**
     * Format experience for storage
     */
    private formatExperience(exp: Experience): string {
        // Versioned original identity/time survive readback. A textual type
        // prefix remains searchable; JSON preserves delimiters and newlines.
        return `[EXPERIENCE:${exp.type}] V2 ${JSON.stringify(exp)}`;
    }

    /**
     * Parse experience from stored string
     */
    private parseExperience(memory: MemoryNode): Experience | null {
        const content = memory.content;
        const versioned = content.match(/^\[EXPERIENCE:(SUCCESS|FAILURE|LEARNING|INSIGHT)\] V2 ([\s\S]+)$/);
        if (versioned) {
            try {
                const exp = JSON.parse(versioned[2]);
                if (typeof exp.id !== 'string' || !exp.id || exp.type !== versioned[1]
                    || !Number.isFinite(exp.timestamp) || exp.timestamp <= 0
                    || !['context', 'action', 'outcome'].every(k => typeof exp[k] === 'string')
                    || (exp.lesson !== undefined && typeof exp.lesson !== 'string')
                    || (exp.agentId !== undefined && typeof exp.agentId !== 'string')) return null;
                return { id: exp.id, type: exp.type, context: exp.context, action: exp.action,
                    outcome: exp.outcome, lesson: exp.lesson, agentId: exp.agentId, timestamp: exp.timestamp };
            } catch { return null; }
        }
        // Legacy content did not store the experience UUID/time. Preserve
        // the real memory record identity/time instead of inventing new ones.
        if (!memory.id || !Number.isFinite(memory.timestamp) || memory.timestamp <= 0) return null;
        const typeMatch = content.match(/\[EXPERIENCE:(SUCCESS|FAILURE|LEARNING|INSIGHT)\]/);
        if (!typeMatch) return null;
        const contextMatch = content.match(/Context: ([^|]+)/);
        const actionMatch = content.match(/Action: ([^|]+)/);
        const outcomeMatch = content.match(/Outcome: ([^|]+)/);
        const lessonMatch = content.match(/Lesson: (.+)$/);

        return {
            id: memory.id,
            type: typeMatch[1] as ExperienceType,
            identityProvenance: 'legacy-memory-node',
            context: contextMatch?.[1]?.trim() || content,
            action: actionMatch?.[1]?.trim() || '',
            outcome: outcomeMatch?.[1]?.trim() || '',
            lesson: lessonMatch?.[1]?.trim(),
            agentId: memory.tags?.find(t => t.startsWith('agent:'))?.slice(6),
            timestamp: memory.timestamp
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
