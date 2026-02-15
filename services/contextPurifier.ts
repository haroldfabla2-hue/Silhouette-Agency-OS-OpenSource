/**
 * CONTEXT PURIFICATION SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Post-retrieval, pre-generation filtering layer.
 * Based on industry best practices from Mem0, Anthropic, and RAG research.
 * 
 * Responsibilities:
 * 1. Score memories by relevance to query
 * 2. Filter out internal state/JSON from context
 * 3. Enforce token budgets per context section
 * 4. Assemble clean, focused context for LLM
 */

import { MemoryNode } from '../types';

export interface PurifiedContext {
    profile: string;        // [USER PROFILE] block
    memories: string;       // [RELEVANT MEMORIES] block  
    history: string;        // [RECENT CONVERSATION] block
    code?: string;          // [CODE CONTEXT] block (optional)
    totalTokens: number;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
}

interface ScoredMemory extends MemoryNode {
    relevanceScore: number;
}

class ContextPurifierService {
    // Token budgets (approximate - 1 token ≈ 4 chars)
    private readonly BUDGET = {
        profile: 500,       // ~2000 chars
        memories: 2000,     // ~8000 chars
        history: 1500,      // ~6000 chars
        code: 2000          // ~8000 chars
    };

    // Patterns that indicate internal system state (should be filtered)
    private readonly INTERNAL_PATTERNS: RegExp[] = [
        /\{[\s\S]*?\}/g,                        // JSON objects
        /```json[\s\S]*?```/g,                  // JSON code blocks
        /\[INTROSPECTION\].*$/gm,               // Introspection logs
        /\[CIRCUIT BREAKER\].*$/gm,             // Circuit breaker logs
        /\[PROTOCOL_.*?\].*$/gm,                // Protocol events
        /\[BUS\].*$/gm,                         // System bus events
        /\[CONTINUUM\].*$/gm,                   // Memory system logs
        /\[DREAMER\].*$/gm,                     // Dreamer service logs
        /\[NARRATIVE\].*$/gm,                   // Narrative service logs
        /Living State.*$/gmi,                   // Narrative state
        /sessionGoal.*$/gmi,                    // Session metadata
        /currentFocus.*$/gmi,                   // Narrative state
        /activeConstraints.*$/gmi,              // Constraint metadata
        /Narrative Cortex.*$/gmi,               // Narrative service
        /userEmotionalState.*$/gmi,             // Emotional state tracking
        /recentBreakthroughs.*$/gmi,            // Internal tracking
        /pendingQuestions.*$/gmi,               // Queue state
        /"@type".*$/gm,                         // JSON-LD type annotations
        /quotaMetric.*$/gm,                     // API quota info
        /RESOURCE_EXHAUSTED.*$/gm,              // Error states
    ];

    // Tags that indicate system-internal memories (exclude from user chat)
    private readonly SYSTEM_TAGS = [
        'INTERNAL', 'SYSTEM', 'PROTOCOL', 'INTROSPECTION',
        'CIRCUIT_BREAKER', 'NARRATIVE', 'DREAMER', 'DEBUG'
    ];

    /**
     * Main purification method - transforms raw context into clean, focused context
     */
    async purify(
        query: string,
        rawMemories: MemoryNode[],
        rawHistory: ChatMessage[],
        profileContext: string,
        codeContext?: string
    ): Promise<PurifiedContext> {
        console.log('[PURIFIER] 🧹 Purifying context...');

        // 0. Retrieve permanent user facts from Neo4j
        let userFacts = '';
        try {
            const { factExtractor } = await import('./factExtractor');
            userFacts = await factExtractor.getUserFacts();
        } catch (e) {
            console.warn('[PURIFIER] Could not retrieve user facts:', e);
        }

        // 1. Filter out system memories by tag
        const userMemories = this.filterSystemMemories(rawMemories);

        // 2. Score memories by relevance to query
        const scoredMemories = await this.scoreMemories(query, userMemories);

        // 3. Select top relevant memories within budget
        const selectedMemories = scoredMemories
            .filter(m => m.relevanceScore > 0.3)  // Relevance threshold
            .slice(0, 10);                        // Max 10 memories

        // 4. Sanitize memory content
        const sanitizedMemories = selectedMemories
            .map(m => this.sanitize(m.content))
            .filter(c => c.length > 10);          // Remove empty/tiny entries

        // 5. Sanitize history
        const sanitizedHistory = this.sanitizeHistory(rawHistory);

        // 6. Combine profile with permanent facts
        const enrichedProfile = userFacts
            ? `${this.sanitize(profileContext)}\n\n${userFacts}`
            : this.sanitize(profileContext);

        // 7. Assemble within token budget
        const result = this.assembleWithBudget({
            profile: enrichedProfile,
            memories: sanitizedMemories.length > 0
                ? `[RELEVANT MEMORIES]\n${sanitizedMemories.map(m => `- ${m}`).join('\n')}`
                : '',
            history: sanitizedHistory,
            code: codeContext ? this.truncateToTokens(codeContext, this.BUDGET.code) : undefined
        });

        console.log(`[PURIFIER] ✅ Purified: ${result.totalTokens} tokens (${selectedMemories.length} memories, ${rawHistory.length} history items)`);
        return result;
    }

