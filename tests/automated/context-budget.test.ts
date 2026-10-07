import { describe, it, expect } from 'vitest';
import { applyBudgetToFields, estimateTokens } from '../../services/context/contextBudget';

describe('contextBudget (pure logic, no services)', () => {
    it('estimates tokens with the existing chars/4 ceiling heuristic', () => {
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('abcde')).toBe(2);
    });

    it('bounds a field by its priority allocation and marks it truncated', () => {
        const long = 'x'.repeat(4000); // ~1000 tokens
        const result = applyBudgetToFields(
            [{ key: 'relevantMemory', priority: 4, content: long }],
            { totalBudget: 1000, reservedForResponse: 200, priorityAllocations: { 4: 10 } }
        );
        // available = 800, MEMORY cap = 80 tokens = 320 chars
        expect(result.fields.relevantMemory.length).toBeLessThan(long.length);
        expect(result.fields.relevantMemory).toContain('... [truncated]');
        expect(result.items[0].truncated).toBe(true);
        expect(result.items[0].originalLength).toBe(4000);
        // The breakdown must describe exactly what callers inject.
        expect(result.items[0].content).toBe(result.fields.relevantMemory);
    });

    it('never truncates the IMMEDIATE priority field, even past the total cap', () => {
        const long = 'user input '.repeat(80); // 880 chars = 220 tokens
        const result = applyBudgetToFields(
            [
                { key: 'task', priority: 1, content: long },
                { key: 'code', priority: 7, content: 'c'.repeat(400) } // 100 tokens
            ],
            { totalBudget: 200, reservedForResponse: 40, priorityAllocations: { 1: 100, 7: 100 } }
        );
        // available = 160; IMMEDIATE (220) is preserved by design.
        expect(result.fields.task).toBe(long);
        expect(result.items.find(i => i.key === 'task')?.truncated).toBe(false);
        // The lowest priority absorbs the overage down to the marker.
        expect(result.fields.code).toBe('... [budget cap reached]');
        expect(result.totalTokensUsed).toBe(220 + estimateTokens('... [budget cap reached]'));
    });

    it('trims the lowest priority first when the total exceeds the cap', () => {
        const big = (ch: string) => ch.repeat(4000); // 1000 tokens each
        const result = applyBudgetToFields(
            [
                { key: 'memory', priority: 4, content: big('m') },
                { key: 'graph', priority: 6, content: big('g') },
                { key: 'code', priority: 7, content: big('c') }
            ],
            { totalBudget: 1200, reservedForResponse: 0, priorityAllocations: { 4: 100, 6: 100, 7: 100 } }
        );
        // available = 1200, total = 3000 -> cap phase trims code first, then graph.
        expect(result.items.find(i => i.key === 'code')?.tokenEstimate ?? 0).toBeLessThanOrEqual(10);
        expect(result.items.find(i => i.key === 'memory')?.tokenEstimate).toBe(1000);
        expect(result.totalTokensUsed).toBeLessThanOrEqual(1210);
    });

    it('keeps the breakdown truthful for every field', () => {
        const result = applyBudgetToFields(
            [
                { key: 'a', priority: 2, content: 'a'.repeat(100) },
                { key: 'b', priority: 5, content: 'b'.repeat(100) }
            ],
            { totalBudget: 1000, reservedForResponse: 200, priorityAllocations: { 2: 50, 5: 50 } }
        );
        expect(result.items).toHaveLength(2);
        for (const item of result.items) expect(result.fields[item.key]).toBe(item.content);
        expect(result.items.map(i => i.key)).toEqual(['a', 'b']); // sorted by priority
    });
});
