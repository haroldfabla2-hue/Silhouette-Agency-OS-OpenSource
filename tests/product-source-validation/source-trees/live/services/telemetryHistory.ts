/**
 * Telemetry token-history helpers.
 *
 * The dashboard's "Live Token Velocity" chart is fed from REAL samples of the
 * cumulative token counter persisted in SQLite (telemetry_samples). These
 * helpers are pure so the bucketing logic is unit-testable without a database.
 */

export interface TelemetrySample {
    /** Unix epoch millis when the sample was taken. */
    ts: number;
    /** Cumulative total tokens observed at ts (monotonic while the process lives). */
    totalTokens: number;
    /** Cumulative total cost observed at ts. */
    totalCost: number;
}

export interface TokenHistoryPoint {
    /** Relative label, e.g. '-10m' ... '-1m', 'now'. */
    time: string;
    /** Tokens consumed inside that one-minute bucket (never negative). */
    tokens: number;
}

/**
 * Build per-minute token deltas for the last `minutes` minutes.
 *
 * - Returns [] when there are no samples yet (the UI must show an honest
 *   empty state instead of fabricating a curve).
 * - A drop in the cumulative counter (process restart, fresh DB) is treated
 *   as a reset: the negative delta is clamped to 0 rather than inventing
 *   negative traffic.
 */
export function buildTokenHistory(
    samples: TelemetrySample[],
    now: number = Date.now(),
    minutes: number = 10
): TokenHistoryPoint[] {
    if (!samples || samples.length === 0) return [];

    const sorted = [...samples].sort((a, b) => a.ts - b.ts);
    const minuteMs = 60_000;
    const windowStart = now - minutes * minuteMs;

    const points: TokenHistoryPoint[] = [];
    for (let i = minutes; i >= 1; i--) {
        points.push({ time: `-${i}m`, tokens: 0 });
    }
    points.push({ time: 'now', tokens: 0 });

    // Distribute each sample-to-sample delta into the bucket of the later sample.
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const delta = curr.totalTokens - prev.totalTokens;
        if (delta <= 0) continue; // counter reset or no activity
        const bucketIndex = Math.floor((curr.ts - windowStart) / minuteMs);
        if (bucketIndex >= 0 && bucketIndex < points.length) {
            points[bucketIndex].tokens += delta;
        }
    }

    return points;
}
