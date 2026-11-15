


/**
 * [PA-041] Context Compaction Service
 * ===================================
 * Intelligent history reduction to fit within Token Budget.
 * Optimized compaction logic for long-running cognitive sessions.
 *
 * Truthfulness contract: when messages must be dropped, the marker inserted
 * into the history says exactly what happened. A real LLM-generated summary
 * is labeled as such; when no summary could be produced, the marker says the
 * content was OMITTED and is not present — it never claims a summary exists
 * when none was generated.
 */

export interface CompactionConfig {
    tokenBudget: number;
    reservedHead: number; // Number of messages to keep at start (System/Intro)
    reservedTail: number; // Number of messages to keep at end (Recent interaction)
    maxToolOutputChars: number; // Max chars for tool output before truncation
}

export interface ChatMessage {
    role: string;
    content: string;
    tokenEstimate?: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
    tokenBudget: 8000, // Standard budget
    reservedHead: 2,
    reservedTail: 10,
    maxToolOutputChars: 2000
};

/** Max characters of middle-transcript sent to the LLM for summarization. */
const SUMMARIZER_INPUT_MAX_CHARS = 12000;

export class ContextCompactionService {

    constructor() {
        console.log("[COMPACTION] 📉 Service initialized.");
    }

    /**
     * Estimates tokens for a string (Approx 4 chars per token)
     */
    private estimateTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    /**
     * Honest marker used when middle messages are dropped without a summary.
     * It explicitly says the content is NOT present, so the agent never
     * believes a summary exists when none was generated.
     */
    private buildOmissionMarker(count: number, reason?: string): ChatMessage {
        const reasonPart = reason ? ` (reason: ${reason})` : '';
        return {
            role: 'system',
            content: `[SYSTEM: ${count} intermediary messages were OMITTED to fit the context budget${reasonPart}. Their content is NOT present anywhere in this context and no summary of them exists. Do not assume what they contained.]`
        };
    }

    /**
     * Marker used when a real LLM summary replaces the dropped messages.
     */
    private buildSummaryMarker(count: number, summary: string): ChatMessage {
        return {
            role: 'system',
            content: `[SYSTEM: ${count} intermediary messages were removed to fit the context budget and replaced by the following LLM-GENERATED summary. The original messages are no longer in this context; only this summary represents them.\n\nSUMMARY OF OMITTED MESSAGES:\n${summary}\n\nEND OF SUMMARY]`
        };
    }

    /**
     * Splits an annotated history into head / middle / tail per the config.
     * Returns null when the history already fits the budget.
     */
    private splitHistory(annotatedHistory: ChatMessage[], cfg: CompactionConfig): { head: ChatMessage[]; middle: ChatMessage[]; tail: ChatMessage[]; remainingBudget: number } | null {
        const totalTokens = annotatedHistory.reduce((sum, msg) => sum + (msg.tokenEstimate || 0), 0);
        if (totalTokens <= cfg.tokenBudget) return null;

        console.log(`[COMPACTION] ⚠️ History exceeds budget (${totalTokens} > ${cfg.tokenBudget}). Compacting...`);

        const head = annotatedHistory.slice(0, cfg.reservedHead);
        const tailStartIndex = Math.max(cfg.reservedHead, annotatedHistory.length - cfg.reservedTail);
        const tail = annotatedHistory.slice(tailStartIndex);
        const middle = annotatedHistory.slice(cfg.reservedHead, tailStartIndex);

        const headTokens = head.reduce((sum, msg) => sum + (msg.tokenEstimate || 0), 0);
        const tailTokens = tail.reduce((sum, msg) => sum + (msg.tokenEstimate || 0), 0);
        const remainingBudget = cfg.tokenBudget - headTokens - tailTokens;

        return { head, middle, tail, remainingBudget };
    }

    /**
     * Attempts a REAL LLM summary of the dropped middle messages via the LLM
     * Gateway. Returns null when summarization is impossible (no provider
     * configured, circuit open, network failure, empty output) so callers can
     * fall back to the honest omission marker.
     */
    private async summarizeMiddle(middle: ChatMessage[]): Promise<string | null> {
        try {
            // Dynamic import keeps this service free of heavy provider deps on
            // the hot path and avoids circular imports with the gateway.
            const { llmGateway } = await import('../llmGateway');

            let transcript = middle
                .map(m => `${(m.role || 'unknown').toUpperCase()}: ${m.content}`)
                .join('\n');

            if (transcript.length > SUMMARIZER_INPUT_MAX_CHARS) {
                const half = Math.floor(SUMMARIZER_INPUT_MAX_CHARS / 2);
                transcript = transcript.slice(0, half)
                    + '\n...[middle of the omitted transcript truncated for summarization]...\n'
                    + transcript.slice(-half);
            }

            const summary = await llmGateway.quickComplete(
                'Summarize the following conversation transcript factually and densely. ' +
                'Preserve: decisions made, tasks requested and their status, names, ' +
                'commitments, unresolved questions, and any facts the assistant must ' +
                'remember to continue coherently. Do not invent content that is not in ' +
                'the transcript. Output only the summary.\n\nTRANSCRIPT:\n' + transcript
            );

            const cleaned = (summary || '').trim();
            // Guard against empty/error-shaped outputs being presented as a summary.
            if (cleaned.length < 20) {
                console.warn('[COMPACTION] ⚠️ LLM summarization returned an unusable result; omitting without summary.');
                return null;
            }
            return cleaned;
        } catch (e: any) {
            console.warn(`[COMPACTION] ⚠️ LLM summarization unavailable (${e?.message || e}); omitting without summary.`);
            return null;
        }
    }

