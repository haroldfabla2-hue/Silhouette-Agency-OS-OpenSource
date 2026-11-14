import { RecoveryEvidence, type RecoveryObligation, type RecoveryObservation } from './recoveryEvidence';
/** Pure trusted-source bookkeeping. No Node imports, timers or I/O.
 * Service Scope facades contain closures only, never a Host/stop reference.
 */
export type Capacity = Readonly<{ scopes: number; active: number; failures: number; resources: number }>;
export type Disposition = 'CLOSED' | 'NOT_ACQUIRED' | 'INCOMPLETE';
export type Failure = Readonly<{ id: number; revision: 1; source: string; original: unknown }>;
export type ResourceEvidence = Readonly<{ source: string; disposition: Disposition; reason?: string; resourceId?: number }>;
export class AdmissionClosed extends Error {}
export class CapacityExceeded extends Error {}
export class OwnershipConflict extends Error {}
export type Operation = Readonly<{ id: number }>;
export type ChildReservation = Readonly<{ id: number }>;
export type ResourceReservation = Readonly<{ id: number }>;
export type HostReport = Readonly<{
    state: 'INCOMPLETE' | 'SETTLED_NO_FAILURE_RECORDED'; pending: number;
    failures: readonly Failure[]; acknowledged: number; lifetimeFailures: number; childGuardNotSelected: number;
    residuals: readonly string[]; resources: readonly ResourceEvidence[];
    coverage: 'EXPLICITLY_REGISTERED_WORK_ONLY';
    recovery: readonly RecoveryObservation[];
}>;
export type RetirementReport = Readonly<{
    scope: string; disposition: 'RETIRED' | 'INCOMPLETE'; reason?: string;
    pending: number;
}>;
export interface Scope {
    readonly label: string; readonly open: boolean;
    invoke<T>(name: string, body: (operation: Operation) => T, parent?: Operation): T;
    beginConstruction(): Operation;
    validateConstruction(operation: Operation): void;
    constructed(operation: Operation, instance: object): void;
    constructionFailed(operation: Operation, original: unknown): void;
    reserveChild(parent: Operation, exactName: string): ChildReservation;
    invokeChild<T>(reservation: ChildReservation, body: (operation: Operation) => T): T;
    abandonChild(reservation: ChildReservation, original: unknown): void;
    skipChild(reservation: ChildReservation, reason: 'ORIGINAL_GUARD_NOT_SELECTED'): void;
    reserveRecovery(operation: Operation, source: string, inputIdentity: object): RecoveryObligation;
    recoveryAttemptFailed(obligation: RecoveryObligation, operation: Operation, inputIdentity: object,
        original: unknown, acquired: readonly object[]): void;
    recoveryFulfilled(obligation: RecoveryObligation, operation: Operation, inputIdentity: object, originalResult: unknown, inputEquivalence: 'UNVERIFIED' | 'GRAPH_DRIVER_INPUTS_EQUAL'): void;
    recoveryTerminal(obligation: RecoveryObligation, operation: Operation, inputIdentity: object): void;
    reserveResource(operation: Operation, exactName: string): ResourceReservation;
    acquire(reservation: ResourceReservation, value: object, close: (() => unknown) | undefined,
        verify: () => ResourceEvidence, dependencies?: readonly object[], closePolicy?: 'SINGLE_ATTEMPT' | 'NEO4J_DRIVER_SOURCE_MANAGED'): void;
    releaseUnused(reservation: ResourceReservation): void;
    closeResource(operation: Operation, value: object): unknown;
    failure(source: string, original: unknown): void;
    unknown(source: string, evaluation?: boolean): void;
    onSeal(stop: () => unknown): void;
}
/** Bootstrap-only authority. Services receive Scope, never this object. */
export interface Host {
    scope(label: string): Scope;
    stop(): Promise<HostReport>;
    retire(scope: Scope): Promise<RetirementReport>;
    acknowledge(original: Failure): void;
    failure(source: string, original: unknown): void;
    unknown(source: string, evaluation?: boolean): void;
}
type State = { scope: Scope; live: boolean; children: Set<Promise<void>>; done: Promise<void>; finish: () => void };
type Child = { scope: Scope; source: string; parent: State; live: boolean; done: Promise<void>; finish: () => void };
type Permit = { scope: Scope; operation: State; label: string; live: boolean };
type Resource = { id: number; scope: Scope; source: string; value: object; close?: () => unknown; verify: () => ResourceEvidence; dependsOn: Set<object> };

