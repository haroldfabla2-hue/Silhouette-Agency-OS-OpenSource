/** Finite isolated-test latches. No callbacks, content, service imports or fake
 * outcomes. Default disabled and call sites do not await when disabled.
 * Each stage may be armed once; an unreleased original blocks and must FAIL
 * its external supervisor, never self-resolve on timeout.
 */
import { OwnershipConflict } from './host';
export const finiteContinuumCheckpointsEnabled = typeof process !== 'undefined'
    && process.env.NODE_ENV === 'test' && process.env.SILHOUETTE_FINITE_CONTINUUM === 'exact-original-boundaries-v1';
const names = ['concept-before-store', 'identity-after-query', 'store-claimed-before-hydration', 'power-before-import', 'eureka-fired-before-body', 'notification-hard-cap'] as const;
export type FiniteContinuumStage = typeof names[number];
type Gate = { hits: number; released: boolean; entered: Promise<void>; enter: () => void; hold: Promise<void>; release: () => void };
const gates = new Map<FiniteContinuumStage, Gate>();
export function armFiniteContinuumStage(stage: FiniteContinuumStage): void {
    if (!finiteContinuumCheckpointsEnabled || !names.includes(stage) || gates.has(stage)) throw new OwnershipConflict('Invalid/duplicate finite checkpoint arm');
    let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    gates.set(stage, {hits:0,released:false,entered,enter,hold,release});
}
export function enterFiniteContinuumStage(stage: FiniteContinuumStage): Promise<void> {
    const gate = gates.get(stage); if (!gate) return Promise.resolve();
    if (++gate.hits > 128) throw new OwnershipConflict('Finite checkpoint hit capacity');
    gate.enter(); return gate.hold;
}
export function awaitFiniteContinuumStage(stage: FiniteContinuumStage): Promise<void> {
    const gate = gates.get(stage); if (!gate) throw new OwnershipConflict('Unarmed finite checkpoint'); return gate.entered;
}
export function releaseFiniteContinuumStage(stage: FiniteContinuumStage): void {
    const gate = gates.get(stage); if (!gate || gate.released) throw new OwnershipConflict('Invalid/replayed finite release');
    gate.released = true; gate.release();
}
export function finiteContinuumStageSnapshot() {
    return names.map(stage => ({stage,hits:gates.get(stage)?.hits ?? 0,released:gates.get(stage)?.released ?? false}));
}
