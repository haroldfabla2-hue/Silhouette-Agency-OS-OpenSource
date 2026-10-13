/**
 * Event-based dream triggers (roadmap item 8).
 *
 * Formalizes WHEN the entity dreams. Before this module, dreaming fired on a
 * fixed 24h daemon clock plus an entropy counter. Now the 5-minute dream loop
 * evaluates real signals and dreams when there is something to consolidate:
 *
 *   - pressure:    hippocampus (working tier) at/over capacity
 *   - epiphanies:  >= N epiphany-tagged nodes since the last dream cycle
 *   - milestones:  janitor truth revisions (APPLIED) or identity-ledger
 *                  changes since the last dream cycle
 *   - fallback:    the clock — DREAM_FALLBACK_HOURS without any dream forces
 *                  one, so a quiet entity still consolidates
 *
 * ETERNAL-MEMORY SAFE: triggers only decide WHEN to dream; the dreamer owns
 * WHAT, and nothing here deletes anything.
 */

import fs from 'fs';
import path from 'path';

export interface DreamSignals {
    workingCount: number;
    workingCapacity: number;
    epiphaniesSinceLastDream: number;
    truthRevisionsSinceLastDream: number;
    identityChangesSinceLastDream: number;
    hoursSinceLastDream: number;
}

export interface DreamTriggerConfig {
    enabled: boolean;            // DREAM_TRIGGERS_ENABLED, default true
    epiphanyThreshold: number;   // DREAM_EPIPHANY_THRESHOLD, default 5
    revisionThreshold: number;   // DREAM_REVISION_THRESHOLD, default 1
    identityThreshold: number;   // DREAM_IDENTITY_THRESHOLD, default 1
    fallbackHours: number;       // DREAM_FALLBACK_HOURS, default 24
    minIntervalMinutes: number;  // DREAM_MIN_INTERVAL_MINUTES, default 30 (cooldown)
    statePath: string;           // DREAM_STATE_PATH, default <cwd>/data/dream-state.json
}

export const loadDreamTriggerConfig = (env: NodeJS.ProcessEnv = process.env): DreamTriggerConfig => ({
    enabled: (env.DREAM_TRIGGERS_ENABLED ?? 'true').toLowerCase() !== 'false',
    epiphanyThreshold: Number(env.DREAM_EPIPHANY_THRESHOLD ?? 5),
    revisionThreshold: Number(env.DREAM_REVISION_THRESHOLD ?? 1),
    identityThreshold: Number(env.DREAM_IDENTITY_THRESHOLD ?? 1),
    fallbackHours: Number(env.DREAM_FALLBACK_HOURS ?? 24),
    minIntervalMinutes: Number(env.DREAM_MIN_INTERVAL_MINUTES ?? 30),
    statePath: env.DREAM_STATE_PATH || path.resolve(process.cwd(), 'data', 'dream-state.json')
});

export interface DreamTriggerVerdict {
    shouldDream: boolean;
    reasons: string[];
}

/** Pure trigger evaluation — hermetically testable. */
export function evaluateDreamTriggers(
    signals: DreamSignals,
    config: DreamTriggerConfig,
    minutesSinceLastDream: number
): DreamTriggerVerdict {
    if (!config.enabled) return { shouldDream: false, reasons: ['triggers disabled (DREAM_TRIGGERS_ENABLED=false)'] };
    if (minutesSinceLastDream < config.minIntervalMinutes) {
        return { shouldDream: false, reasons: [`cooldown: last dream ${Math.round(minutesSinceLastDream)}m ago (< ${config.minIntervalMinutes}m)`] };
    }
    const reasons: string[] = [];
    if (signals.workingCount >= signals.workingCapacity) {
        reasons.push(`pressure: hippocampus ${signals.workingCount}/${signals.workingCapacity}`);
    }
    if (signals.epiphaniesSinceLastDream >= config.epiphanyThreshold) {
        reasons.push(`epiphanies: ${signals.epiphaniesSinceLastDream} since last dream (>= ${config.epiphanyThreshold})`);
    }
    if (signals.truthRevisionsSinceLastDream >= config.revisionThreshold) {
        reasons.push(`milestone: ${signals.truthRevisionsSinceLastDream} truth revision(s) applied since last dream`);
    }
    if (signals.identityChangesSinceLastDream >= config.identityThreshold) {
        reasons.push(`milestone: ${signals.identityChangesSinceLastDream} identity change(s) since last dream`);
    }
    if (signals.hoursSinceLastDream >= config.fallbackHours) {
        reasons.push(`fallback: ${signals.hoursSinceLastDream.toFixed(1)}h since last dream (>= ${config.fallbackHours}h)`);
    }
    return { shouldDream: reasons.length > 0, reasons: reasons.length ? reasons : ['no trigger condition met'] };
}

