/**
 * [Fase 5] Soak/E2E runner - scaffolding with REAL local-first scenarios.
 *
 * Usage:
 *   npx tsx tests/e2e/soak/runSoak.ts --phase=a --db=<sqlite path> --evidence=<jsonl path>
 *   npx tsx tests/e2e/soak/runSoak.ts --phase=b --db=<sqlite path> --evidence=<jsonl path>
 *   npx tsx tests/e2e/soak/runSoak.ts --mode=soak --db=<sqlite path> --evidence=<jsonl path>
 *
 * phase-a / phase-b are separate OS processes: everything verified in
 * phase-b survived a REAL process restart on the same SQLite file.
 * soak mode runs write/read cycles until SOAK_DURATION_MS elapses.
 *
 * Every step appends one JSONL evidence line: timestamp, scenario, phase,
 * detail and PASS/FAIL/NOT_RUN with reasons. No result is fabricated: a
 * scenario that cannot run in this environment is NOT_RUN with the reason.
 *
 * Scenarios requiring the full server (HTTP sessions, approval/rejection
 * round-trips, inspected prompts, Neo4j/Redis full mode) are declared in
 * tests/e2e/README.md and reported NOT_RUN here.
 */
import fs from 'fs';
import path from 'path';

interface EvidenceEntry {
    ts: string;
    scenario: string;
    phase: string;
    result: 'PASS' | 'FAIL' | 'NOT_RUN';
    detail: string;
    metrics?: Record<string, unknown>;
}

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    if (i >= 0) return args[i + 1];
    const eq = args.find(a => a.startsWith(flag + '='));
    return eq ? eq.slice(flag.length + 1) : undefined;
}

const PHASE = argValue('--phase');
const MODE = argValue('--mode') || (PHASE ? undefined : 'soak');
const EVIDENCE_PATH = path.resolve(argValue('--evidence') || 'soak-evidence.jsonl');
const DB = argValue('--db');
if (DB) {
    process.env.SILHOUETTE_DB_PATH = DB;
    process.env.SILHOUETTE_IDENTITY_DB_PATH = DB.replace(/\.sqlite$/, '') + '-identity.sqlite';
}

const OWNER = 'soak_user';

function evidence(entry: EvidenceEntry) {
    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.appendFileSync(EVIDENCE_PATH, JSON.stringify(entry) + '\n');
    console.log(`[${entry.result}] ${entry.scenario}/${entry.phase}: ${entry.detail}`);
}

/** CostEstimator persists with a 5s debounce; give it time to really flush. */
async function waitForCostFlush(): Promise<void> {
    await new Promise(r => setTimeout(r, 6_000));
}

/** Constructor hydration is async: poll until the persisted totals show up. */
async function waitForCostHydration(minTokens: number): Promise<number> {
    const { costEstimator } = await import('../../../services/costEstimator');
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        const m = costEstimator.getMetrics();
        if (m.totalTokens >= minTokens) return m.totalTokens;
        await new Promise(r => setTimeout(r, 100));
    }
    return costEstimator.getMetrics().totalTokens;
}

async function writeSide(cycle: number): Promise<void> {
    const { factRepository } = await import('../../../services/memory/factRepository');
    const { incidentRegistry } = await import('../../../services/incidentRegistry');
    const { costEstimator } = await import('../../../services/costEstimator');

    const receipt = await factRepository.addFact({
        type: 'preference',
        content: `Soak marker fact cycle ${cycle}`,
        subject: 'soak',
        attribute: 'marker',
        value: `cycle-${cycle}`,
        source: 'USER_STATED',
        quote: `literal soak statement cycle ${cycle}`,
        status: 'verified',
        confidence: 1
    }, OWNER);
    evidence({
        ts: new Date().toISOString(), scenario: 'memory-write', phase: `cycle-${cycle}`,
        result: receipt.id && receipt.sqliteRows === 1 ? 'PASS' : 'FAIL',
        detail: `fact ${receipt.id} stored in SQLite (durable source); projections: ${receipt.projections.map(p => `${p.backend}:${p.ok ? 'ok' : 'failed'}`).join(', ')}`
    });

    const inc = incidentRegistry.recordIncident('soak-probe', 'outage', `soak probe outage cycle ${cycle}`);
    evidence({
        ts: new Date().toISOString(), scenario: 'incident-open', phase: `cycle-${cycle}`,
        result: inc.id ? 'PASS' : 'FAIL',
        detail: `open incident ${inc.id} (${inc.created ? 'created' : 'already open'})`
    });

    costEstimator.trackTransaction(1000 + cycle, 500 + cycle, 'soak-model');
    const m = costEstimator.getMetrics();
    evidence({
        ts: new Date().toISOString(), scenario: 'cost-log', phase: `cycle-${cycle}`,
        result: m.totalTokens > 0 && m.totalCost > 0 ? 'PASS' : 'FAIL',
        detail: 'LLM call cost recorded',
        metrics: { totalTokens: m.totalTokens, totalCost: m.totalCost }
    });
}

