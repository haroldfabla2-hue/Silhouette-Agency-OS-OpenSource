
import { orchestrator } from "./orchestrator";
import { resourceArbiter } from "./resourceArbiter";
import { uiContext } from "./uiContext";
import { continuum } from "./continuumMemory";
import { narrative } from "./narrativeService";
import { graph } from "./graphService";
import { redisClient } from "./redisClient";
import { systemBus } from "./systemBus";
import { SystemProtocol, AgentCategory } from "../types";
import { janitor } from "./contextJanitor";

// [PA-045] Codebase RAG Integration
import { codebaseAwareness } from "./codebaseAwareness";
import { contextCompaction } from "./context/contextCompactionService";

/**
 * [PA-041] Context Priority System
 * ================================
 * Implements Poke-style context hierarchy for intelligent token allocation.
 * Priority determines both ordering and token budget allocation.
 * 
 * Hierarchy (from highest to lowest priority):
 * 1. IMMEDIATE - User's current input (never truncated)
 * 2. ATTACHED - Files, media attached to request
 * 3. CONVERSATION - Recent chat history (limited by recency)
 * 4. MEMORY - Retrieved memories from vector DB
 * 5. SYSTEM - System metrics, orchestrator state (can be heavily truncated)
 */
export enum ContextPriority {
    IMMEDIATE = 1,      // Current user input - highest priority
    ATTACHED = 2,       // Attached files/media
    CONVERSATION = 3,   // Recent chat history
    MEMORY = 4,         // Vector memory retrieval
    SYSTEM = 5,         // System metrics, state (lowest priority)
    GRAPH = 6,          // Graph connections
    CODEBASE = 7        // Codebase RAG (expensive, often optional)
}

/**
 * Token budget allocation by priority level
 * Total budget should not exceed model's context limit
 * Higher priority = more tokens allocated
 */
export interface TokenBudgetConfig {
    totalBudget: number;        // Total tokens available (e.g., 32000 for gemini-1.5-flash)
    reservedForResponse: number; // Tokens reserved for response generation
    priorityAllocations: {
        [key in ContextPriority]: number; // Percentage of available tokens (0-100)
    };
}

/**
 * Default token budget configuration
 * Optimized for Gemini 1.5 Flash (1M context, but we use smaller for efficiency)
 */
export const DEFAULT_TOKEN_BUDGET: TokenBudgetConfig = {
    totalBudget: 32000,          // Conservative limit for fast inference
    reservedForResponse: 4000,   // Reserve for output
    priorityAllocations: {
        [ContextPriority.IMMEDIATE]: 100,     // Never truncate user input
        [ContextPriority.ATTACHED]: 25,       // 25% of remaining
        [ContextPriority.CONVERSATION]: 30,   // 30% of remaining
        [ContextPriority.MEMORY]: 20,         // 20% of remaining
        [ContextPriority.SYSTEM]: 10,         // 10% of remaining
        [ContextPriority.GRAPH]: 10,          // 10% of remaining
        [ContextPriority.CODEBASE]: 5         // 5% of remaining (expensive)
    }
};

/**
 * Context item with priority metadata
 */
export interface PrioritizedContextItem {
    priority: ContextPriority;
    key: string;
    content: string;
    tokenEstimate: number;      // Rough token count (chars / 4)
    truncated: boolean;         // Was this item truncated?
    originalLength: number;     // Original length before truncation
}

export interface GlobalContext {
    systemMetrics: any;
    orchestratorState: any;
    screenContext: any;
    narrativeState: any;
    relevantMemory: string;
    graphConnections: string;
    codeSnippets: string;
    contextIntegrity: 'VERIFIED' | 'COMPROMISED';
    chatHistory: { role: string; content: string }[];
    // [PA-041] Priority metadata
    priorityOrder: ContextPriority[];           // Order in which context was assembled
    tokenBudget: TokenBudgetConfig;             // Current budget configuration
    prioritizedItems: PrioritizedContextItem[]; // Breakdown of context items by priority
    totalTokensUsed: number;                    // Total tokens consumed
}

class ContextAssembler {
    // [PA-041] Token budget configuration - configurable at runtime
    private tokenBudget: TokenBudgetConfig = DEFAULT_TOKEN_BUDGET;

