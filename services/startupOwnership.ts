/**
 * Neutral startup-ownership leaf. NO imports at all: this module's own
 * evaluation cannot fail because of the product, so a caller (e.g. a fixture)
 * may import it BEFORE importing the module whose construction it needs to
 * observe, and keep the SAME singleton handle even when that import rejects.
 *
 * Scope: ownership/settlement of ONE orchestrator startup per ticket. Not
 * general infrastructure, not a consumer gate, not a readiness proof: the
 * receipt reports SETTLEMENT of the init launch + its concrete continuation
 * (and a constructor/module-eval failure observed as such).
 *
 * Ordinary scope only: the single receipt builder reads own primitive fields
 * and frozen plain-data copies, and describeErrorValue is finite. No layer
 * here claims survival of OOM or mutated language globals.
 */

export type StartupStage = 'execute' | 'continuation' | 'fallback' | 'sync-init' | 'constructor' | 'module-eval' | 'settlement';
export type StartupEventKind = 'sync' | 'continuation' | 'fallback' | 'constructor' | 'builder' | 'violation';
export type SwarmStartupOutcome = 'ok' | 'degraded' | 'failed';
type TicketState = 'prepared' | 'claimed' | 'constructor-complete' | 'constructor-failed' | 'module-eval-failed' | 'settled';

/** Typed plain-data copy of the known GenesisReport fields (lengths and
 *  primitives only, made by the producer). Never a live reference. */
export interface GenesisReportSnapshot {
    readonly success: boolean;
    readonly agentsCreated: number;
    readonly agentsFailed: number;
    readonly protocolsLoaded: boolean;
    readonly validationPassed: boolean;
    readonly timestamp: number;
}

export interface SwarmStartupReceipt {
    readonly outcome: SwarmStartupOutcome;
    /** Settlement of the observed scope - never a verified-readiness claim. */
    readonly settled: true;
    readonly branch: 'genesis' | 'existing' | 'unknown';
    readonly fallbackUsed: boolean;
    /** False when the constructor aborted (fail-fast preserved) or the module
     *  never reached construction (module-eval failure domain). */
    readonly constructionCompleted: boolean;
    readonly genesisReport: GenesisReportSnapshot | null;
    /** Completed capability+conversation registration call pairs in the
     *  orchestrator's synchronous tail only; a completed call is not a
     *  persistence proof. Incremented per pair, so partial progress counts. */
    readonly orchestrationTailRegistrations: number;
    /** null = never observed; a frozen array = observed at the noted stage.
     *  An observed empty array is NOT the same as not-observed. */
    readonly knownAgentIdsSnapshot: readonly string[] | null;
    readonly knownAgentIdsObservedAt: string | null;
    readonly startupFailures: readonly string[];
    readonly degradedSignals: readonly string[];
    readonly unobservedFailureDomains: readonly string[];
    /** Invalid/late control calls received BEFORE settlement (e.g. a second
     *  adoptContinuation). Calls after settlement are rejected separately and
     *  never mutate this historical receipt. */
    readonly lateCallsAtSettlement: number;
    readonly settledAt: number;
}

/** Read-only handle: identity + the historical settlement promise. This is
 *  the ONLY view observers (fixtures included) ever get of the singleton. */
export interface StartupHandle {
    readonly id: number;
    readonly claimId: string;
    readonly settlement: Promise<SwarmStartupReceipt>;
}

/** Controls: used by the observed producer only. Never handed to observers
 *  of the singleton. */
export interface StartupTicket {
    readonly handle: StartupHandle;
    readonly settlement: Promise<SwarmStartupReceipt>;
    setBranch(branch: 'genesis' | 'existing'): void;
    setGenesisReportSnapshot(snapshot: GenesisReportSnapshot): void;
    setTailRegistrations(count: number): void;
    setKnownAgentIdsSnapshot(ids: unknown, observedAt: string): void;
    setUnobservedDomains(domains: readonly string[]): void;
    markFallbackUsed(): void;
    recordSyncFailure(error: unknown): void;
    /** Stage captured by the caller BEFORE any transition to 'fallback'. */
    recordContinuationError(stage: StartupStage, error: unknown): void;
    recordFallbackError(error: unknown): void;
    recordNonFatalFailure(domain: string, error: unknown): void;
    recordDegradedSignal(signal: string): void;
    /** Launch seal: the FIRST adoption is accepted only while the ticket is
     *  claimed (launch window); at constructor-terminal the work set is
     *  closed. A rejection of the adopted promise is observed immediately by
     *  a handler attached HERE, not later by the settler. ANY adoption
     *  outside the seal (including post-settlement) first gets a defensive
     *  observer so the stray promise can never become an unhandled
     *  rejection, and is then counted/rejected; it never overwrites owned
     *  work and never enters the historical receipt as success. */
    adoptContinuation(continuation: Promise<unknown>): void;
    /** Terminal ONLY for a never-claimed ticket (import rejected before any
     *  construction). On a claimed ticket it is recorded as an event and the
     *  settlement keeps waiting for the constructor-terminal signal. */
    markModuleEvalFailure(error: unknown): void;
    markConstructionComplete(): void;
    /** Records the failure; the CALLER rethrows the exact same value. */
    markConstructionFailed(error: unknown): void;
}

