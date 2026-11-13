import { expect } from 'vitest';
import { getPublishedContinuumInstance } from '../../services/continuumInstanceOwner';

type Graph = {
    memory: typeof import('../../services/continuumMemory');
    initial: typeof import('../../services/introspectionEngine');
    health: typeof import('../../services/providerHealthManager');
    redis: typeof import('../../services/redisClient');
};
export type BootstrapCapture = {
    memory: ReturnType<typeof getPublishedContinuumInstance>;
    modules: Promise<PromiseSettledResult<Graph[keyof Graph]>[]>;
};
/** Called ONLY in actual test path, before assertions, not from teardown. */
export function captureStartedBootstrap(): BootstrapCapture | undefined {
    const memory = getPublishedContinuumInstance();
    if (!memory) return undefined; // No intentionally pending publication owner.
    const modules = Promise.allSettled([
        import('../../services/introspectionEngine'),
        import('../../services/providerHealthManager'),
        import('../../services/redisClient')
    ]);
    // allSettled retains every original import failure, no reset/new singleton.
    return { memory, modules };
}

/** Teardown observes only retained references/promises. It initiates NO imports. */
export async function observePublicBootstrap(capture: BootstrapCapture | undefined): Promise<void> {
    if (!capture) { console.log('SNAPSHOT_DIAGNOSTIC_TERMINAL ' + JSON.stringify({ status: 'DIAGNOSTIC_INCOMPLETE', reason: 'NOT_OBSERVED' })); console.log('PUBLIC_BOOTSTRAP_INCOMPLETE_NOT_OBSERVED: publication snapshot absent; pending import/owner race unresolved'); return; }
    const failures: unknown[] = [];
    const modules = await capture.modules;
    for (const result of modules) if (result.status === 'rejected') failures.push(result.reason);
    const memory = { continuum: capture.memory! };
    const initial = modules[0].status === 'fulfilled' ? modules[0].value as Graph['initial'] : undefined;
    const health = modules[1].status === 'fulfilled' ? modules[1].value as Graph['health'] : undefined;
    const redis = modules[2].status === 'fulfilled' ? modules[2].value as Graph['redis'] : undefined;
    const coreAndInitial = await Promise.allSettled([
        memory.continuum.readyCore(), ...(initial ? [initial.introspection.readyInitial()] : [])
    ]);
    for (const result of coreAndInitial) if (result.status === 'rejected') failures.push(result.reason);
    // Collect every reachable effect owner BEFORE assertions/logging can throw.
    const conceptEffect = initial?.introspection.getInitialConceptEffectOwner();
    const effects = await Promise.allSettled([
        ...(health ? [health.providerHealth.settlePersistence()] : []),
        memory.continuum.settleMemoryEffects(),
        ...(conceptEffect ? [conceptEffect] : [])
    ]);
    for (const result of effects) if (result.status === 'rejected') failures.push(result.reason);
    try {
    // Capture all reached state before any assertion can stop observation.
    console.log('ACTUAL_PUBLIC_BOOTSTRAP_OWNER_STATES:', {
        core: memory.continuum.getCoreRecoveryReport(),
        initial: initial?.introspection.getInitialWorkStatus(),
        coherenceObservations: initial?.introspection.getCoherenceObservationStatus(),
        snapshotOperations: memory.continuum.getSnapshotOperations(),
        memoryEffectOperations: memory.continuum.getMemoryEffectOperations(),
        healthPersistence: health?.providerHealth.getPersistenceStatus(),
        moduleOutcomes: modules.map(result => result.status),
        readinessOutcomes: coreAndInitial.map(result => result.status),
        effectOutcomes: effects.map(result => result.status),
        scope: 'retained graph only; not future admission barrier or global drain'
    });
        const core = memory.continuum.getCoreRecoveryReport();
        expect(core?.outcome).not.toBe('FAILED');
        // DEGRADED is not renamed COMPLETE. No snapshot durability receipt inferred.
        console.log('PUBLIC_BOOTSTRAP_CORE_RECOVERY:', core);
        expect(initial).toBeDefined();
        expect(health).toBeDefined();
        const status = initial!.introspection.getInitialWorkStatus();
        expect(status.concept.state).toBe('COMPLETE');
        expect(status.goals.state).toBe('COMPLETE');
        expect(memory.continuum.getSnapshotOperations()).toEqual([]);
        expect(memory.continuum.getMemoryEffectOperations()).toEqual([]);
        expect(health!.providerHealth.getPersistenceStatus().operations).toEqual([]);
        if (conceptEffect) expect((await conceptEffect).state).toBe('COMPLETE');
    } catch (error) { failures.push(error); }
    // Separate terminal metadata status, never changes original storage failure.
    try {
        console.log('SNAPSHOT_DIAGNOSTIC_TERMINAL ' + JSON.stringify(memory.continuum.getSnapshotDiagnosticStatus()));
    } catch (error) { failures.push(error); }
    // Disconnect ONLY after initial work and admitted effects have been observed.
    try { if (redis) await redis.redisClient.disconnect(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Public bootstrap/effects failed or incomplete; not a global drain');
}