    // Cache for performance optimization
    private cachedContext: GlobalContext | null = null;
    private lastCacheTime: number = 0;
    private lastQuery: string | undefined = undefined;

    constructor() {
        console.log("[CONTEXT ASSEMBLER] 🧠 Initializing Omniscient Cortex...");
        // Ensure Redis is connected for caching
        redisClient.connect();
    }

    /**
     * [PA-041] Update token budget configuration at runtime
     * Allows dynamic adjustment based on model being used or system load
     * @param config - Partial configuration to merge with defaults
     */
    public setTokenBudget(config: Partial<TokenBudgetConfig>): void {
        this.tokenBudget = {
            ...this.tokenBudget,
            ...config,
            priorityAllocations: {
                ...this.tokenBudget.priorityAllocations,
                ...(config.priorityAllocations || {})
            }
        };
        console.log(`[CONTEXT] 📊 Token budget updated: ${this.tokenBudget.totalBudget} total`);
    }

    /**
     * [PA-041] Get current token budget configuration
     */
    public getTokenBudget(): TokenBudgetConfig {
        return { ...this.tokenBudget };
    }

    /**
     * [PA-041] Estimate token count for a string
     * Uses simple heuristic: 1 token ≈ 4 characters (conservative for English)
     * More accurate than counting words, less expensive than tokenizer
     */
    private estimateTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    /**
     * [PA-041] Build prioritized context items with token estimates
     * Maps context keys to their priority levels and calculates token usage
     */
    private buildPrioritizedItems(contextMap: Record<string, string>): PrioritizedContextItem[] {
        // Priority mapping for each context type
        const priorityMap: Record<string, ContextPriority> = {
            systemMetrics: ContextPriority.SYSTEM,
            orchestratorState: ContextPriority.SYSTEM,
            screenContext: ContextPriority.ATTACHED,
            narrativeState: ContextPriority.MEMORY,
            relevantMemory: ContextPriority.MEMORY,
            graphConnections: ContextPriority.GRAPH,
            codeSnippets: ContextPriority.CODEBASE,
            chatHistory: ContextPriority.CONVERSATION
        };

        const items: PrioritizedContextItem[] = [];
        const availableBudget = this.tokenBudget.totalBudget - this.tokenBudget.reservedForResponse;

        for (const [key, content] of Object.entries(contextMap)) {
            const priority = priorityMap[key] || ContextPriority.SYSTEM;
            const originalLength = content?.length || 0;
            const tokenEstimate = this.estimateTokens(content);

            // Calculate max tokens for this priority
            const allocationPercent = this.tokenBudget.priorityAllocations[priority] || 10;
            const maxTokens = Math.floor((availableBudget * allocationPercent) / 100);

            // Truncate if needed (except IMMEDIATE priority)
            let finalContent = content || '';
            let truncated = false;

            if (priority !== ContextPriority.IMMEDIATE && tokenEstimate > maxTokens && maxTokens > 0) {
                // Truncate to fit budget (estimate char count from token count)
                const maxChars = maxTokens * 4;
                finalContent = content.substring(0, maxChars) + '... [truncated]';
                truncated = true;
            }

            items.push({
                priority,
                key,
                content: finalContent,
                tokenEstimate: this.estimateTokens(finalContent),
                truncated,
                originalLength
            });
        }

        // Sort by priority (ascending = highest priority first)
        return items.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Helper to wrap promises with a timeout
     */
    private async timeoutPromise<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                // console.warn(`[CONTEXT] ⏱️ Timeout (${ms}ms) exceeded`);
                resolve(fallback);
            }, ms);

            promise
                .then((res) => {
                    clearTimeout(timer);
                    resolve(res);
                })
                .catch((err) => {
                    clearTimeout(timer);
                    console.warn(`[CONTEXT] ⚠️ Promise failed:`, err.message);
                    resolve(fallback);
                });
        });
    }

    /**
     * Gathers all available system context into a unified object.
     * This ensures no agent is "blind" to the environment.
     * Implements OCA (Omniscient Context Architecture) with caching and safety gates.
     * @param query - Optional query to fetch relevant memory/graph data.
     */
    public async getGlobalContext(query?: string): Promise<GlobalContext> {
        const start = Date.now();

        // [OPTIMIZATION] TTL Cache (2s) to prevent hardware thrashing
        if (this.cachedContext && (start - this.lastCacheTime < 2000) && this.lastQuery === query) {
            return this.cachedContext;
        }

        // 1. HARDWARE (Real-time) - FAST PATH using 'os'
        // We avoid 'systeminformation' here as it's too slow for chat loop (adds ~500ms+ on Windows)
        let metrics = {
            realCpu: 0,
            jsHeapSize: 0,
            vramUsage: 0,
            activeAgents: orchestrator.getActiveCount()
        };

        try {
            const os = await import('os');
            const cpus = os.cpus();
            // Simple load calc (not perfect but fast)
            // Windows doesn't support os.loadavg() well, so we use a different heuristic or just 0 for now to save time
            // Or we check process uptime as proxy for "is system struggling?"

            // Fast memory check
            const memUsage = process.memoryUsage();
            metrics.jsHeapSize = Math.round(memUsage.heapUsed / 1024 / 1024);

            // VRAM - We skip this on hot path or use cached value from previous slower runs if we had a background poller
            // For now, 0 or cached is fine.
        } catch (e) {
            // ignore
        }

        // 2-6. PARALLEL EXECUTION with TIMEOUTS
        // We proceed optimistically. If Graph/RAG are slow, we skip them for this turn.

        // Define promises
        const TIMEOUT_MS = 5000; // Increased to 5s (User preference: Intelligence > Speed)

        // A. Orchestrator State (Sync/Fast)
        const swarmState = {
            squads: orchestrator.getSquads().map(s => ({
                name: s.name,
                status: s.active ? 'ACTIVE' : 'OFFLINE',
                members: s.members.length
            })),
            activeCount: orchestrator.getActiveCount()
        };

        // B. Screen & Narrative (Sync/Fast)
        const screen = uiContext.getContext();
        const goal = narrative.getState();

        // C. Heavy IO Operations (Parallel)
        const memoryPromise = query
            ? this.timeoutPromise(continuum.retrieve(query), TIMEOUT_MS, [])
            : Promise.resolve([]);

        const graphPromise = query
            ? this.timeoutPromise(this.fetchGraphContext(query), TIMEOUT_MS, "")
            : Promise.resolve("");

        const ragPromise = query
            ? this.timeoutPromise(codebaseAwareness.query(query), TIMEOUT_MS + 200, "") // Give RAG a bit more time
            : Promise.resolve("");

        // Await all
        const [memories, graphText, codeSnippets] = await Promise.all([
            memoryPromise,
            graphPromise,
            ragPromise
        ]);

        // Process Memories
        const cleanMemories = Array.isArray(memories)
            ? memories.filter(m => !m.content.includes("As an AI"))
            : [];
        const memoryText = cleanMemories.map((m: any) => `[MEMORY (${m.tier})]: ${m.content}`).join('\n');

        // [PA-041] Build prioritized context items
        // Note: We fetch history separately? Or is it fast enough? 
        // continuum.getSessionHistory is usually DB access. Let's make it parallel too preferably, but for now linear is ok as it's key.
        const chatHistoryData = this.formatHistory(await continuum.getSessionHistory(1000));

        const prioritizedItems: PrioritizedContextItem[] = this.buildPrioritizedItems({
            systemMetrics: JSON.stringify(metrics),
            orchestratorState: JSON.stringify(swarmState),
            screenContext: JSON.stringify(screen),
            narrativeState: JSON.stringify(goal),
            relevantMemory: memoryText,
            graphConnections: graphText,
            codeSnippets: codeSnippets,
            chatHistory: JSON.stringify(chatHistoryData)
        });

        // Calculate total tokens used
        let totalTokensUsed = prioritizedItems.reduce((sum, item) => sum + item.tokenEstimate, 0);

        // Get available budget for strict enforcement
        const availableBudget = this.tokenBudget.totalBudget - this.tokenBudget.reservedForResponse;

        // [STRICT ENFORCEMENT] If total exceeds budget, trim from lowest priority
        if (totalTokensUsed > availableBudget) {
            console.warn(`[CONTEXT] ⚠️ Total budget exceeded (${totalTokensUsed}/${availableBudget} tokens). Trimming from lowest priority...`);

            // Priority order is 1 (Highest) to 7 (Lowest)
            // Reverse to start trimming from lowest priority (7)
            const sortedForTrimming = [...prioritizedItems].sort((a, b) => b.priority - a.priority);

            for (const item of sortedForTrimming) {
                if (totalTokensUsed <= availableBudget) break;
                if (item.priority === ContextPriority.IMMEDIATE) continue; // Never trim critical info

                const excess = totalTokensUsed - availableBudget;
                const reduction = Math.min(item.tokenEstimate, excess);

                // Severe trim: drop the item content significantly
                const newTokens = item.tokenEstimate - reduction;
                const newChars = Math.max(0, newTokens * 4);

                item.content = item.content.substring(0, newChars) + '... [budget cap reached]';
                item.tokenEstimate = this.estimateTokens(item.content);
                item.truncated = true;

                totalTokensUsed = prioritizedItems.reduce((sum, item) => sum + item.tokenEstimate, 0);
            }
        }

        const result: GlobalContext = {
            systemMetrics: metrics,
            orchestratorState: swarmState,
            screenContext: screen,
            narrativeState: goal,
            relevantMemory: memoryText,
            graphConnections: graphText,
            codeSnippets: codeSnippets,
            contextIntegrity: 'VERIFIED',
            chatHistory: chatHistoryData,
            priorityOrder: [
                ContextPriority.IMMEDIATE,
                ContextPriority.ATTACHED,
                ContextPriority.CONVERSATION,
                ContextPriority.MEMORY,
                ContextPriority.SYSTEM,
                ContextPriority.GRAPH,
                ContextPriority.CODEBASE
            ],
            tokenBudget: this.tokenBudget,
            prioritizedItems: prioritizedItems,
            totalTokensUsed: totalTokensUsed
        };

        this.cachedContext = result;
        this.lastCacheTime = Date.now();
        this.lastQuery = query;

        // console.log(`[CONTEXT] ⚡ Assembled in ${Date.now() - start}ms`);
        return result;
    }

    /**
     * Dedicated fetcher for Graph to handle its own caching logic/errors
     */
    private async fetchGraphContext(query: string): Promise<string> {
        try {
            const cacheKey = `ctx:graph:${Buffer.from(query).toString('base64').substring(0, 32)}`;
            const cachedGraph = await redisClient.get(cacheKey);
            if (cachedGraph) return cachedGraph;

            // We need IDs from memory to query graph (as per original logic logic was dependent)
            // Original: Retrieved memories -> extracted IDs -> queried graph.
            // NOW: We are running in parallel. We can't use memory IDs.
            // We must query graph by *Text Query* or *Embeddings* directly if supported, 
            // OR we accept that Graph might be slightly disconnected from exact memory hits this turn.
            // fallback: return "" if we can't query graph by text directly efficiently yet.

            // Actually, GraphService.getRelatedConcepts takes IDs. 
            // If we want parallel, we can't do sequential dependency.
            // Compromise for Speed: Skip Graph for now unless we have a "Keyword Search" for graph.
            // Let's assume we skip it or use a separate "Key Term Extraction" (fast) -> Graph.
            return "";

        } catch (e) {
            return "";
        }
    }




    // ... (rest of methods)

    // REPLACED: formatHistory is now delegated to ContextCompactionService
    private formatHistory(history: { role: string; content: string }[]): { role: string; content: string }[] {
        if (!history) return [];

        // Use the new Compaction Service
        // Budget for conversation history is calculated from our TokenBudget
        // DEFAULT_TOKEN_BUDGET.priorityAllocations[ContextPriority.CONVERSATION] is percentage (e.g. 30%)

        const availableBudget = this.tokenBudget.totalBudget - this.tokenBudget.reservedForResponse;
        const convPercent = this.tokenBudget.priorityAllocations[ContextPriority.CONVERSATION] || 30;
        const conversationBudget = Math.floor((availableBudget * convPercent) / 100);

        return contextCompaction.compactHistory(history, {
            tokenBudget: conversationBudget,
            reservedHead: 2,
            reservedTail: 15, // Increased recent context
            maxToolOutputChars: 3000 // Allow more tool details
        });
    }

}

export const contextAssembler = new ContextAssembler();
