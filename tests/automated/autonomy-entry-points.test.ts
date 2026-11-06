/**
 * Autonomy entry points - every route into proactive cognition respects the
 * config ceiling; PowerManager throttles without cutting authority.
 *
 * Covers the non-daemon entry points audited in the v4 rootfix:
 *  - server/jobs/heartbeat.ts (boot loader route into introspection+discovery)
 *  - neuroCognitiveService self-started discovery heartbeat (constructor route)
 *  - evolutionScheduler (server/index.ts + PowerManager reactivation route)
 *  - learningLoop / narrativeService per-tick PowerManager throttles
 *
 * Test doubles are declared: configLoader/powerManager/congestion and the
 * heavy downstream services are mocked; the autonomy policy under test is
 * the REAL module. Timer-driven, no real I/O.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OFF = { enabled: false, allowEvolution: false, enableNarrative: false, enableIntrospection: false };
const ON = { enabled: true, allowEvolution: true, enableNarrative: true, enableIntrospection: true };

// Mutable knobs the mocked configLoader/powerManager read per call.
const knobs = {
    autonomy: { ...OFF },
    power: {
        isIntrospectionEnabled: true,
        isCuriosityEnabled: true,
        isLearningLoopEnabled: true,
        isNarrativeEnabled: true,
        isEvolutionEnabled: true,
        isDreamerEnabled: true,
    }
};

vi.mock('../../server/config/configLoader', () => ({
    configLoader: { getConfig: () => ({ autonomy: knobs.autonomy }) }
}));
vi.mock('../../services/powerManager', () => ({ powerManager: knobs.power }));
vi.mock('../../services/congestionManager', () => ({
    congestionManager: { isCongested: () => false }
}));
vi.mock('../../services/systemBus', () => ({
    systemBus: { emit: vi.fn(), on: vi.fn(), subscribe: vi.fn() }
}));

// Heavy downstream services mocked so entry-point modules import cleanly.
const runCognitiveCycle = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/introspectionEngine', () => ({
    introspection: { runCognitiveCycle: (...a: any[]) => runCognitiveCycle(...a) }
}));
const triggerDiscoveryCycle = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/neuroCognitiveService', () => ({
    neuroCognitive: { triggerDiscoveryCycle: (...a: any[]) => triggerDiscoveryCycle(...a) }
}));

// First-time module loading does not complete inside a fake-timer advance;
// warm every module the ticks dynamic-import BEFORE starting timers, so ticks
// genuinely execute (otherwise "denied" assertions would pass vacuously).
async function warm(modules: string[]) {
    for (const m of modules) await import(m);
}
const HEARTBEAT_TICK_IMPORTS = [
    '../../server/config/configLoader',
    '../../services/daemon/autonomyPolicy',
    '../../services/congestionManager',
    '../../services/neuroCognitiveService',
];

beforeEach(() => {
    knobs.autonomy = { ...OFF };
    knobs.power.isCuriosityEnabled = true;
    knobs.power.isLearningLoopEnabled = true;
    knobs.power.isNarrativeEnabled = true;
    knobs.power.isEvolutionEnabled = true;
    runCognitiveCycle.mockClear();
    triggerDiscoveryCycle.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('heartbeat job (boot loader route)', () => {
    it('runs no proactive cycle when the ceiling is off', async () => {
        await warm(HEARTBEAT_TICK_IMPORTS);
        vi.useFakeTimers();
        const { startHeartbeat } = await import('../../server/jobs/heartbeat');
        startHeartbeat();
        await vi.advanceTimersByTimeAsync(120000 * 10 + 1000); // 10 cycles + discovery window
        expect(runCognitiveCycle).not.toHaveBeenCalled();
        expect(triggerDiscoveryCycle).not.toHaveBeenCalled();
    });

    it('runs introspection and discovery when the ceiling allows them', async () => {
        knobs.autonomy = { ...ON };
        await warm(HEARTBEAT_TICK_IMPORTS);
        vi.useFakeTimers();
        const { startHeartbeat } = await import('../../server/jobs/heartbeat');
        startHeartbeat();
        await vi.advanceTimersByTimeAsync(120000); // 1 cycle
        expect(runCognitiveCycle).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(120000 * 9 + 1000); // reach cycle 10 -> discovery
        expect(runCognitiveCycle).toHaveBeenCalledTimes(10);
        expect(triggerDiscoveryCycle).toHaveBeenCalledTimes(1);
    });

    it('master switch off blocks introspection even with enableIntrospection=true', async () => {
        knobs.autonomy = { ...ON, enabled: false };
        await warm(HEARTBEAT_TICK_IMPORTS);
        vi.useFakeTimers();
        const { startHeartbeat } = await import('../../server/jobs/heartbeat');
        startHeartbeat();
        await vi.advanceTimersByTimeAsync(120000 * 10 + 1000);
        expect(runCognitiveCycle).not.toHaveBeenCalled();
        expect(triggerDiscoveryCycle).not.toHaveBeenCalled();
    });
});

describe('evolutionScheduler (index.ts + PowerManager reactivation route)', () => {
    beforeEach(() => { vi.resetModules(); });

    async function loadScheduler() {
        vi.doMock('../../services/tools/toolEvolver', () => ({ toolEvolver: {} }));
        vi.doMock('../../services/introspectionEngine', () => ({ introspection: {} }));
        vi.doMock('../../services/factory/squadFactory', () => ({ squadFactory: {} }));
        vi.doMock('../../services/remediationService', () => ({ remediation: {} }));
        vi.doMock('../../services/systemBus', () => ({ systemBus: { emit: vi.fn(), on: vi.fn(), subscribe: vi.fn() } }));
        return await import('../../services/evolution/evolutionScheduler');
    }

    it('schedules no loop when the ceiling denies both tasks', async () => {
        const { evolutionScheduler } = await loadScheduler();
        await warm(['../../services/powerManager', '../../server/config/configLoader', '../../services/daemon/autonomyPolicy']);
        vi.useFakeTimers();
        evolutionScheduler.start();
        await vi.advanceTimersByTimeAsync(0); // flush dynamic imports
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('schedules allowed loops only when the ceiling is on', async () => {
        knobs.autonomy = { ...ON };
        const { evolutionScheduler } = await loadScheduler();
        await warm(['../../services/powerManager', '../../server/config/configLoader', '../../services/daemon/autonomyPolicy']);
        vi.useFakeTimers();
        evolutionScheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        // toolEvolution interval + goalExecution interval + 30s initial timeout
        expect(vi.getTimerCount()).toBeGreaterThanOrEqual(3);
    });

    it('master off schedules nothing even with allowEvolution=true', async () => {
        knobs.autonomy = { ...ON, enabled: false };
        const { evolutionScheduler } = await loadScheduler();
        await warm(['../../services/powerManager', '../../server/config/configLoader', '../../services/daemon/autonomyPolicy']);
        vi.useFakeTimers();
        evolutionScheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('learningLoop tick (PowerManager throttle reader)', () => {
    beforeEach(() => { vi.resetModules(); });

    it('skips the scheduled analysis while throttled, runs when not', async () => {
        vi.useFakeTimers();
        vi.doMock('../../services/backgroundLLMService', () => ({ backgroundLLM: {} }));
        vi.doMock('../../services/continuumMemory', () => ({ continuum: {} }));
        vi.doMock('../../services/systemBus', () => ({ systemBus: { emit: vi.fn(), on: vi.fn(), subscribe: vi.fn() } }));
        const { learningLoop } = await import('../../services/learningLoop');
        await warm(['../../services/powerManager']);
        const analyze = vi.spyOn(learningLoop, 'analyzeFailures').mockResolvedValue([] as any);

        knobs.power.isLearningLoopEnabled = false;
        learningLoop.schedulePeriodicAnalysis(60000);
        await vi.advanceTimersByTimeAsync(60000);
        expect(analyze).not.toHaveBeenCalled();

        knobs.power.isLearningLoopEnabled = true;
        await vi.advanceTimersByTimeAsync(60000);
        expect(analyze).toHaveBeenCalledTimes(1);
    });
});

describe('narrativeService batch tick (PowerManager throttle reader)', () => {
    beforeEach(() => { vi.resetModules(); });

    it('pauses batch processing while throttled', async () => {
        vi.useFakeTimers();
        vi.doMock('../../services/geminiService', () => ({ generateAgentResponse: vi.fn() }));
        vi.doMock('../../services/llm/defaultModels', () => ({ DEFAULT_OPENROUTER_MODEL: 'test-model' }));
        vi.doMock('../../services/systemBus', () => ({ systemBus: { emit: vi.fn(), on: vi.fn(), subscribe: vi.fn() }, MessageTag: {} }));
        const { narrative } = await import('../../services/narrativeService');
        await warm(['../../services/powerManager', '../../services/systemBus', '../../types']);
        const batch = vi.spyOn(narrative as any, 'processNarrationBatch').mockResolvedValue(undefined);

        knobs.power.isNarrativeEnabled = false;
        await vi.advanceTimersByTimeAsync(30000);
        expect(batch).not.toHaveBeenCalled();

        knobs.power.isNarrativeEnabled = true;
        await vi.advanceTimersByTimeAsync(30000);
        expect(batch).toHaveBeenCalled();
    });
});

describe('neuroCognitive self-started heartbeat (constructor route)', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.restoreAllMocks(); });

    async function loadNeuro() {
        vi.doUnmock('../../services/neuroCognitiveService');
        vi.doMock('../../services/graphService', () => ({ graph: {} }));
        vi.doMock('../../services/introspectionEngine', () => ({ introspection: {} }));
        vi.doMock('../../services/geminiService', () => ({ generateText: vi.fn() }));
        vi.doMock('../../services/systemBus', () => ({ systemBus: { emit: vi.fn(), on: vi.fn(), subscribe: vi.fn() } }));
        vi.doMock('../../services/eurekaService', () => ({ eureka: {} }));
        vi.doMock('../../services/discoveryJournal', () => ({ discoveryJournal: {} }));
        return await import('../../services/neuroCognitiveService');
    }

    it('constructor auto-start heartbeat respects the ceiling on every tick', async () => {
        // Warm tick imports first, then fake timers, THEN the import whose
        // constructor registers the deferred 30s start - so the constructor
        // timeout lives under fake timers.
        await warm(['../../server/config/configLoader', '../../services/daemon/autonomyPolicy', '../../services/powerManager']);
        vi.useFakeTimers();
        const { neuroCognitive } = await loadNeuro();
        const spy = vi.spyOn(neuroCognitive, 'triggerDiscoveryCycle').mockResolvedValue(undefined);
        vi.spyOn(Math, 'random').mockReturnValue(0.5); // pass the stochastic gate
        await vi.advanceTimersByTimeAsync(30000); // constructor-deferred start
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // first tick
        expect(spy).not.toHaveBeenCalled();
    });

    it('ticks when ceiling and throttle allow (capability preserved)', async () => {
        knobs.autonomy = { ...ON };
        await warm(['../../server/config/configLoader', '../../services/daemon/autonomyPolicy', '../../services/powerManager']);
        vi.useFakeTimers();
        const { neuroCognitive } = await loadNeuro();
        const spy = vi.spyOn(neuroCognitive, 'triggerDiscoveryCycle').mockResolvedValue(undefined);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        await vi.advanceTimersByTimeAsync(30000);
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