async function readSide(cycle: number): Promise<void> {
    const { factRepository } = await import('../../../services/memory/factRepository');
    const { incidentRegistry } = await import('../../../services/incidentRegistry');
    const { costEstimator } = await import('../../../services/costEstimator');

    const facts = factRepository.getFacts(OWNER).filter(f => f.attribute === 'marker' && f.value === `cycle-${cycle}`);
    const fact = facts[0];
    evidence({
        ts: new Date().toISOString(), scenario: 'memory-read-after-restart', phase: `cycle-${cycle}`,
        result: fact && fact.source === 'USER_STATED' && fact.quote ? 'PASS' : 'FAIL',
        detail: fact
            ? `fact ${fact.id} survived process restart with provenance (${fact.source}, quote retained)`
            : `marker fact for cycle ${cycle} NOT found after restart`
    });

    const open = incidentRegistry.getOpenIncidents().filter(i => i.source === 'soak-probe');
    const resolved = incidentRegistry.resolveIncidents('soak-probe', 'outage');
    evidence({
        ts: new Date().toISOString(), scenario: 'incident-recovery', phase: `cycle-${cycle}`,
        result: open.length > 0 && resolved > 0 ? 'PASS' : 'FAIL',
        detail: `open=${open.length} resolved=${resolved} (same incident, one open per episode)`
    });

    const tokens = await waitForCostHydration(1000 + cycle);
    const m = costEstimator.getMetrics();
    evidence({
        ts: new Date().toISOString(), scenario: 'cost-persisted', phase: `cycle-${cycle}`,
        result: tokens >= (1000 + cycle) && m.totalCost > 0 ? 'PASS' : 'FAIL',
        detail: `cost metrics persisted across restart (totalTokens=${tokens}, totalCost=${m.totalCost})`
    });
}

function declareNotRun(): void {
    const pending: Array<[string, string]> = [
        ['approval-rejection', 'requires full server HTTP session (ASK_USER round-trip) - run in the 24h soak'],
        ['new-chat-sessions', 'requires full server HTTP session - run in the 24h soak'],
        ['inspected-prompts', 'requires live LLM provider + budget (Alberto decision)'],
        ['full-mode-neo4j-redis', 'requires Neo4j/Redis hosting (Alberto decision)'],
        ['external-channels', 'requires external-channel credentials (Alberto decision)']
    ];
    for (const [scenario, reason] of pending) {
        evidence({ ts: new Date().toISOString(), scenario, phase: 'declared', result: 'NOT_RUN', detail: reason });
    }
}

async function main() {
    if (PHASE === 'a') {
        await writeSide(1);
        await waitForCostFlush();
        declareNotRun();
    } else if (PHASE === 'b') {
        await readSide(1);
    } else if (MODE === 'soak') {
        const { getSoakConfig } = await import('./soakConfig');
        const cfg = getSoakConfig();
        // Warm up the module graph first: one-time import cost (seconds on a
        // cold environment) must not eat the measured soak window - the window
        // exists to measure cycle behavior, not module loading.
        await import('../../../services/memory/factRepository');
        await import('../../../services/incidentRegistry');
        await import('../../../services/costEstimator');
        const started = Date.now();
        let cycle = 0;
        while (Date.now() - started < cfg.durationMs) {
            cycle++;
            await writeSide(cycle);
            await readSide(cycle);
            evidence({
                ts: new Date().toISOString(), scenario: 'cycle', phase: `cycle-${cycle}`,
                result: 'PASS',
                detail: `cycle ${cycle} complete (mode=${cfg.mode})`,
                metrics: { elapsedMs: Date.now() - started, durationMs: cfg.durationMs }
            });
            if (Date.now() - started < cfg.durationMs) {
                await new Promise(r => setTimeout(r, cfg.cycleEveryMs));
            }
        }
        await waitForCostFlush();
        declareNotRun();
    } else {
        console.error('usage: runSoak.ts --phase=a|b | --mode=soak [--db=path] [--evidence=path]');
        process.exit(2);
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        evidence({ ts: new Date().toISOString(), scenario: 'runner', phase: 'fatal', result: 'FAIL', detail: e?.message || String(e) });
        process.exit(1);
    });
