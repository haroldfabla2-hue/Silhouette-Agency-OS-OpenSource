/**
 * [auth-connections] Classify provider rate-limit evidence into retry windows.
 * Pattern verified in OpenClaw src/agents/failover/retry-evidence.ts (MIT,
 * commit d25ac78): short windows (per-minute) are retryable after a bounded
 * delay; long windows (daily/quota) must fail over or cool down instead of
 * burning calls. Pure classification, no I/O, no provider calls.
 */
export type RateLimitWindow =
    | { kind: 'short'; retryAfterMs?: number }
    | { kind: 'long'; reason: string }
    | { kind: 'not-rate-limit' }
    | { kind: 'unknown' };

const LONG_WINDOW_RE = /\b(daily|weekly|monthly|per[- ](day|week|month)|requests? per day|tokens? per day|quota[_ ]?exceeded|insufficient[_ ]?quota|current quota|usage limits?|available balance|out of budget|FreeTier)\b/i;
const SHORT_WINDOW_RE = /\b(requests? per minute|tokens? per minute|per[- ]minute|\brpm\b|\btpm\b|rate.?limit|too many requests|resource[_ -]?exhausted|model_cooldown)\b/i;
const RETRY_AFTER_RE = /retry[- ]?after[:\s]+(\d+(?:\.\d+)?)\s*(s|sec|seconds|ms|milliseconds)?/i;
const RETRY_DELAY_RE = /retry\s+in\s+(\d+(?:\.\d+)?)\s*(s|sec|seconds|ms|milliseconds)?/i;

/** Short windows never justify waiting more than this before failing over. */
export const MAX_SHORT_WINDOW_WAIT_MS = 60_000;

function parseRetryAfterMs(message: string): number | undefined {
    const m = RETRY_AFTER_RE.exec(message) ?? RETRY_DELAY_RE.exec(message);
    if (!m) return undefined;
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value < 0) return undefined;
    const unit = (m[2] || 's').toLowerCase();
    return unit.startsWith('ms') ? Math.round(value) : Math.round(value * 1000);
}

/**
 * Classify an error message/status from any provider. Status 429 with no
 * parseable evidence is 'unknown' - callers must not retry it blindly.
 */
export function classifyRateLimitWindow(status: number | undefined, message: string): RateLimitWindow {
    const text = message || '';
    // Quota evidence is decisive at ANY status: some providers return 400 for exhausted quota.
    if (LONG_WINDOW_RE.test(text)) return { kind: 'long', reason: 'daily-or-quota window' };
    if (status !== undefined && status !== 429 && ![408, 409, 500, 502, 503, 504, 524].includes(status)) {
        return { kind: 'not-rate-limit' };
    }
    const retryAfterMs = parseRetryAfterMs(text);
    if (SHORT_WINDOW_RE.test(text) || status === 429) {
        if (retryAfterMs !== undefined && retryAfterMs <= MAX_SHORT_WINDOW_WAIT_MS) {
            return { kind: 'short', retryAfterMs };
        }
        if (retryAfterMs !== undefined && retryAfterMs > MAX_SHORT_WINDOW_WAIT_MS) {
            return { kind: 'long', reason: `provider asked for ${retryAfterMs}ms wait` };
        }
        return status === 429 && !SHORT_WINDOW_RE.test(text) ? { kind: 'unknown' } : { kind: 'short' };
    }
    return { kind: 'unknown' };
}
