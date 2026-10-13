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

export interface DreamState {
    lastDreamCycleAt: number | null;
    lastTriggers: string[];
    cycles: number;
}

export function readDreamState(statePath: string): DreamState {
    try {
        if (!fs.existsSync(statePath)) return { lastDreamCycleAt: null, lastTriggers: [], cycles: 0 };
        const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        return {
            lastDreamCycleAt: typeof raw.lastDreamCycleAt === 'number' ? raw.lastDreamCycleAt : null,
            lastTriggers: Array.isArray(raw.lastTriggers) ? raw.lastTriggers : [],
            cycles: typeof raw.cycles === 'number' ? raw.cycles : 0
        };
    } catch {
        return { lastDreamCycleAt: null, lastTriggers: [], cycles: 0 };
    }
}

/** Record that a dream cycle executed. Called once per completed cycle from
 *  the dreamer's funnel point (attemptDream finally). */
export function recordDreamCycle(statePath: string, triggers: string[] = []): void {
    try {
        const prev = readDreamState(statePath);
        const next: DreamState = { lastDreamCycleAt: Date.now(), lastTriggers: triggers, cycles: prev.cycles + 1 };
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(next, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[DREAM-TRIGGERS] could not record dream state:', e);
    }
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
export async function evaluateAndMaybeDream(isDreaming: boolean, dream: () => Promise<void>): Promise<DreamTriggerVerdict> {
    const config = loadDreamTriggerConfig();
    const state = readDreamState(config.statePath);
    const now = Date.now();
    const signals = await collectDreamSignals(state.lastDreamCycleAt, now);
    const minutesSince = state.lastDreamCycleAt === null ? Number.POSITIVE_INFINITY : (now - state.lastDreamCycleAt) / 60_000;
    const verdict = evaluateDreamTriggers(signals, config, minutesSince);
    if (verdict.shouldDream && !isDreaming) {
        console.log(`[DREAM-TRIGGERS] 🌙 Dream triggered: ${verdict.reasons.join(' | ')}`);
        await dream();
    }
    return verdict;
}