export function createHost(capacity: Capacity): Host {
    return new Core(capacity).controller();
}
class Core {
    #phase: 'OPEN' | 'SEALED' | 'RELEASING' | 'CLOSED' = 'OPEN';
    #scopes = new Map<Scope, { stoppers: (() => unknown)[]; sealed: boolean;
        active: Set<Promise<void>>; retirement?: Promise<RetirementReport> }>();
    #operations = new WeakMap<Operation, State>();
    #children = new WeakMap<ChildReservation, Child>();
    #resources = new Map<object, Resource>();
    #constructions = new Map<Scope, { operation: Operation; phase: 'CONSTRUCTING' | 'PUBLISHED' | 'FAILED'; instance?: object; original?: unknown }>();
    #permits = new WeakMap<ResourceReservation, Permit>();
    #active = new Set<Promise<void>>();
    #reservedActive = 0;
    #reservedResources = 0;
    #lifetimeFailures = 0;
    #childGuardNotSelected = 0;
    #failures: Failure[] = [];
    #residuals = new Set<string>();
    #releaseEvidence: ResourceEvidence[] = [];
    #nextId = 0;
    #acknowledged = 0;
    #stopTask?: Promise<HostReport>;
    #unsafeEvaluation = false;
    #invocationDepth = 0;
    #stopCallbackDepth = 0;
    #recovery: RecoveryEvidence;
    #retirementTasks = new Set<Promise<RetirementReport>>();
    constructor(private readonly capacity: Capacity) {
        for (const value of Object.values(capacity)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Explicit positive integer capacity required');
        this.#recovery = new RecoveryEvidence(capacity.failures);
    }
    controller(): Host {
        return Object.freeze({ scope: (label: string) => this.scope(label), stop: () => this.stop(),
            retire: (scope: Scope) => this.retire(scope),
            acknowledge: (failure: Failure) => this.acknowledge(failure),
            failure: (source: string, error: unknown) => this.failure(source, error),
            unknown: (source: string, evaluation = false) => this.unknown(source, evaluation) });
    }
    private scope(label: string): Scope {
        if (this.#phase !== 'OPEN') throw new AdmissionClosed(label);
        if (this.#scopes.size >= this.capacity.scopes) throw new CapacityExceeded(label);
        const core = this;
        const scope: Scope = Object.freeze({ label,
            get open() { return core.#phase === 'OPEN' && core.#scopes.get(scope)?.sealed === false; },
            invoke: <T>(name: string, body: (operation: Operation) => T, parent?: Operation) => this.invoke(scope, label + ':' + name, body, parent),
            beginConstruction: () => {
                if (this.#constructions.has(scope)) throw new OwnershipConflict('Construction already attempted for this exact scope');
                const operation = this.begin(scope, label + ':construction');
                this.#constructions.set(scope, { operation, phase: 'CONSTRUCTING' }); return operation;
            },
            validateConstruction: (operation: Operation) => {
                const record = this.#constructions.get(scope);
                if (!record || record.operation !== operation || record.phase !== 'CONSTRUCTING') throw new OwnershipConflict('Constructor requires its exact provisional record');
                this.state(scope, operation);
            },
            constructed: (operation: Operation, instance: object) => {
                const record = this.#constructions.get(scope);
                if (!record || record.operation !== operation || record.phase !== 'CONSTRUCTING') throw new OwnershipConflict('No matching provisional construction');
                record.phase = 'PUBLISHED'; record.instance = instance;
                this.end(operation, label + ':construction', { status: 'fulfilled', value: instance });
            },
            constructionFailed: (operation: Operation, original: unknown) => {
                const record = this.#constructions.get(scope);
                if (!record || record.operation !== operation || record.phase !== 'CONSTRUCTING') throw new OwnershipConflict('No matching provisional construction');
                record.phase = 'FAILED'; record.original = original;
                this.end(operation, label + ':construction', { status: 'rejected', reason: original });
            },
            reserveChild: (parent: Operation, name: string) => this.reserveChild(scope, parent, label + ':' + name),
            invokeChild: <T>(permit: ChildReservation, body: (operation: Operation) => T) => this.invokeChild(scope, permit, body),
            abandonChild: (permit: ChildReservation, original: unknown) => this.abandonChild(scope, permit, original),
            skipChild: (permit: ChildReservation, reason: 'ORIGINAL_GUARD_NOT_SELECTED') => {
                const child = this.#children.get(permit);
                if (!child?.live || child.scope !== scope || reason !== 'ORIGINAL_GUARD_NOT_SELECTED') throw new OwnershipConflict('Cannot skip invoked/foreign child');
                child.live = false; this.#reservedActive--; this.#active.delete(child.done); this.#scopes.get(scope)!.active.delete(child.done);
                if (this.#childGuardNotSelected < Number.MAX_SAFE_INTEGER) this.#childGuardNotSelected++;
                else this.unknown('CHILD_NOT_SELECTED_COUNT_OVERFLOW');
                child.finish();
            },
            reserveRecovery: (operation: Operation, source: string, inputIdentity: object) => {
                this.state(scope, operation);
                return this.#recovery.reserve(operation, label + ':' + source, inputIdentity);
            },
            recoveryAttemptFailed: (obligation: RecoveryObligation, operation: Operation, inputIdentity: object, original: unknown, acquired: readonly object[]) => {
                this.state(scope, operation);
                const ids = acquired.map(value => {
                    const resource = this.#resources.get(value);
                    if (!resource || resource.scope !== scope) throw new OwnershipConflict('Recovery cannot claim a foreign resource');
                    return resource.id;
                });
                const failure = this.failure(label + ':recoverable-attempt', original);
                if (!failure) { this.unknown(label + ':RECOVERY_FAILURE_NOT_RETAINED'); return; }
                this.#recovery.failed(obligation, operation, inputIdentity, failure, ids);
            },
            recoveryFulfilled: (obligation: RecoveryObligation, operation: Operation, inputIdentity: object, originalResult: unknown, inputEquivalence: 'UNVERIFIED' | 'GRAPH_DRIVER_INPUTS_EQUAL') => {
                if (inputEquivalence !== 'UNVERIFIED' && !(label === 'graph' && inputEquivalence === 'GRAPH_DRIVER_INPUTS_EQUAL')) throw new OwnershipConflict('Only fixed Graph source records exact driver input comparison');
                this.state(scope, operation); this.#recovery.fulfilled(obligation, operation, inputIdentity, originalResult, inputEquivalence);
            },
            recoveryTerminal: (obligation: RecoveryObligation, operation: Operation, inputIdentity: object) => {
                this.state(scope, operation); this.#recovery.failedTerminal(obligation, operation, inputIdentity);
            },
            reserveResource: (operation: Operation, name: string) => this.reserveResource(scope, operation, label + ':' + name),
            acquire: (permit: ResourceReservation, value: object, close: (() => unknown) | undefined, verify: () => ResourceEvidence, dependencies: readonly object[] = [], closePolicy: 'SINGLE_ATTEMPT' | 'NEO4J_DRIVER_SOURCE_MANAGED' = 'SINGLE_ATTEMPT') => this.acquire(scope, permit, value, close, verify, dependencies, closePolicy),
            releaseUnused: (permit: ResourceReservation) => this.releaseUnused(scope, permit),
            closeResource: (operation: Operation, value: object) => {
                this.state(scope, operation);
                const item = this.#resources.get(value);
                if (!item || item.scope !== scope) throw new OwnershipConflict('Cannot close borrowed/foreign resource');
                if (this.#unsafeEvaluation || this.#active.size !== 1 || this.#phase !== 'OPEN') throw new OwnershipConflict('Public close requires proved exclusive quiescence');
                if (!item.close) throw new OwnershipConflict('No supported resource close');
                return item.close();
            },
            failure: (source: string, error: unknown) => this.failure(label + ':' + source, error),
            unknown: (source: string, evaluation = false) => this.unknown(label + ':' + source, evaluation),
            onSeal: (stop: () => unknown) => {
                const record = this.#scopes.get(scope)!;
                if (record.sealed || this.#phase !== 'OPEN') throw new AdmissionClosed(label);
                record.stoppers.push(stop);
            },
        });
        this.#scopes.set(scope, { stoppers: [], sealed: false, active: new Set() }); return scope;
    }
    private unknown(source: string, evaluation = false): void {
        this.#residuals.add(source); if (evaluation) this.#unsafeEvaluation = true;
    }
    private failure(source: string, original: unknown): Failure | undefined {
        if (this.#lifetimeFailures < Number.MAX_SAFE_INTEGER) this.#lifetimeFailures++;
        else this.unknown('FAILURE_COUNT_OVERFLOW');
        if (this.#failures.length >= this.capacity.failures) { this.unknown('FAILURE_CAPACITY_EXHAUSTED'); return; }
        // A failure record is immutable, final, revision1. A later occurrence is
        // a NEW id, never an update. Exact object+id+revision acknowledgement
        // removes only that retained item; lifetime failure still makes FAIL.
        const record: Failure = Object.freeze({ id: ++this.#nextId, revision: 1, source, original });
        this.#failures.push(record); return record;
    }
    private acknowledge(original: Failure): void {
        const i = this.#failures.findIndex(x => x === original && x.id === original.id && x.revision === original.revision);
        if (i < 0) throw new OwnershipConflict('Stale or foreign failure acknowledgement');
        this.#failures.splice(i, 1); this.#acknowledged++;
    }
    private room(source: string): void {
        if (this.#active.size >= this.capacity.active || this.#failures.length >= this.capacity.failures || this.#residuals.has('FAILURE_CAPACITY_EXHAUSTED')) throw new CapacityExceeded(source);
    }
    private state(scope: Scope, token: Operation): State {
        const state = this.#operations.get(token);
        if (!state?.live || state.scope !== scope) throw new OwnershipConflict('Foreign or settled operation');
        return state;
    }
    private begin(scope: Scope, source: string, parent?: State, reservation?: Child): Operation {
        const owner = this.#scopes.get(scope);
        if (!owner || ((this.#phase !== 'OPEN' || owner.sealed) && !((this.#phase === 'OPEN' || this.#phase === 'SEALED') && reservation?.live))) throw new AdmissionClosed(source);
        if (!reservation) this.room(source);
        else { reservation.live = false; this.#reservedActive--; this.#active.delete(reservation.done); owner.active.delete(reservation.done); }
        let finish!: () => void;
        const done = new Promise<void>(yes => { finish = yes; });
        const token = Object.freeze({ id: ++this.#nextId });
        const state: State = { scope, live: true, children: new Set(), done, finish };
        this.#operations.set(token, state); this.#active.add(done); owner.active.add(done);
        if (reservation) void done.then(reservation.finish);
        else if (parent) { parent.children.add(done); void done.then(() => parent.children.delete(done)); }
        return token;
    }
    private end(token: Operation, source: string, result: PromiseSettledResult<unknown>): void {
        const state = this.#operations.get(token)!;
        if (!state.live) throw new OwnershipConflict('Double settlement');
        state.live = false;
        if (result.status === 'rejected') this.failure(source, result.reason);
        void Promise.all([...state.children]).then(() => {
            this.#active.delete(state.done); this.#scopes.get(state.scope)?.active.delete(state.done); state.finish();
        });
    }
    private observe<T>(token: Operation, source: string, body: (token: Operation) => T): T {
        let value: T;
        this.#invocationDepth++;
        try { value = body(token); }
        catch (reason) { this.end(token, source, { status: 'rejected', reason }); throw reason; }
        finally { this.#invocationDepth--; }
        // Native Promises only in reviewed product call sites. Do not touch a
        // foreign then getter twice or assimilate an arbitrary thenable.
        if (value instanceof Promise) void value.then(
            result => this.end(token, source, { status: 'fulfilled', value: result }),
            reason => this.end(token, source, { status: 'rejected', reason }));
        else this.end(token, source, { status: 'fulfilled', value });
        return value;
    }
    private invoke<T>(scope: Scope, source: string, body: (operation: Operation) => T, parent?: Operation): T {
        const p = parent ? this.state(scope, parent) : undefined;
        return this.observe(this.begin(scope, source, p), source, body);
    }
    private reserveChild(scope: Scope, parent: Operation, source: string): ChildReservation {
        const p = this.state(scope, parent);
        if (this.#phase !== 'OPEN' || this.#scopes.get(scope)?.sealed !== false) throw new AdmissionClosed(source);
        this.room(source);
        let finish!: () => void;
        const done = new Promise<void>(yes => { finish = yes; });
        const permit = Object.freeze({ id: ++this.#nextId });
        this.#children.set(permit, { scope, source, parent: p, live: true, done, finish });
        p.children.add(done); void done.then(() => p.children.delete(done));
        this.#active.add(done); this.#scopes.get(scope)!.active.add(done); this.#reservedActive++;
        return permit;
    }
    private invokeChild<T>(scope: Scope, permit: ChildReservation, body: (operation: Operation) => T): T {
        const child = this.#children.get(permit);
        if (!child?.live || child.scope !== scope) throw new OwnershipConflict('Foreign or consumed child reservation');
        // Reservation owns its own lifetime after parent public-body settlement.
        // Its exact source/capacity were fixed while the parent was live/open.
        const token = this.begin(scope, child.source, undefined, child);
        void this.#operations.get(token)!.done.then(() => this.#active.delete(child.done));
        return this.observe(token, child.source, body);
    }
    private abandonChild(scope: Scope, permit: ChildReservation, original: unknown): void {
        const child = this.#children.get(permit);
        if (!child?.live || child.scope !== scope) throw new OwnershipConflict('Foreign or consumed child reservation');
        child.live = false; this.#reservedActive--; this.#active.delete(child.done); this.#scopes.get(scope)!.active.delete(child.done);
        this.failure(child.source + ':NOT_INVOKED', original); child.finish();
    }
    private reserveResource(scope: Scope, token: Operation, label: string): ResourceReservation {
        const operation = this.state(scope, token);
        if (this.#phase === 'RELEASING' || this.#phase === 'CLOSED') throw new AdmissionClosed(label);
        if (this.#resources.size + this.#reservedResources >= this.capacity.resources) throw new CapacityExceeded(label);
        const permit = Object.freeze({ id: ++this.#nextId });
        this.#permits.set(permit, { scope, operation, label, live: true }); this.#reservedResources++; return permit;
    }
    private acquire(scope: Scope, reservation: ResourceReservation, value: object, close: (() => unknown) | undefined, verify: () => ResourceEvidence, dependencies: readonly object[], closePolicy: 'SINGLE_ATTEMPT' | 'NEO4J_DRIVER_SOURCE_MANAGED'): void {
        const p = this.#permits.get(reservation);
        if (!p?.live || p.scope !== scope || !p.operation.live || this.#phase === 'RELEASING' || this.#phase === 'CLOSED') throw new OwnershipConflict('Foreign, stale or consumed resource reservation');
        if (this.#resources.has(value)) throw new OwnershipConflict('Resource already owned');
        if (closePolicy !== 'SINGLE_ATTEMPT' && !(closePolicy === 'NEO4J_DRIVER_SOURCE_MANAGED' && scope.label === 'graph' && p.label === 'graph:driver-candidate')) throw new OwnershipConflict('Source-managed retry close limited to reviewed Neo4j driver candidate');
        p.live = false; this.#reservedResources--;
        // Public owner requests and host teardown share exactly ONE original
        // release attempt, result/Promise and error. No second destroy/close.
        let called = false, returned: unknown, thrown: unknown, didThrow = false;
        const once = close && (() => {
            if (called) { if (didThrow) throw thrown; return returned; }
            called = true;
            try { returned = close(); return returned; }
            catch (error) { thrown = error; didThrow = true; throw error; }
        });
        this.#resources.set(value, { id: ++this.#nextId, scope, source: p.label, value, close: closePolicy === 'NEO4J_DRIVER_SOURCE_MANAGED' ? close : once, verify, dependsOn: new Set(dependencies) });
    }
    private releaseUnused(scope: Scope, reservation: ResourceReservation): void {
        const p = this.#permits.get(reservation);
        if (!p?.live || p.scope !== scope) throw new OwnershipConflict('Foreign or consumed reservation');
        p.live = false; this.#reservedResources--;
    }
    private snapshot(): HostReport {
        return Object.freeze({ state: this.#lifetimeFailures || this.#residuals.size || this.#active.size || this.#reservedResources || this.#releaseEvidence.some(x => x.disposition === 'INCOMPLETE')
            ? 'INCOMPLETE' : 'SETTLED_NO_FAILURE_RECORDED', pending: this.#active.size,
            failures: Object.freeze([...this.#failures]), acknowledged: this.#acknowledged, lifetimeFailures: this.#lifetimeFailures, childGuardNotSelected: this.#childGuardNotSelected,
            residuals: Object.freeze([...this.#residuals]), resources: Object.freeze([...this.#releaseEvidence]), coverage: 'EXPLICITLY_REGISTERED_WORK_ONLY', recovery: this.#recovery.observe(this.#releaseEvidence) });
    }
    private retire(scope: Scope): Promise<RetirementReport> {
        if (this.#invocationDepth || this.#stopCallbackDepth) throw new OwnershipConflict('Reentrant retirement must not join its own work');
        const record = this.#scopes.get(scope);
        if (!record) throw new OwnershipConflict('Foreign or retired scope');
        if (record.retirement) return record.retirement;
        if (this.#phase !== 'OPEN') throw new AdmissionClosed('Host already stopping');
        record.sealed = true;
        // Publish task identity BEFORE any original producer callback runs.
        let resolve!: (result: RetirementReport) => void;
        record.retirement = new Promise<RetirementReport>(yes => { resolve = yes; });
        this.#retirementTasks.add(record.retirement);
        void record.retirement.then(() => this.#retirementTasks.delete(record.retirement!));
        void (async () => {
            const stops: Promise<unknown>[] = [];
            for (const stop of record.stoppers) {
                this.#stopCallbackDepth++;
                try { stops.push(Promise.resolve(stop()).catch(original => { this.failure(scope.label + ':retire-seal', original); })); }
                catch (original) { this.failure(scope.label + ':retire-seal', original); }
                finally { this.#stopCallbackDepth--; }
            }
            await Promise.allSettled(stops);
            while (record.active.size) await Promise.all([...record.active]);
            // No resource release or slot recycling from this incomplete
            // per-instance protocol. The product source frontier/borrow edges
            // are not yet proved. Global unsafe applies to resource-free scopes
            // too: unreturned callback work could still hold the instance.
            const reason = this.#unsafeEvaluation ? 'INSTANCE_FRONTIER_UNVERIFIED'
                : [...this.#resources.values()].some(resource => resource.scope === scope)
                    ? 'INSTANCE_RESOURCE_RETIREMENT_UNVERIFIED' : 'INSTANCE_SOURCE_DISPOSAL_PROOF_NOT_INSTALLED';
            this.unknown(scope.label + ':' + reason);
            resolve(Object.freeze({ scope: scope.label, disposition: 'INCOMPLETE', reason, pending: record.active.size }));
        })().catch(original => {
            this.failure(scope.label + ':retire', original); this.unknown(scope.label + ':RETIREMENT_INTERRUPTED', true);
            resolve(Object.freeze({ scope: scope.label, disposition: 'INCOMPLETE', reason: 'RETIREMENT_INTERRUPTED', pending: record.active.size }));
        });
        return record.retirement;
    }
    private stop(): Promise<HostReport> {
        if (this.#invocationDepth || this.#stopCallbackDepth) throw new OwnershipConflict('Reentrant stop must not join its own original work');
        if (this.#stopTask) return this.#stopTask;
        let resolve!: (r: HostReport) => void;
        this.#stopTask = new Promise<HostReport>(yes => { resolve = yes; }); this.#phase = 'SEALED';
        void (async () => {
            const stops: Promise<unknown>[] = [];
            for (const [scope, record] of this.#scopes) {
                if (record.sealed) continue;
                record.sealed = true;
                for (const stop of record.stoppers) {
                    this.#stopCallbackDepth++;
                    try { stops.push(Promise.resolve(stop()).catch(error => { this.failure(scope.label + ':seal', error); })); }
                    catch (error) { this.failure(scope.label + ':seal', error); }
                    finally { this.#stopCallbackDepth--; }
                }
            }
            await Promise.allSettled(stops);
            // Already-sealed per-instance callbacks are not invoked twice, but
            // their ongoing retirement joins still precede any host release.
            await Promise.allSettled([...this.#retirementTasks]);
            // Every unconsumed reserved child is itself in #active and in its
            // parent's children. invokeChild atomically exchanges that placeholder
            // for an active operation before executing user code. There is no
            // await/empty-active window. A never-disposed reservation stays here;
            // never force RELEASING on a timeout or call it completed.
            while (this.#active.size) await Promise.all([...this.#active]);
            this.#phase = 'RELEASING';
            const remaining = new Map(this.#resources), blocked = new Set<object>();
            if (this.#unsafeEvaluation) {
                for (const item of remaining.values()) this.#releaseEvidence.push({ resourceId: item.id, source: item.source, disposition: 'INCOMPLETE', reason: 'EVALUATION_UNKNOWN' });
                remaining.clear();
            }
            while (remaining.size) {
                const ready = [...remaining.values()].filter(candidate => ![...remaining.values()].some(other => other !== candidate && other.dependsOn.has(candidate.value)));
                if (!ready.length) {
                    for (const item of remaining.values()) this.#releaseEvidence.push({ resourceId: item.id, source: item.source, disposition: 'INCOMPLETE', reason: 'RESOURCE_DEPENDENCY_CYCLE' });
                    break;
                }
                for (const item of ready) {
                    remaining.delete(item.value);
                    let result: ResourceEvidence;
                    if (blocked.has(item.value)) result = { source: item.source, disposition: 'INCOMPLETE', reason: 'DEPENDENT_RELEASE_UNVERIFIED' };
                    else if (!item.close) result = { source: item.source, disposition: 'INCOMPLETE', reason: 'NO_SUPPORTED_CLOSE' };
                    else {
                        let closed = false;
                        try { await item.close(); closed = true; }
                        catch (error) { this.failure(item.source + ':close', error); }
                        if (!closed) result = { source: item.source, disposition: 'INCOMPLETE', reason: 'CLOSE_FAILED' };
                        else {
                            try { result = item.verify(); }
                            catch (error) { this.failure(item.source + ':verify', error); result = { source: item.source, disposition: 'INCOMPLETE', reason: 'VERIFY_FAILED' }; }
                        }
                    }
                    this.#releaseEvidence.push(Object.freeze({ ...result, resourceId: item.id }));
                    if (result.disposition === 'INCOMPLETE') for (const dependency of item.dependsOn) blocked.add(dependency);
                }
            }
            this.#phase = 'CLOSED'; resolve(this.snapshot());
        })().catch(error => {
            this.failure('host:stop', error); this.unknown('STOP_INTERRUPTED');
            const evidenced = new Set(this.#releaseEvidence.map(item => item.resourceId));
            for (const item of this.#resources.values()) if (!evidenced.has(item.id)) this.#releaseEvidence.push(Object.freeze({ resourceId: item.id, source: item.source, disposition: 'INCOMPLETE', reason: 'STOP_INTERRUPTED_BEFORE_RELEASE_EVIDENCE' }));
            // Previously collected releases remain in the report even if a
            // later bookkeeping/stop step unexpectedly throws.
            resolve(this.snapshot());
        });
        return this.#stopTask;
    }
}
