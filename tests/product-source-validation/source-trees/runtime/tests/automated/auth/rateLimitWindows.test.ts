import { describe, it, expect } from 'vitest';
import { classifyRateLimitWindow, MAX_SHORT_WINDOW_WAIT_MS } from '../../../services/llm/rateLimitWindows';

describe('classifyRateLimitWindow', () => {
    it('classifies daily/quota evidence as long window', () => {
        expect(classifyRateLimitWindow(429, 'Quota exceeded for EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier').kind).toBe('long');
        expect(classifyRateLimitWindow(429, 'requests per day exceeded').kind).toBe('long');
        expect(classifyRateLimitWindow(400, 'insufficient_quota: current quota exhausted').kind).toBe('long');
    });
    it('classifies per-minute evidence with bounded retry-after as short', () => {
        const r = classifyRateLimitWindow(429, 'rate limit: requests per minute exceeded, Retry-After: 20');
        expect(r).toEqual({ kind: 'short', retryAfterMs: 20_000 });
    });
    it('treats provider waits beyond the short-window bound as long', () => {
        const r = classifyRateLimitWindow(429, `too many requests, retry in ${(MAX_SHORT_WINDOW_WAIT_MS / 1000) + 30} seconds`);
        expect(r.kind).toBe('long');
    });
    it('never retries a bare 429 blindly', () => {
        expect(classifyRateLimitWindow(429, '').kind).toBe('unknown');
    });
    it('ignores non-retryable statuses', () => {
        expect(classifyRateLimitWindow(401, 'invalid api key').kind).toBe('not-rate-limit');
    });
    it('parses millisecond units', () => {
        const r = classifyRateLimitWindow(429, 'rate limit, Retry-After: 1500 ms');
        expect(r).toEqual({ kind: 'short', retryAfterMs: 1500 });
    });
});