const MAX_STRING = 500;

/**
 * Finite serialization that NEVER executes foreign code: no getters, no
 * toString, no reflection, no instanceof, no constructor names. Primitives
 * are capped; symbols/functions/objects (including Errors and Proxies) become
 * fixed opaque tags. The original reference is retained only in the ticket's
 * private diagnostics slot, never exported in the receipt.
 */
function describeErrorValue(value: unknown): string {
    switch (typeof value) {
        case 'string':
            return value.length <= MAX_STRING ? value : `${value.slice(0, MAX_STRING)}…[truncated ${value.length}]`;
        case 'number':
        case 'boolean':
            return String(value); // primitive coercion only
        case 'undefined':
            return '[throw: undefined]';
        case 'bigint':
            return '[bigint]';
        case 'symbol':
            return '[symbol]';
        case 'function':
            return '[function]';
        default:
            return value === null ? '[throw: null]' : '[object]';
    }
}

let nextTicketId = 1;

class InternalTicket implements StartupTicket {
    readonly handle: StartupHandle;
    readonly settlement: Promise<SwarmStartupReceipt>;
    private readonly claimIdValue: string;
    private resolveReceipt!: (receipt: SwarmStartupReceipt) => void;
    private readonly constructorBarrier: Promise<void>;
    private resolveConstructor!: () => void;

    private state: TicketState = 'prepared';
    private readonly events: { kind: StartupEventKind; stage: StartupStage; error: string }[] = [];
    private readonly originalErrors: unknown[] = []; // private, never exported
    private readonly nonFatalFailures: string[] = [];
    private readonly degradedSignalsList: string[] = [];
    private hasSyncFailure = false;
    private hasPrimaryError = false;
    private hasFallbackError = false;
    private fallbackUsedFlag = false;
    private branch: 'genesis' | 'existing' | 'unknown' = 'unknown';
    private genesisReportSnapshotValue: GenesisReportSnapshot | null = null;
    private tailRegistrations = 0;
    private knownAgentIdsValue: readonly string[] | null = null;
    private knownAgentIdsObservedAtValue: string | null = null;
    private unobservedDomains: readonly string[] = [];
    private continuationOutcome: Promise<void> | null = null;
    private lateCalls = 0;
    private postTerminalLateCalls = 0; // private diagnostic, never in receipt

    constructor(claimId: string) {
        this.claimIdValue = claimId;
        this.settlement = new Promise<SwarmStartupReceipt>(resolve => { this.resolveReceipt = resolve; });
        this.constructorBarrier = new Promise<void>(resolve => { this.resolveConstructor = resolve; });
        this.handle = Object.freeze({ id: nextTicketId++, claimId, settlement: this.settlement });
        // Settler attached immediately, before any work it will observe.
        void this.settle();
    }

    /** Single claim. A second construction with the same claimId is
     *  rejected with an identifiable error; the existing ticket is untouched. */
    claim(): void {
        if (this.state !== 'prepared') {
            throw new Error(`[startupOwnership] duplicate construction claim for '${this.claimIdValue}' (state: ${this.state})`);
        }
        this.state = 'claimed';
    }

