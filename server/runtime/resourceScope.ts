import { AsyncLocalStorage } from 'node:async_hooks';
/** One process generation. No imports of product services and no work at module load.
 * This boundary records application receipts, not OS/native release by inference. */
export type ReleaseState = 'RELEASED' | 'PROCESS_OWNED_UNVERIFIED_UNTIL_NATURAL_EXIT' | 'UNVERIFIED';
export interface ReleaseReceipt { state: ReleaseState; detail?: string }
export interface OwnedResource {
    name: string;
    /** Higher ranks close first after all work drains; acquisition order breaks ties. */
    closeRank?: number;
    stopIntake?: () => void | Promise<void>;
    flush?: () => void | Promise<void>;
    close: () => void | ReleaseReceipt | Promise<void | ReleaseReceipt>;
}
export type DiagnosticDisposition = 'RECOVERED_RETRY' | 'DEGRADED_FALLBACK' | 'OPERATION_REJECTED' | 'UNCLASSIFIED';
export interface ScopeDiagnostic { resource: string; error: unknown; disposition: DiagnosticDisposition; originalCapability: 'RESTORED' | 'UNAVAILABLE' | 'UNVERIFIED' }
export interface ScopeFailure { phase: string; resource: string; error: unknown }
export interface ScopeReport {
    state: 'CLOSED' | 'FAILED';
    failures: ScopeFailure[];
    diagnostics: ScopeDiagnostic[];
    originalCapabilitiesVerified: boolean;
    releases: Array<{ name: string; receipt: ReleaseReceipt }>;
    fullyReleased: boolean;
}
export class ScopeClosingError extends Error {
    constructor(readonly scope: string) { super(`Resource scope ${scope} is closing; work was not accepted`); }
}

export class ResourceScope {
    private state: 'OPEN' | 'QUIESCING' | 'DRAINING' | 'CLOSED' | 'FAILED' = 'OPEN';
    private readonly resources: OwnedResource[] = [];
    private readonly execution = new AsyncLocalStorage<{ active: boolean }>();
    private readonly pending = new Set<Promise<unknown>>();
    private readonly released = new WeakSet<OwnedResource>();
    private readonly failures: ScopeFailure[] = [];
    private readonly diagnostics: ScopeDiagnostic[] = [];
    private readonly releases: ScopeReport['releases'] = [];
    private closing?: Promise<ScopeReport>;
    private finalReport?: ScopeReport;
    private readonly abortController = new AbortController();
    constructor(readonly name: string) {}
    get signal(): AbortSignal { return this.abortController.signal; }
    get accepting(): boolean { return this.state === 'OPEN'; }
    assertAccepting(): void { if (!this.accepting) throw new ScopeClosingError(this.name); }
    /** Synchronous API calls may continue an already admitted async task. */
    assertWorkAccepted(): void {
        if (!this.accepting && !this.execution.getStore()?.active) throw new ScopeClosingError(this.name);
    }
    /** Preserve native/operational failures even where compatibility requires a
     * caller-visible fallback. This is not a new retry or catch-to-success rule. */
    recordFailure(resource: string, error: unknown): void { this.failures.push({ phase: 'terminal', resource, error }); }
    recordDiagnostic(resource: string, error: unknown, disposition: DiagnosticDisposition = 'UNCLASSIFIED', originalCapability: ScopeDiagnostic['originalCapability'] = 'UNVERIFIED'): ScopeDiagnostic {
        const receipt = { resource, error, disposition, originalCapability };
        this.diagnostics.push(receipt);
        return receipt;
    }
    getFailures(): ScopeFailure[] { return [...this.failures]; }
    getDiagnostics(): ScopeDiagnostic[] { return [...this.diagnostics]; }