    /**
     * Filter out memories with system tags
     */
    private filterSystemMemories(memories: MemoryNode[]): MemoryNode[] {
        return memories.filter(m => {
            const hasSysTag = m.tags?.some(t =>
                this.SYSTEM_TAGS.some(st => t.toUpperCase().includes(st))
            );
            return !hasSysTag;
        });
    }

    /**
     * Score memories by relevance using keyword matching and recency
     * (Fast heuristic - can be upgraded to embedding similarity later)
     */
    private async scoreMemories(query: string, memories: MemoryNode[]): Promise<ScoredMemory[]> {
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const now = Date.now();

        return memories.map(m => {
            const contentLower = (m.content || '').toLowerCase();

            // Keyword match score (0-1)
            const matchCount = queryWords.filter(w => contentLower.includes(w)).length;
            const keywordScore = queryWords.length > 0 ? matchCount / queryWords.length : 0;

            // Recency score (0-1) - decay over 24 hours
            const ageMs = now - (m.timestamp || now);
            const recencyScore = Math.max(0, 1 - (ageMs / (24 * 60 * 60 * 1000)));

            // Importance boost
            const importanceScore = m.importance || 0.5;

            // Combined score
            const relevanceScore = (keywordScore * 0.5) + (recencyScore * 0.2) + (importanceScore * 0.3);

            return { ...m, relevanceScore };
        }).sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    /**
     * Remove internal state patterns from text
     */
    private sanitize(text: string): string {
        if (!text) return '';

        let result = text;

        // Apply all internal patterns
        for (const pattern of this.INTERNAL_PATTERNS) {
            result = result.replace(pattern, '');
        }

        // Clean up multiple newlines
        result = result.replace(/\n{3,}/g, '\n\n');

        // Clean up lines that are just whitespace or dashes
        result = result.split('\n')
            .filter(line => line.trim().length > 1 && line.trim() !== '-')
            .join('\n');

        return result.trim();
    }

    /**
     * Sanitize chat history - remove JSON from assistant messages
     */
    private sanitizeHistory(history: ChatMessage[]): string {
        if (!history || history.length === 0) return '';

        const sanitized = history
            .slice(-10)  // Last 10 messages
            .map(msg => {
                let content = msg.content || '';

                // Sanitize assistant messages more aggressively
                if (msg.role === 'assistant') {
                    content = this.sanitize(content);

                    // Truncate long responses
                    if (content.length > 500) {
                        content = content.substring(0, 500) + '...';
                    }
                }

                const role = msg.role === 'user' ? 'User' : 'Silhouette';
                return `${role}: ${content}`;
            })
            .filter(line => line.length > 15);  // Remove empty entries

        return sanitized.length > 0
            ? `[RECENT CONVERSATION]\n${sanitized.join('\n')}`
            : '';
    }

    /**
     * Assemble context sections within token budget
     */
    private assembleWithBudget(sections: {
        profile: string;
        memories: string;
        history: string;
        code?: string;
    }): PurifiedContext {
        const profile = this.truncateToTokens(sections.profile, this.BUDGET.profile);
        const memories = this.truncateToTokens(sections.memories, this.BUDGET.memories);
        const history = this.truncateToTokens(sections.history, this.BUDGET.history);
        const code = sections.code
            ? this.truncateToTokens(sections.code, this.BUDGET.code)
            : undefined;

        // Estimate total tokens (1 token ≈ 4 chars)
        const totalTokens = Math.ceil(
            (profile.length + memories.length + history.length + (code?.length || 0)) / 4
        );

        return { profile, memories, history, code, totalTokens };
    }

    /**
     * Truncate text to approximate token limit
     */
    private truncateToTokens(text: string, tokenLimit: number): string {
        if (!text) return '';

        const charLimit = tokenLimit * 4;  // Approximate

        if (text.length <= charLimit) return text;

        // Truncate at sentence boundary if possible
        const truncated = text.substring(0, charLimit);
        const lastSentence = truncated.lastIndexOf('.');

        if (lastSentence > charLimit * 0.7) {
            return truncated.substring(0, lastSentence + 1);
        }

        return truncated + '...';
    }

    /**
     * Quick check if content looks like internal state
     */
    isInternalState(content: string): boolean {
        if (!content) return false;

        // Check for JSON
        if (content.includes('{') && content.includes('}')) return true;

        // Check for common internal patterns
        const internalIndicators = [
            '[PROTOCOL_', '[INTROSPECTION]', '[CIRCUIT BREAKER]',
            'Living State', 'Narrative Cortex', 'sessionGoal',
            'RESOURCE_EXHAUSTED', 'quotaMetric'
        ];

        return internalIndicators.some(ind => content.includes(ind));
    }
}

export const contextPurifier = new ContextPurifierService();