    setBranch(branch: 'genesis' | 'existing'): void { this.guard(() => { this.branch = branch; }); }
    setGenesisReportSnapshot(snapshot: GenesisReportSnapshot): void { this.guard(() => { this.genesisReportSnapshotValue = snapshot; }); }
    setTailRegistrations(count: number): void { this.guard(() => { this.tailRegistrations = count; }); }
    setKnownAgentIdsSnapshot(ids: unknown, observedAt: string): void {
        this.guard(() => {
            this.knownAgentIdsValue = Object.freeze(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
            this.knownAgentIdsObservedAtValue = observedAt;
        });
    }
    setUnobservedDomains(domains: readonly string[]): void { this.guard(() => { this.unobservedDomains = domains; }); }
    markFallbackUsed(): void { this.guard(() => { this.fallbackUsedFlag = true; }); }
    recordSyncFailure(error: unknown): void { this.guard(() => { this.hasSyncFailure = true; this.pushEvent('sync', 'sync-init', error); }); }
    recordContinuationError(stage: StartupStage, error: unknown): void { this.guard(() => { this.hasPrimaryError = true; this.pushEvent('continuation', stage, error); }); }
    recordFallbackError(error: unknown): void { this.guard(() => { this.hasFallbackError = true; this.pushEvent('fallback', 'fallback', error); }); }
    recordNonFatalFailure(domain: string, error: unknown): void { this.guard(() => { this.nonFatalFailures.push(`${domain}: ${describeErrorValue(error)}`); }); }
    recordDegradedSignal(signal: string): void { this.guard(() => { this.degradedSignalsList.push(signal); }); }

    adoptContinuation(continuation: Promise<unknown>): void {
        if (this.state !== 'claimed' || this.continuationOutcome !== null) {
            // Defensive observer FIRST, for every invalid adoption including
            // post-settlement: the stray promise can never go unhandled.
            // Then count/reject; owned work and the historical receipt are
            // never touched by it.
            continuation.then(() => undefined, () => undefined);
            if (this.state === 'settled') {
                this.postTerminalLateCalls++;
                throw new Error(`[startupOwnership] late adoptContinuation after settlement (claimId '${this.claimIdValue}')`);
            }
            this.lateCalls++;
            this.pushEvent('violation', 'continuation', new Error(`[startupOwnership] adoptContinuation outside launch seal (state: ${this.state})`));
            return;
        }
        // Rejection observed immediately, in this method, not by the settler.
        this.continuationOutcome = continuation.then(
            () => undefined,
            (err: unknown) => { this.hasPrimaryError = true; this.pushEvent('continuation', 'continuation', err); }
        );
    }

    markModuleEvalFailure(error: unknown): void {
        if (this.state === 'settled') { this.rejectLate('markModuleEvalFailure'); }
        if (this.state === 'prepared') {
            // Never claimed: import rejected before any construction existed.
            // This is the ONLY case module-eval is terminal.
            this.pushEvent('constructor', 'module-eval', error);
            this.state = 'module-eval-failed';
            this.resolveConstructor();
            return;
        }
        // Claimed or constructor-terminal: a construction is or was alive.
        // Record the observation but keep waiting for the real settlement
        // inputs (constructor barrier already resolved stays resolved).
        this.lateCalls++;
        this.pushEvent('violation', 'module-eval', error);
    }

    markConstructionComplete(): void {
        if (this.state === 'settled') { this.rejectLate('markConstructionComplete'); }
        if (this.state !== 'claimed') { this.lateCalls++; this.pushEvent('violation', 'constructor', new Error('[startupOwnership] unexpected markConstructionComplete')); return; }
        this.state = 'constructor-complete';
        this.resolveConstructor();
    }

    markConstructionFailed(error: unknown): void {
        if (this.state === 'settled') { this.rejectLate('markConstructionFailed'); }
        if (this.state !== 'claimed') { this.lateCalls++; this.pushEvent('violation', 'constructor', error); return; }
        this.pushEvent('constructor', 'constructor', error);
        this.state = 'constructor-failed';
        this.resolveConstructor();
    }

    /** Legit mutations run until settlement; after settlement every control
     *  call is rejected with an identifiable error and counted privately -
     *  the historical receipt is never mutated retroactively. */
    private guard(mutate: () => void): void {
        if (this.state === 'settled') { this.rejectLate('set*'); }
        mutate();
    }

    private rejectLate(call: string): never {
        this.postTerminalLateCalls++;
        throw new Error(`[startupOwnership] late control call '${call}' after settlement (claimId '${this.claimIdValue}')`);
    }

    private pushEvent(kind: StartupEventKind, stage: StartupStage, error: unknown): void {
        this.events.push({ kind, stage, error: describeErrorValue(error) });
        this.originalErrors.push(error);
    }

    private async settle(): Promise<void> {
        // ONE builder over internal plain data. The barrier/continuation
        // awaits cannot reject by construction (both carry own handlers); the
        // catch preserves every cause serialized so far instead of replacing
        // them. Ordinary scope: no layer here claims survival of OOM or
        // mutated language globals.
        try {
            await this.constructorBarrier;
            if (this.continuationOutcome !== null) {
                await this.continuationOutcome;
            }
        } catch (settlerError) {
            this.hasPrimaryError = true;
            this.pushEvent('builder', 'settlement', settlerError);
        }
        this.resolveReceipt(this.buildReceipt(Date.now()));
        this.state = 'settled';
    }

    private buildReceipt(settledAt: number): SwarmStartupReceipt {
        const failures = Object.freeze([...this.events.map(e => `${e.kind}@${e.stage}: ${e.error}`), ...this.nonFatalFailures]);
        const degradedSignals = Object.freeze([...this.degradedSignalsList]);
        const failed = this.hasSyncFailure || this.hasPrimaryError || this.hasFallbackError
            || this.state === 'constructor-failed' || this.state === 'module-eval-failed';
        const outcome: SwarmStartupOutcome = failed ? 'failed' : (failures.length > 0 || degradedSignals.length > 0) ? 'degraded' : 'ok';
        return Object.freeze({
            outcome,
            settled: true as const,
            branch: this.branch,
            fallbackUsed: this.fallbackUsedFlag,
            constructionCompleted: this.state === 'constructor-complete',
            genesisReport: this.genesisReportSnapshotValue,
            orchestrationTailRegistrations: this.tailRegistrations,
            knownAgentIdsSnapshot: this.knownAgentIdsValue,
            knownAgentIdsObservedAt: this.knownAgentIdsObservedAtValue,
            startupFailures: failures,
            degradedSignals,
            unobservedFailureDomains: Object.freeze([...this.unobservedDomains]),
            lateCallsAtSettlement: this.lateCalls,
            settledAt
        });
    }
}

const SINGLETON_CLAIM_ID = 'agent-swarm-orchestrator-singleton';
let singletonTicket: InternalTicket | null = null; // controls stay private to this module

function singletonControls(): InternalTicket {
    if (singletonTicket === null) {
        singletonTicket = new InternalTicket(SINGLETON_CLAIM_ID);
    }
    return singletonTicket;
}

/**
 * THE stable singleton identity, reader view only. Idempotent for observers:
 * never creates a second ticket, never replaces one, and a terminal ticket
 * keeps serving its SAME historical receipt (no recycling, no fake
 * module-retry). Observers receive the frozen handle - never the controls.
 */
export function getSingletonStartupHandle(): StartupHandle {
    return singletonControls().handle;
}

/**
 * The ONLY control operation an importer of the module may need: record that
 * the module's evaluation failed before any construction existed. Terminal
 * only on the never-claimed ticket; on a claimed ticket it is recorded and
 * settlement keeps waiting. Same ticket, same historical receipt afterwards.
 */
export function markSingletonModuleEvalFailure(error: unknown): void {
    singletonControls().markModuleEvalFailure(error);
}

/**
 * Claims the singleton ticket ONCE and runs the construction observed:
 * claimed before `new` (so field initializers are covered), marked
 * constructor-complete on return, marked constructor-failed on ANY throw
 * while the EXACT SAME value is rethrown (fail-fast preserved, incl.
 * null/undefined throws; no invalid instance is ever handed out). A second
 * construction with the singleton claimId is rejected by claim().
 */
export function constructSingletonObserved<T>(construct: (ticket: StartupTicket) => T): T {
    const ticket = singletonControls();
    ticket.claim();
    try {
        const instance = construct(ticket);
        ticket.markConstructionComplete();
        return instance;
    } catch (err) {
        ticket.markConstructionFailed(err);
        throw err;
    }
}

/**
 * Direct-new path: an independent ticket, already claimed, owned by the
 * constructor body itself (which marks complete/failed around the body).
 * Declared limit: field initializers are NOT covered, and this ticket never
 * touches the singleton slot or any other construction's ticket.
 */
export function createDirectOwnedTicket(): StartupTicket {
    const ticket = new InternalTicket(`direct-new-${nextTicketId}`);
    ticket.claim();
    return ticket;
}