// ---------------------------------------------------------------------------
// Dream state (last cycle timestamp) — tiny JSON, fsync-free best effort
// ---------------------------------------------------------------------------

export interface DreamCycleRecord {
    at: number;
    triggers: string[];
    memoriesConsolidated: number | null;
}

export interface DreamState {
    lastDreamCycleAt: number | null;
    lastTriggers: string[];
    cycles: number;
    /** Bounded metadata history (last 1000 cycles) for cadence measurement.
     *  This is METRICS data, not memory — memories themselves are eternal. */
    history: DreamCycleRecord[];
}

const HISTORY_CAP = 1000;

export function readDreamState(statePath: string): DreamState {
    try {
        if (!fs.existsSync(statePath)) return { lastDreamCycleAt: null, lastTriggers: [], cycles: 0, history: [] };
        const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        return {
            lastDreamCycleAt: typeof raw.lastDreamCycleAt === 'number' ? raw.lastDreamCycleAt : null,
            lastTriggers: Array.isArray(raw.lastTriggers) ? raw.lastTriggers : [],
            cycles: typeof raw.cycles === 'number' ? raw.cycles : 0,
            history: Array.isArray(raw.history) ? raw.history : []
        };
    } catch {
        return { lastDreamCycleAt: null, lastTriggers: [], cycles: 0, history: [] };
    }
}

/** Record that a dream cycle executed. Called once per completed cycle from
 *  the dreamer's funnel point (attemptDream finally). */