    private observe<T>(name: string, promise: Promise<T>): Promise<T> {
        this.pending.add(promise);
        void promise.then(
            () => { this.pending.delete(promise); },
            error => { this.pending.delete(promise); this.recordDiagnostic(name, error, 'OPERATION_REJECTED', 'UNVERIFIED'); },
        );
        return promise;
    }
    /** Factory is invoked only after admission. A rejected receipt remains rejected. */
    run<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
        // An accepted callback may call another scoped method after an await.
        // Only its still-active task context can continue; detached callbacks after
        // its receipt settles cannot reuse the admission. New acquisition remains fenced.
        if (!this.accepting && !this.execution.getStore()?.active) return Promise.reject(new ScopeClosingError(this.name));
        const token = { active: true };
        const task = Promise.resolve().then(() => this.execution.run(token, operation)).finally(() => { token.active = false; });
        return this.observe(name, task);
    }
    /** Must be called immediately after an actual acquisition, before another await.
     * A late acquisition is disposed and the disposal joins the drain set. */
    own(resource: OwnedResource): () => Promise<void> {
        const releaseEarly = () => {
            const index = this.resources.indexOf(resource);
            if (index >= 0) this.resources.splice(index, 1);
            return this.observe(`early-release:${resource.name}`, this.release(resource));
        };
        if (this.accepting) { this.resources.push(resource); return releaseEarly; }
        // A naked/untracked acquisition during close violates admission even if
        // its disposal succeeds. Record failure synchronously BEFORE scheduling cleanup,
        // so a final receipt can never have computed success in the microtask gap.
        this.failures.push({ phase: 'late-acquisition', resource: resource.name, error: new ScopeClosingError(this.name) });
        const cleanup = (async () => {
            await this.attempt('late-stop', resource.name, resource.stopIntake);
            await this.attempt('late-flush', resource.name, resource.flush);
            await this.release(resource);
        })();
        this.observe(`late-acquisition:${resource.name}`, cleanup);
        return releaseEarly;
    }
    /** Tracks pending acquisition before invocation; cancellation cannot drop its handle. */
    acquire<T>(name: string, acquire: () => Promise<T>, resource: (value: T) => OwnedResource): Promise<T> {
        return this.run(name, async () => {
            const value = await acquire();
            this.own(resource(value));
            if (!this.accepting) throw new ScopeClosingError(this.name);
            return value;
        });
    }
    interval(name: string, milliseconds: number, operation: () => unknown | Promise<unknown>): void {
        this.assertAccepting();
        const timer = setInterval(() => {
            if (this.accepting) void this.run(name, operation).catch(() => { /* retained in report */ });
        }, milliseconds);
        this.own({ name, stopIntake: () => clearInterval(timer), close: () => clearInterval(timer) });
    }
    timeout(name: string, milliseconds: number, operation: () => unknown | Promise<unknown>): void {
        this.assertAccepting();
        const timer = setTimeout(() => {
            if (this.accepting) void this.run(name, operation).catch(() => { /* retained in report */ });
        }, milliseconds);
        this.own({ name, stopIntake: () => clearTimeout(timer), close: () => clearTimeout(timer) });
    }
    private async attempt(phase: string, resource: string, operation?: () => unknown | Promise<unknown>): Promise<void> {
        try { await operation?.(); } catch (error) { this.failures.push({ phase, resource, error }); }
    }
    private async drain(): Promise<void> {
        while (this.pending.size) await Promise.allSettled([...this.pending]);
    }
    private async release(resource: OwnedResource): Promise<void> {
        if (this.released.has(resource)) return;
        this.released.add(resource);
        try {
            const receipt = await resource.close();
            this.releases.push({ name: resource.name, receipt: receipt || { state: 'RELEASED' } });
        } catch (error) {
            this.failures.push({ phase: 'close', resource: resource.name, error });
            this.releases.push({ name: resource.name, receipt: { state: 'UNVERIFIED', detail: 'close failed' } });
        }
    }
    /** Parent registers dependencies first: reverse order closes consumers first.
     * Child scopes must all be fenced by the application owner before its global drain. */
    close(): Promise<ScopeReport> {
        if (this.closing) return this.closing;
        this.state = 'QUIESCING';
        this.closing = Promise.resolve().then(async () => {
            // Publish the idempotent promise BEFORE invoking synchronous abort listeners.
            this.abortController.abort(new ScopeClosingError(this.name));
            const reverse = [...this.resources].reverse().sort((a, b) => (b.closeRank ?? 0) - (a.closeRank ?? 0));
            for (const resource of reverse) await this.attempt('stop-intake', resource.name, resource.stopIntake);
            this.state = 'DRAINING';
            await this.drain();
            for (const resource of reverse) await this.attempt('flush', resource.name, resource.flush);
            await this.drain();
            for (const resource of reverse) { await this.release(resource); await this.drain(); }
            this.resources.length = 0;
            this.state = this.failures.length ? 'FAILED' : 'CLOSED';
            const owner = this;
            // Live getters preserve a late contract violation in the SAME receipt.
            // The runtime must still own all acquisition factories before invocation.
            this.finalReport = {
                get state(): 'CLOSED' | 'FAILED' { return owner.failures.length || owner.pending.size ? 'FAILED' : 'CLOSED'; },
                failures: this.failures, diagnostics: this.diagnostics, releases: this.releases,
                get originalCapabilitiesVerified() { return owner.diagnostics.every(d => d.originalCapability === 'RESTORED'); },
                get fullyReleased() { return owner.failures.length === 0 && owner.pending.size === 0 && owner.releases.every(r => r.receipt.state === 'RELEASED'); },
            };
            return this.finalReport;
        });
        return this.closing;
    }
}
