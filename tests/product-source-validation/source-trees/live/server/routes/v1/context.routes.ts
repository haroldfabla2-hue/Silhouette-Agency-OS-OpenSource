/**
 * Context Routes - PA-041
 * ========================
 * API endpoints for Context Priority System configuration and metrics.
 * Provides fullstack access to token budget configuration and context analytics.
 * 
 * Endpoints:
 * - GET /v1/context/budget - Get current token budget configuration
 * - PUT /v1/context/budget - Update token budget configuration
 * - GET /v1/context/metrics - Get context priority metrics and usage stats
 * - POST /v1/context/presets/:preset - Apply a preset configuration
 */

import { Router, Request, Response } from 'express';
import {
    contextAssembler,
    ContextPriority,
    DEFAULT_TOKEN_BUDGET,
    TokenBudgetConfig
} from '../../../services/contextAssembler';
import { redisClient } from '../../../services/redisClient';

const router = Router();

// Redis key for persisted configuration
const CONTEXT_CONFIG_KEY = 'silhouette:context:budget';

/**
 * Preset configurations for common use cases
 * Users can apply these with POST /v1/context/presets/:preset
 */
const PRESETS: Record<string, Partial<TokenBudgetConfig>> = {
    // ECO mode: Minimize token usage
    eco: {
        totalBudget: 16000,
        reservedForResponse: 2000,
        priorityAllocations: {
            [ContextPriority.IMMEDIATE]: 100,
            [ContextPriority.ATTACHED]: 15,
            [ContextPriority.CONVERSATION]: 25,
            [ContextPriority.MEMORY]: 15,
            [ContextPriority.SYSTEM]: 5,
            [ContextPriority.GRAPH]: 5,
            [ContextPriority.CODEBASE]: 5
        }
    },
    // BALANCED mode: Default configuration
    balanced: DEFAULT_TOKEN_BUDGET,
    // HIGH mode: More context for complex tasks
    high: {
        totalBudget: 64000,
        reservedForResponse: 8000,
        priorityAllocations: {
            [ContextPriority.IMMEDIATE]: 100,
            [ContextPriority.ATTACHED]: 30,
            [ContextPriority.CONVERSATION]: 35,
            [ContextPriority.MEMORY]: 25,
            [ContextPriority.SYSTEM]: 15,
            [ContextPriority.GRAPH]: 15,
            [ContextPriority.CODEBASE]: 10
        }
    },
    // ULTRA mode: Maximum context for deep analysis
    ultra: {
        totalBudget: 128000,
        reservedForResponse: 16000,
        priorityAllocations: {
            [ContextPriority.IMMEDIATE]: 100,
            [ContextPriority.ATTACHED]: 40,
            [ContextPriority.CONVERSATION]: 40,
            [ContextPriority.MEMORY]: 30,
            [ContextPriority.SYSTEM]: 20,
            [ContextPriority.GRAPH]: 20,
            [ContextPriority.CODEBASE]: 15
        }
    }
};

/**
 * GET /v1/context/budget
 * Returns current token budget configuration
 */
