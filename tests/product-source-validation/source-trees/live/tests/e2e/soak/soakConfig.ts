/**
 * [Fase 5] Soak configuration. Defaults are a LOCAL SMOKE run (seconds).
 * The real 24h soak overrides everything via env - same code, longer clock:
 *
 *   SOAK_DURATION_MS=86400000 SOAK_RESTART_EVERY_MS=3600000 npx tsx tests/e2e/soak/runSoak.ts --mode=soak
 *
 * The 24h run additionally requires decisions that are Alberto's, not ours:
 * Neo4j/Redis hosting, LLM provider/budget, external-channel credentials.
 */
export interface SoakConfig {
    /** Total wall-clock of the soak run */
    durationMs: number;
    /** Cadence between write/read verification cycles */
    cycleEveryMs: number;
    /** Cadence between real process restarts (orchestrated by the harness) */
    restartEveryMs: number;
    /** local-first (SQLite only) or full (Neo4j/Redis enabled) */
    mode: 'local-first' | 'full';
}

export function getSoakConfig(): SoakConfig {
    return {
        durationMs: Number(process.env.SOAK_DURATION_MS || 5_000),
        cycleEveryMs: Number(process.env.SOAK_CYCLE_EVERY_MS || 1_000),
        restartEveryMs: Number(process.env.SOAK_RESTART_EVERY_MS || 3_600_000),
        mode: (process.env.SOAK_MODE as 'local-first' | 'full') || 'local-first'
    };
}
