/**
 * [PA-041-FIX] Pure context-budget logic for the ContextAssembler.
 *
 * Why this module exists:
 * The PA-041 budget used to truncate a parallel breakdown (prioritizedItems)
 * that only the dashboard read, while the prompt path (geminiService) injected
 * the raw, unbounded fields. This module owns the trimming so it can be applied
 * to the fields that are ACTUALLY injected, and so it can be unit-tested
 * without Redis/Neo4j/LanceDB singletons.
 *
 * No service imports on purpose: keep this module side-effect free.
 */

export interface BudgetField {
    key: string;
    /** Numeric ContextPriority value (1 = highest). */
    priority: number;
    content: string;
}

export interface BudgetConfigLike {
    totalBudget: number;
    reservedForResponse: number;
    /** Percentage of the available budget per priority (0-100). */
    priorityAllocations: Record<number, number>;
}

export interface BudgetedItem {
    priority: number;
    key: string;
    content: string;
    tokenEstimate: number;
    truncated: boolean;
    originalLength: number;
}

export interface BudgetApplication {
    /** Truncated content per field key. This is what callers must inject. */
    fields: Record<string, string>;
    /** Breakdown of the SAME content returned in `fields` (truthful by construction). */
    items: BudgetedItem[];
    totalTokensUsed: number;
}

/** Priority value that is never truncated (ContextPriority.IMMEDIATE = 1). */
export const IMMEDIATE_PRIORITY = 1;

export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

export function applyBudgetToFields(fields: BudgetField[], budget: BudgetConfigLike): BudgetApplication {
    const available = Math.max(0, budget.totalBudget - budget.reservedForResponse);

    // Phase 1: per-priority cap.
    const items: BudgetedItem[] = fields.map(field => {
        const originalLength = field.content?.length || 0;
        let content = field.content || '';
        let truncated = false;
        const allocationPercent = budget.priorityAllocations[field.priority] ?? 10;
        const maxTokens = Math.floor((available * allocationPercent) / 100);
        if (field.priority !== IMMEDIATE_PRIORITY && estimateTokens(content) > maxTokens && maxTokens > 0) {
            content = content.substring(0, maxTokens * 4) + '... [truncated]';
            truncated = true;
        }
        return { priority: field.priority, key: field.key, content, tokenEstimate: estimateTokens(content), truncated, originalLength };
    });

    // Phase 2: total cap, trimming from the lowest priority upwards.
    let total = items.reduce((sum, item) => sum + item.tokenEstimate, 0);
    if (total > available) {
        const lowestFirst = [...items].sort((a, b) => b.priority - a.priority);
        for (const item of lowestFirst) {
            if (total <= available) break;
            if (item.priority === IMMEDIATE_PRIORITY) continue;
            const reduction = Math.min(item.tokenEstimate, total - available);
            const newChars = Math.max(0, (item.tokenEstimate - reduction) * 4);
            item.content = item.content.substring(0, newChars) + '... [budget cap reached]';
            item.tokenEstimate = estimateTokens(item.content);
            item.truncated = true;
            total = items.reduce((sum, it) => sum + it.tokenEstimate, 0);
        }
    }

    items.sort((a, b) => a.priority - b.priority);
    const outFields: Record<string, string> = {};
    for (const item of items) outFields[item.key] = item.content;
    return { fields: outFields, items, totalTokensUsed: total };
}
