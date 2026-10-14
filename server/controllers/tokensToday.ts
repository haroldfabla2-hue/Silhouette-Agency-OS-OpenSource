/**
 * Pure: tokens consumed today from cumulative-counter telemetry samples.
 * The counter is lifetime-cumulative and persisted; it can only be reset by
 * an operator action, so each negative jump is skipped instead of counted.
 * Samples are { ts, totalTokens } oldest-first.
 */
export function computeTokensToday(samples: { ts: number; totalTokens: number }[], dayStartTs: number): number {
    let total = 0;
    let prev: number | null = null;
    for (const s of samples) {
        if (s.ts < dayStartTs) { prev = s.totalTokens; continue; }
        if (prev !== null) total += Math.max(0, s.totalTokens - prev);
        prev = s.totalTokens;
    }
    return total;
}
