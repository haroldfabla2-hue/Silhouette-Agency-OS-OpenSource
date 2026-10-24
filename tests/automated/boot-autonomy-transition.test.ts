/**
 * Boot OFF->ON transition - initServer (the real boot loader) with the real
 * autonomy policy and a mutable config snapshot. Proves:
 *  A) boot with the ceiling OFF starts NO proactive loop but DOES complete
 *     the full boot (maintenance, persistence, janitor, scheduler all start);
 *  B) boot with the ceiling ON starts EVERY proactive loop (capability
 *     preserved: the OFF->ON transition via config edit + restart restores
 *     full startup);
 *  C) unreadable config fails closed (no proactive loop) without breaking boot.
 *
 * Isolated and free: every database, AI service and network-touching module
 * is a declared double; no provider calls, no prod. The autonomy policy and
 * the boot loader are the REAL modules under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OFF = { enabled: false, allowEvolution: false, enableNarrative: false, enableIntrospection: false };
const ON = { enabled: true, allowEvolution: true, enableNarrative: true, enableIntrospection: true };

const knobs = { autonomy: { ...OFF } as any, throwConfig: false };

vi.mock('../../server/config/configLoader', () => ({
    configLoader: {
        getConfig: () => {
            if (knobs.throwConfig) throw new Error('config unreadable (test)');
            return { autonomy: knobs.autonomy };
        }
    }
}));

const spies = {
    startDreamingLoop: vi.fn(),
    schedulePeriodicAnalysis: vi.fn(),
    scheduleEvolutionCycles: vi.fn(),
    analyzeFailures: vi.fn().mockResolvedValue([]),
    startHeartbeat: vi.fn(),
    startPersistenceJobs: vi.fn(),
    runMaintenance: vi.fn().mockResolvedValue(undefined),
    schedulerStart: vi.fn(),
    initNervous: vi.fn().mockResolvedValue(undefined),
};

function mockAll() {
    vi.doMock('../../server/loaders/dbLoader', () => ({ initDatabases: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../../server/loaders/aiLoader', () => ({ initAIServices: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../../server/routes/v1/context.routes', () => ({ initializeContextConfig: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('../../services/contextJanitor', () => ({ contextJanitor: { runMaintenance: spies.runMaintenance } }));
    vi.doMock('../../services/media/voiceMonitorService', () => ({ voiceMonitor: { startMonitoring: vi.fn() } }));
    vi.doMock('../../services/connectionNervousSystem', () => ({ initializeNervousSystem: spies.initNervous }));
    vi.doMock('../../services/schedulerService', () => ({ schedulerService: { start: spies.schedulerStart } }));
    vi.doMock('../../services/learningLoop', () => ({
        learningLoop: { schedulePeriodicAnalysis: spies.schedulePeriodicAnalysis, analyzeFailures: spies.analyzeFailures }
    }));
    vi.doMock('../../services/tools/toolEvolver', () => ({ toolEvolver: { scheduleEvolutionCycles: spies.scheduleEvolutionCycles } }));
    vi.doMock('../../services/dreamerService', () => ({ dreamer: { startDreamingLoop: spies.startDreamingLoop } }));
    vi.doMock('../../server/jobs/heartbeat', () => ({ startHeartbeat: spies.startHeartbeat }));
    vi.doMock('../../server/jobs/persistence', () => ({ startPersistenceJobs: spies.startPersistenceJobs }));
}

async function boot() {
    vi.resetModules();
    mockAll();
    // Warm the modules initServer dynamic-imports inside timers/gates so the
    // fake-timer advance executes them (first-time loads do not complete
    // inside an advance).
    await import('../../server/config/configLoader');
    await import('../../services/daemon/autonomyPolicy');
    await import('../../services/dreamerService');
    await import('../../services/schedulerService');
    await import('../../services/connectionNervousSystem');
    const { initServer } = await import('../../server/loaders/index');
    vi.useFakeTimers();
    await initServer();
    await vi.advanceTimersByTimeAsync(35000); // fire 3s/5s/30s deferred starts
    vi.useRealTimers();
}

beforeEach(() => {
    knobs.autonomy = { ...OFF };
    knobs.throwConfig = false;
    for (const s of Object.values(spies)) s.mockClear();
});

describe('boot OFF -> ON transition (isolated, free)', () => {
    it('A) boot with ceiling OFF: no proactive loop starts, full boot completes', async () => {
        await boot();
        // Proactive loops: NOT started
        expect(spies.startDreamingLoop).not.toHaveBeenCalled();
        expect(spies.schedulePeriodicAnalysis).not.toHaveBeenCalled();
        expect(spies.scheduleEvolutionCycles).not.toHaveBeenCalled();
        expect(spies.analyzeFailures).not.toHaveBeenCalled();
        // The heartbeat JOB registers at boot in both worlds; its ceiling is
        // per-cycle inside the job (covered by autonomy-entry-points tests).
        expect(spies.startHeartbeat).toHaveBeenCalledTimes(1);
        // Maintenance and boot completion: always
        expect(spies.startPersistenceJobs).toHaveBeenCalledTimes(1);
        expect(spies.runMaintenance).toHaveBeenCalledTimes(1);
        expect(spies.schedulerStart).toHaveBeenCalledTimes(1);
        expect(spies.initNervous).toHaveBeenCalledTimes(1);
    });

    it('B) boot with ceiling ON: every proactive loop starts (capability preserved)', async () => {
        knobs.autonomy = { ...ON };
        await boot();
        expect(spies.startDreamingLoop).toHaveBeenCalledTimes(1);
        expect(spies.schedulePeriodicAnalysis).toHaveBeenCalledTimes(1);
        expect(spies.scheduleEvolutionCycles).toHaveBeenCalledTimes(1);
        expect(spies.analyzeFailures).toHaveBeenCalledTimes(1); // 30s initial analysis
        expect(spies.startHeartbeat).toHaveBeenCalledTimes(1);
        expect(spies.startPersistenceJobs).toHaveBeenCalledTimes(1);
        expect(spies.runMaintenance).toHaveBeenCalledTimes(1);
        expect(spies.schedulerStart).toHaveBeenCalledTimes(1);
    });

    it('C) unreadable config fails closed and boot still completes', async () => {
        knobs.throwConfig = true;
        await boot();
        expect(spies.startDreamingLoop).not.toHaveBeenCalled();
        expect(spies.schedulePeriodicAnalysis).not.toHaveBeenCalled();
        expect(spies.scheduleEvolutionCycles).not.toHaveBeenCalled();
        expect(spies.startPersistenceJobs).toHaveBeenCalledTimes(1);
        expect(spies.schedulerStart).toHaveBeenCalledTimes(1);
    });
});
