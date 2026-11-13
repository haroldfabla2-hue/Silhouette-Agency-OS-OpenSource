// Lightweight per-module-graph publication owner. No app startup, timers or I/O.
// Type import erases at runtime, preserving the source dependency boundary.
type ContinuumInstance = typeof import('./continuumMemory').continuum;
let published: ContinuumInstance | undefined;
let publish!: (instance: ContinuumInstance) => void;
export const continuumInstanceOwner: Promise<ContinuumInstance> = new Promise(resolve => { publish = resolve; });
export function publishContinuumInstance(instance: ContinuumInstance): void {
    if (published && published !== instance) throw new Error('Continuum instance already published for this graph');
    published = instance;
    publish(instance);
}
