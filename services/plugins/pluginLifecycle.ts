import { ResourceScope, type ScopeReport, type OwnedResource } from '../../server/runtime/resourceScope';

/** Cooperative registration only, not a sandbox for arbitrary module top-level code. */
export interface PluginLifecycleContext {
    readonly signal: AbortSignal;
    readonly accepting: boolean;
    own(resource: OwnedResource): void;
    run<T>(name: string, operation: () => T | Promise<T>): Promise<T>;
    interval(name: string, milliseconds: number, operation: () => unknown | Promise<unknown>): void;
    timeout(name: string, milliseconds: number, operation: () => unknown | Promise<unknown>): void;
}
export interface PluginLifecycleDeclaration {
    version: 1;
    passiveModuleReviewed: boolean;
}
export type PluginLifecycleVerdict = 'COOPERATIVE_SCOPE_ONLY_UNVERIFIED' | 'LEGACY_UNMANAGED_UNVERIFIED';
export class PluginResourceOwner {
    readonly context: PluginLifecycleContext;
    readonly verdict: PluginLifecycleVerdict;
    private readonly scope: ResourceScope;
    constructor(readonly pluginId: string, declaration?: PluginLifecycleDeclaration) {
        this.scope = new ResourceScope(`plugin:${pluginId}`);
        this.context = this.scope;
        this.verdict = declaration?.version === 1 && declaration.passiveModuleReviewed
            ? 'COOPERATIVE_SCOPE_ONLY_UNVERIFIED' : 'LEGACY_UNMANAGED_UNVERIFIED';
    }
    /** Caller must retain this owner before invoking onInit or onStart.
     * A hook failure rolls back owned resources, and remains failed to its caller. */
    async hook(name: string, hook?: (context: PluginLifecycleContext) => Promise<void>): Promise<void> {
        if (!hook) return;
        try { await this.scope.run(name, () => hook(this.context)); }
        catch (error) { await this.scope.close(); throw error; }
    }
    run<T>(name: string, work: () => T | Promise<T>): Promise<T> { return this.scope.run(name, work); }
    close(): Promise<ScopeReport> { return this.scope.close(); }
}