    /**
     * Main compaction method (async, preferred).
     *
     * When the history exceeds the budget, the middle section is replaced by a
     * REAL LLM-generated summary. If the summary cannot be produced, the
     * middle is dropped with an honest omission marker — never a fake summary.
     */
    public async compactHistoryAsync(history: ChatMessage[], config: Partial<CompactionConfig> = {}): Promise<ChatMessage[]> {
        const cfg = { ...DEFAULT_CONFIG, ...config };

        if (!history || history.length === 0) return [];

        const annotatedHistory = history.map(msg => ({
            ...msg,
            tokenEstimate: this.estimateTokens(msg.content)
        }));

        const split = this.splitHistory(annotatedHistory, cfg);
        if (!split) {
            return this.optimizeDetailedHistory(annotatedHistory, cfg);
        }

        const { head, middle, tail, remainingBudget } = split;

        if (remainingBudget < 0) {
            console.warn("[COMPACTION] 🚨 Critical: Even Head + Tail exceeds budget. Truncating Tail...");
            return this.emergencyTruncate(head, tail, cfg.tokenBudget);
        }

        const compacted: ChatMessage[] = [...head];

        if (middle.length > 0) {
            const summary = await this.summarizeMiddle(middle);
            compacted.push(summary !== null
                ? this.buildSummaryMarker(middle.length, summary)
                : this.buildOmissionMarker(middle.length, 'LLM summarization unavailable'));
        }

        compacted.push(...tail);

        return this.optimizeDetailedHistory(compacted, cfg);
    }

    /**
     * Synchronous compaction (legacy callers / no-LLM contexts).
     * Drops the middle with an HONEST omission marker. It never claims a
     * summary happened — use compactHistoryAsync for real summarization.
     */
    public compactHistory(history: ChatMessage[], config: Partial<CompactionConfig> = {}): ChatMessage[] {
        const cfg = { ...DEFAULT_CONFIG, ...config };

        if (!history || history.length === 0) return [];

        const annotatedHistory = history.map(msg => ({
            ...msg,
            tokenEstimate: this.estimateTokens(msg.content)
        }));

        const split = this.splitHistory(annotatedHistory, cfg);
        if (!split) {
            return this.optimizeDetailedHistory(annotatedHistory, cfg);
        }

        const { head, middle, tail, remainingBudget } = split;

        if (remainingBudget < 0) {
            console.warn("[COMPACTION] 🚨 Critical: Even Head + Tail exceeds budget. Truncating Tail...");
            return this.emergencyTruncate(head, tail, cfg.tokenBudget);
        }

        const compacted: ChatMessage[] = [...head];

        if (middle.length > 0) {
            compacted.push(this.buildOmissionMarker(middle.length, 'synchronous compaction path cannot run LLM summarization'));
        }

        compacted.push(...tail);

        return this.optimizeDetailedHistory(compacted, cfg);
    }

    /**
     * Truncates large tool outputs (logs, file reads) to save tokens,
     * while keeping the start and end of the output for context.
     */
    private optimizeDetailedHistory(history: ChatMessage[], cfg: CompactionConfig): ChatMessage[] {
        return history.map(msg => {
            // Only compact tool outputs or very long user/model messages if they are huge
            // (But be careful with code generation - we don't want to break code blocks)

            // Check for explicit Tool Result role (if used) or pattern
            const isToolResult = msg.role === 'function' || msg.role === 'tool' || (msg.role === 'user' && msg.content.startsWith('[TOOL_RESULT]'));

            if (isToolResult && msg.content.length > cfg.maxToolOutputChars) {
                const half = Math.floor(cfg.maxToolOutputChars / 2);
                const start = msg.content.substring(0, half);
                const end = msg.content.substring(msg.content.length - half);
                return {
                    ...msg,
                    content: `${start}\n... [TRUNCATED ${msg.content.length - cfg.maxToolOutputChars} CHARS] ...\n${end}`
                };
            }
            return msg;
        });
    }

    private emergencyTruncate(head: ChatMessage[], tail: ChatMessage[], budget: number): ChatMessage[] {
        // Keep Head
        // Truncate Tail from the START (oldest of the recent) until it fits
        let currentTokens = head.reduce((sum, msg) => sum + (this.estimateTokens(msg.content)), 0);
        const result: ChatMessage[] = [...head];

        // Add as many tail messages as possible starting from the END (most recent)
        // We reverse tail to add most recent first, then reverse back
        const reversedTail = [...tail].reverse();
        const safeTail: ChatMessage[] = [];

        for (const msg of reversedTail) {
            const tokens = this.estimateTokens(msg.content);
            if (currentTokens + tokens < budget) {
                safeTail.unshift(msg);
                currentTokens += tokens;
            } else {
                break;
            }
        }

        result.push(...safeTail);
        return result;
    }
}

export const contextCompaction = new ContextCompactionService();
