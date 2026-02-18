


/**
 * [PA-041] Context Compaction Service
 * ===================================
 * Intelligent history reduction to fit within Token Budget.
 * Optimized compaction logic for long-running cognitive sessions.
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
     * Main compaction method
     */
    public compactHistory(history: ChatMessage[], config: Partial<CompactionConfig> = {}): ChatMessage[] {
        const cfg = { ...DEFAULT_CONFIG, ...config };

        if (!history || history.length === 0) return [];

        // 1. Annotate with token estimates
        const annotatedHistory = history.map(msg => ({
            ...msg,
            tokenEstimate: this.estimateTokens(msg.content)
        }));

        const totalTokens = annotatedHistory.reduce((sum, msg) => sum + (msg.tokenEstimate || 0), 0);

        // If within budget, return as is (but check for huge tool outputs)
        if (totalTokens <= cfg.tokenBudget) {
            return this.optimizeDetailedHistory(annotatedHistory, cfg);
        }

        console.log(`[COMPACTION] ⚠️ History exceeds budget (${totalTokens} > ${cfg.tokenBudget}). Compacting...`);

        // 2. Identify Head and Tail
        const head = annotatedHistory.slice(0, cfg.reservedHead);

        // Ensure tail doesn't overlap with head
        let tailStartIndex = Math.max(cfg.reservedHead, annotatedHistory.length - cfg.reservedTail);
        const tail = annotatedHistory.slice(tailStartIndex);

        const middle = annotatedHistory.slice(cfg.reservedHead, tailStartIndex);

        // 3. Construct Compacted History
        // Start with Head
        const compacted: ChatMessage[] = [...head];

        // Ensure we have budget for Tail
        const headTokens = head.reduce((sum, msg) => sum + (msg.tokenEstimate || 0), 0);
        const tailTokens = tail.reduce((sum, msg) => sum + (msg.tokenEstimate || 0), 0);
        let remainingBudget = cfg.tokenBudget - headTokens - tailTokens;

        if (remainingBudget < 0) {
            console.warn("[COMPACTION] 🚨 Critical: Even Head + Tail exceeds budget. Truncating Tail...");
            // We must preserve Head (System Instructions), so we truncate Tail
            return this.emergencyTruncate(head, tail, cfg.tokenBudget);
        }

        // 4. Summarize Middle (Placeholder logic for now: Drop oldest in middle)
        // In a full implementation, we would use an LLM call to summarize `middle` into one message used as context.
        // For now, we will add a "Gap" message indicating skipped turns.

        if (middle.length > 0) {
            const gapMessage: ChatMessage = {
                role: 'system',
                content: `[SYSTEM: Skipped ${middle.length} intermediary messages to preserve memory context. Previous discussions summarized: Interactions occurred.]`
            };
            compacted.push(gapMessage);
        }

        // 5. Add Tail
        compacted.push(...tail);

        // 6. Final Tool Output Optimization on the result
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