router.get('/budget', async (_req: Request, res: Response) => {
    try {
        const budget = contextAssembler.getTokenBudget();

        // Include priority labels for frontend display
        const priorityLabels: Record<number, string> = {
            [ContextPriority.IMMEDIATE]: 'Immediate (User Input)',
            [ContextPriority.ATTACHED]: 'Attached Files/Media',
            [ContextPriority.CONVERSATION]: 'Chat History',
            [ContextPriority.MEMORY]: 'Memory Retrieval',
            [ContextPriority.SYSTEM]: 'System Metrics',
            [ContextPriority.GRAPH]: 'Graph Connections',
            [ContextPriority.CODEBASE]: 'Codebase RAG'
        };

        return res.json({
            success: true,
            budget,
            priorityLabels,
            availablePresets: Object.keys(PRESETS)
        });
    } catch (error: any) {
        console.error('[CONTEXT_ROUTES] Error getting budget:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /v1/context/budget
 * Update token budget configuration with persistence
 */
router.put('/budget', async (req: Request, res: Response) => {
    try {
        const config: Partial<TokenBudgetConfig> = req.body;

        // Validate config
        if (config.totalBudget !== undefined && (config.totalBudget < 1000 || config.totalBudget > 1000000)) {
            return res.status(400).json({
                error: 'totalBudget must be between 1000 and 1000000 tokens'
            });
        }

        if (config.reservedForResponse !== undefined && config.reservedForResponse < 100) {
            return res.status(400).json({
                error: 'reservedForResponse must be at least 100 tokens'
            });
        }

        // Apply configuration
        contextAssembler.setTokenBudget(config);

        // Persist to Redis for cross-session persistence
        const currentBudget = contextAssembler.getTokenBudget();
        await redisClient.set(CONTEXT_CONFIG_KEY, JSON.stringify(currentBudget), 0); // 0 = permanent (no expiration)

        console.log(`[CONTEXT_ROUTES] 💾 Budget persisted to Redis`);

        return res.json({
            success: true,
            message: 'Token budget updated and persisted',
            budget: currentBudget
        });
    } catch (error: any) {
        console.error('[CONTEXT_ROUTES] Error updating budget:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /v1/context/presets/:preset
 * Apply a preset configuration (eco, balanced, high, ultra)
 */
router.post('/presets/:preset', async (req: Request, res: Response) => {
    try {
        const { preset } = req.params;

        if (!PRESETS[preset]) {
            return res.status(400).json({
                error: `Unknown preset: ${preset}`,
                availablePresets: Object.keys(PRESETS)
            });
        }

        // Apply preset
        contextAssembler.setTokenBudget(PRESETS[preset]);

        // Persist
        const currentBudget = contextAssembler.getTokenBudget();
        await redisClient.set(CONTEXT_CONFIG_KEY, JSON.stringify(currentBudget), 0); // Permanent

        console.log(`[CONTEXT_ROUTES] 🎯 Applied preset: ${preset}`);

        return res.json({
            success: true,
            message: `Applied preset: ${preset}`,
            budget: currentBudget
        });
    } catch (error: any) {
        console.error('[CONTEXT_ROUTES] Error applying preset:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /v1/context/metrics
 * Get detailed context usage metrics from the last context assembly
 */
router.get('/metrics', async (req: Request, res: Response) => {
    try {
        const query = req.query.q as string | undefined;

        // Get global context which includes priority metrics
        const context = await contextAssembler.getGlobalContext(query);

        // Calculate usage statistics
        const budget = contextAssembler.getTokenBudget();
        const availableBudget = budget.totalBudget - budget.reservedForResponse;
        const usagePercent = Math.round((context.totalTokensUsed / availableBudget) * 100);

        // Group items by priority for visualization
        const byPriority: Record<string, { items: number; tokens: number; truncated: number }> = {};
        for (const item of context.prioritizedItems) {
            const key = ContextPriority[item.priority] || 'UNKNOWN';
            if (!byPriority[key]) {
                byPriority[key] = { items: 0, tokens: 0, truncated: 0 };
            }
            byPriority[key].items++;
            byPriority[key].tokens += item.tokenEstimate;
            if (item.truncated) byPriority[key].truncated++;
        }

        return res.json({
            success: true,
            metrics: {
                totalTokensUsed: context.totalTokensUsed,
                availableBudget,
                usagePercent,
                itemCount: context.prioritizedItems.length,
                truncatedItems: context.prioritizedItems.filter(i => i.truncated).length,
                byPriority
            },
            priorityOrder: context.priorityOrder.map(p => ContextPriority[p]),
            items: context.prioritizedItems.map(item => ({
                key: item.key,
                priority: ContextPriority[item.priority],
                tokens: item.tokenEstimate,
                truncated: item.truncated,
                originalLength: item.originalLength
            }))
        });
    } catch (error: any) {
        console.error('[CONTEXT_ROUTES] Error getting metrics:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * Initialize: Load persisted configuration on startup
 */
export async function initializeContextConfig(): Promise<void> {
    try {
        const cached = await redisClient.get(CONTEXT_CONFIG_KEY);
        if (cached) {
            const config = JSON.parse(cached) as TokenBudgetConfig;
            contextAssembler.setTokenBudget(config);
            console.log('[CONTEXT_ROUTES] 📥 Loaded persisted token budget from Redis');
        } else {
            console.log('[CONTEXT_ROUTES] 📌 Using default token budget');
        }
    } catch (error) {
        console.warn('[CONTEXT_ROUTES] Could not load persisted config, using defaults:', error);
    }
}

export default router;
