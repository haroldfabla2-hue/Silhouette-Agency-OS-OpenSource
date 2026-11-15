// =============================================================================
// CHANNEL INTEGRATION TESTS
// Tests for channel utilities: chunking and internal-thought filtering.
// (Converted from a legacy self-run script to a proper Vitest suite.)
// =============================================================================

import { describe, it, expect } from 'vitest';

// ─── CHUNK MESSAGE (replicating the logic from channels) ─────────────────────

function chunkMessage(text: string, maxLen: number = 4000): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) { chunks.push(remaining); break; }
        let splitAt = remaining.lastIndexOf('\n\n', maxLen);
        if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
        if (splitAt < maxLen * 0.3) { splitAt = remaining.lastIndexOf('. ', maxLen); if (splitAt > 0) splitAt += 1; }
        if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
        if (splitAt <= 0) splitAt = maxLen;
        chunks.push(remaining.substring(0, splitAt).trim());
        remaining = remaining.substring(splitAt).trim();
    }
    return chunks.filter(c => c.length > 0);
}

const INTERNAL_PATTERNS = [
    /^\[THOUGHT\]/i, /^\[INTERNAL\]/i, /^Introspection:/i, /^<think>/i,
    /^SYSTEM:/, /^\[REFLECTIVE\]/i, /^\[COGNITIVE\]/i, /^\[SELF-HEAL\]/i,
    /^\[BUS\]/i, /^\[DAEMON\]/i,
];

function isInternalMessage(text: string): boolean {
    return INTERNAL_PATTERNS.some(p => p.test(text.trim()));
}

describe('Channel utilities', () => {
    describe('chunkMessage()', () => {
        it('returns a single chunk for short messages', () => {
            const result = chunkMessage('Hello world');
            expect(result).toEqual(['Hello world']);
        });

        it('splits long messages at the paragraph boundary', () => {
            const p1 = 'A'.repeat(3500);
            const p2 = 'B'.repeat(1500);
            const result = chunkMessage(`${p1}\n\n${p2}`);
            expect(result).toEqual([p1, p2]);
        });

        it('splits very long messages without paragraphs at newlines, respecting maxLen', () => {
            const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(50)}`).join('\n');
            const result = chunkMessage(lines, 2000);
            expect(result.length).toBeGreaterThan(1);
            for (const chunk of result) expect(chunk.length).toBeLessThanOrEqual(2000);
        });

        it('respects the Discord limit (1950)', () => {
            const result = chunkMessage('W'.repeat(5000), 1950);
            expect(result.length).toBeGreaterThanOrEqual(3);
        });

        it('handles empty string and exact boundary', () => {
            expect(chunkMessage('').length).toBeLessThanOrEqual(1);
            expect(chunkMessage('X'.repeat(4000))).toHaveLength(1);
        });
    });

    describe('isInternalMessage()', () => {
        it.each([
            '[THOUGHT] Processing cognitive loop',
            '[INTERNAL] System check',
            'Introspection: analyzing...',
            '<think>reasoning...</think>',
            'SYSTEM: reboot',
            '[BUS] message routed',
            '[DAEMON] tick',
            '  [THOUGHT] padded',
        ])('flags internal message: %s', (msg) => {
            expect(isInternalMessage(msg)).toBe(true);
        });

        it.each([
            'Hello! How can I help you today?',
            'I had a [THOUGHT] about this',
        ])('passes user-facing message: %s', (msg) => {
            expect(isInternalMessage(msg)).toBe(false);
        });
    });
});