export function recordDreamCycle(statePath: string, triggers: string[] = [], memoriesConsolidated: number | null = null): void {
    try {
        const prev = readDreamState(statePath);
        const history = [...prev.history, { at: Date.now(), triggers, memoriesConsolidated }].slice(-HISTORY_CAP);
        const next: DreamState = { lastDreamCycleAt: Date.now(), lastTriggers: triggers, cycles: prev.cycles + 1, history };
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(next, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[DREAM-TRIGGERS] could not record dream state:', e);
    }
}

// ---------------------------------------------------------------------------
// Cadence measurement (roadmap item 9): data-driven, not a fixed clock
// ---------------------------------------------------------------------------

export interface CadenceReport {
    cycles: number;
    windowDays: number | null;
    intervalsHours: { mean: number | null; median: number | null; min: number | null; max: number | null };
    triggerDistribution: Record<string, number>;
    avgMemoriesPerCycle: number | null;
    /** Advisory only — nothing auto-tunes. */
    suggestion: string;
}

const triggerKind = (t: string): string =>
    t.startsWith('pressure') ? 'pressure'
    : t.startsWith('epiphanies') ? 'epiphanies'
    : t.startsWith('milestone') ? 'milestone'
    : t.startsWith('fallback') ? 'fallback'
    : 'other';

const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Pure cadence analysis over a cycle history — hermetically testable. */
export function analyzeCadence(history: DreamCycleRecord[], config: DreamTriggerConfig): CadenceReport {
    const dist: Record<string, number> = {};
    for (const c of history) for (const t of c.triggers) dist[triggerKind(t)] = (dist[triggerKind(t)] || 0) + 1;

    const withMem = history.filter(c => typeof c.memoriesConsolidated === 'number');
    const avgMem = withMem.length
        ? Math.round((withMem.reduce((a, c) => a + (c.memoriesConsolidated ?? 0), 0) / withMem.length) * 10) / 10
        : null;

    if (history.length < 3) {
        return {
            cycles: history.length, windowDays: null,
            intervalsHours: { mean: null, median: null, min: null, max: null },
            triggerDistribution: dist, avgMemoriesPerCycle: avgMem,
            suggestion: `Insufficient data (${history.length} cycles); need >= 3 cycles to measure cadence.`
        };
    }

    const intervals = history.slice(1).map((c, i) => (c.at - history[i].at) / 3600_000);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const med = median(intervals);
    const windowDays = Math.round(((history[history.length - 1].at - history[0].at) / 86400_000) * 10) / 10;

    const eventDriven = (dist.pressure || 0) + (dist.epiphanies || 0) + (dist.milestone || 0);
    const fallback = dist.fallback || 0;
    const suggestedFallback = Math.min(168, Math.max(24, Math.ceil(med * 2)));
    const suggestion = eventDriven >= fallback
        ? `Events drive dreaming (median every ${med.toFixed(1)}h); the ${config.fallbackHours}h clock is a backstop. A data-driven fallback for this entity would be ~${suggestedFallback}h.`
        : `The clock drives most dreams (median every ${med.toFixed(1)}h); event triggers rarely fire — consider lower epiphany/milestone thresholds.`;

    return {
        cycles: history.length, windowDays,
        intervalsHours: {
            mean: Math.round(mean * 100) / 100,
            median: Math.round(med * 100) / 100,
            min: Math.round(Math.min(...intervals) * 100) / 100,
            max: Math.round(Math.max(...intervals) * 100) / 100
        },
        triggerDistribution: dist, avgMemoriesPerCycle: avgMem, suggestion
    };
}

export async function getCadenceReport(): Promise<CadenceReport> {
    const config = loadDreamTriggerConfig();
    return analyzeCadence(readDreamState(config.statePath).history, config);
}

// ---------------------------------------------------------------------------
// Live signal collection
// ---------------------------------------------------------------------------

export async function collectDreamSignals(lastDreamAt: number | null, now: number): Promise<DreamSignals> {
    const since = lastDreamAt ?? 0;

    let workingCount = 0;
    const workingCapacity = 50; // HIPPOCAMPUS_CAPACITY in continuumMemory (private constant)
    let epiphanies = 0;
    try {
        const { continuum } = await import('../continuumMemory');
        const stats = await continuum.getStats();
        workingCount = stats.working ?? 0;
    } catch { /* continuum unavailable → pressure signal 0 */ }

    try {
        const { lancedbService } = await import('../lancedbService');
        const nodes = await lancedbService.getAllNodes();
        epiphanies = nodes.filter(n => n.timestamp > since && n.tags.some(t => t.toLowerCase().includes('epiphany'))).length;
    } catch { /* lancedb unavailable → epiphany signal 0 */ }

    let revisions = 0;
    try {
        const { RevisionLedger, defaultLedgerPath } = await import('../janitor/revisionLedger');
        const entries = new RevisionLedger(defaultLedgerPath()).readAll();
        revisions = entries.filter(e => e.event === 'APPLIED' && e.ts > since).length;
    } catch { /* no ledger → 0 */ }

    let identityChanges = 0;
    try {
        const agentsDir = path.resolve(process.cwd(), 'data', 'agents');
        for (const agentId of fs.readdirSync(agentsDir)) {
            const lp = path.join(agentsDir, agentId, 'identity-ledger.jsonl');
            if (!fs.existsSync(lp)) continue;
            for (const line of fs.readFileSync(lp, 'utf-8').split('\n')) {
                if (!line.trim()) continue;
                try {
                    const e = JSON.parse(line);
                    const ts = Date.parse(e.timestamp);
                    if (!isNaN(ts) && ts > since) identityChanges++;
                } catch { /* skip malformed line */ }
            }
        }
    } catch { /* no agents dir → 0 */ }

    return {
        workingCount,
        workingCapacity,
        epiphaniesSinceLastDream: epiphanies,
        truthRevisionsSinceLastDream: revisions,
        identityChangesSinceLastDream: identityChanges,
        hoursSinceLastDream: lastDreamAt === null ? Number.POSITIVE_INFINITY : (now - lastDreamAt) / 3600_000
    };
}

/**
 * Orchestration entry for the dream loop: read state, collect signals,
 * evaluate, dream if warranted. Recording the cycle happens centrally in
 * attemptDream's finally block, so every trigger path counts exactly once.
 */
export async function evaluateAndMaybeDream(isDreaming: boolean, dream: () => Promise<void>, markTriggers?: (reasons: string[]) => void): Promise<DreamTriggerVerdict> {
    const config = loadDreamTriggerConfig();
    const state = readDreamState(config.statePath);
    const now = Date.now();
    const signals = await collectDreamSignals(state.lastDreamCycleAt, now);
    const minutesSince = state.lastDreamCycleAt === null ? Number.POSITIVE_INFINITY : (now - state.lastDreamCycleAt) / 60_000;
    const verdict = evaluateDreamTriggers(signals, config, minutesSince);
    if (verdict.shouldDream && !isDreaming) {
        console.log(`[DREAM-TRIGGERS] 🌙 Dream triggered: ${verdict.reasons.join(' | ')}`);
        markTriggers?.(verdict.reasons);
        await dream();
    }
    return verdict;
}
