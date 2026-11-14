import type { Scope, Operation, ChildReservation } from './host';
/** Initial import accounting for an immutable reviewed source graph.
 * Not wired to the product yet. Async/open module graphs must NOT use this
 * synchronous-evaluation disposition proof.
 */
export type SlotPhase = 'ENROLLED' | 'RESERVED' | 'CONSTRUCTING' | 'PUBLISHED' | 'CONSTRUCTION_FAILED' | 'NOT_EVALUATED' | 'NOT_REACHED' | 'EVALUATION_UNKNOWN';
export type Definition = Readonly<{ slots: readonly string[]; edges: Readonly<Record<string, readonly string[]>> }>;
export type ImportRequest = Readonly<{ id: number }>;
type Slot = { phase: SlotPhase; active: Set<ImportRequest>; entered: boolean; complete: boolean; original?: unknown; instance?: object };
type RequestState = { closure: readonly string[]; reconciled: boolean; scope: Scope; operation: Operation; child: ChildReservation; invocationTaken: boolean };
export class InitializationLedger {
    private slots = new Map<string, Slot>();
    private requests = new WeakMap<ImportRequest, RequestState>();
    private nextId = 0;
    private sealed = false;
    constructor(private readonly definition: Definition, private readonly unknown: (source: string) => void) {
        for (const name of definition.slots) {
            if (this.slots.has(name)) throw new Error('Duplicate fixed slot');
            this.slots.set(name, { phase: 'ENROLLED', active: new Set(), entered: false, complete: false });
        }
        for (const closure of Object.values(definition.edges)) for (const name of closure) if (!this.slots.has(name)) throw new Error('Unknown fixed closure slot');
    }
    reserve(edge: string, scope: Scope, operation: Operation): ImportRequest {
        if (this.sealed) throw new Error('No new initialization roots after seal');
        const closure = this.definition.edges[edge];
        if (!closure) throw new Error('Unenrolled edge');
        // Product caller-facing edges must be generated as source-fixed,
        // no-argument sidecars. This ledger itself is not a public claim API.
        for (const name of closure) {
            const state = this.slots.get(name)!;
            if (['NOT_EVALUATED', 'NOT_REACHED', 'CONSTRUCTION_FAILED', 'EVALUATION_UNKNOWN'].includes(state.phase)) throw new Error('Terminal initialization cannot be reset');
        }
        const request = Object.freeze({ id: ++this.nextId });
        const child = scope.reserveChild(operation, 'fixed-import:' + edge);
        this.requests.set(request, { closure, reconciled: false, scope, operation, child, invocationTaken: false });
        for (const name of closure) {
            const state = this.slots.get(name)!; state.active.add(request);
            if (state.phase === 'ENROLLED') state.phase = 'RESERVED';
        }
        return request;
    }
    takeInvocation(request: ImportRequest, scope: Scope): ChildReservation {
        const state = this.requests.get(request);
        if (!state || state.scope !== scope || state.reconciled || state.invocationTaken) throw new Error('Foreign or consumed exact import request');
        state.invocationTaken = true; return state.child;
    }
    abandonBeforeInvocation(request: ImportRequest, scope: Scope, original: unknown): void {
        const state = this.requests.get(request);
        if (!state || state.scope !== scope || state.invocationTaken || state.reconciled) throw new Error('Cannot abandon invoked/foreign request');
        scope.abandonChild(state.child, original);
        this.reconcile(request, { status: 'rejected', reason: original }, false);
    }
    seal(): void { this.sealed = true; }
    entered(name: string): void {
        const slot = this.required(name);
        if (!slot.active.size || slot.entered) throw new Error('Unreserved or duplicate module entry');
        slot.entered = true;
    }
    begin(name: string): void {
        const slot = this.required(name);
        if (slot.phase !== 'RESERVED' || !slot.active.size) throw new Error('Unreserved or duplicate construction');
        slot.phase = 'CONSTRUCTING';
    }
    constructed(name: string, instance: object): void {
        const slot = this.required(name);
        if (slot.phase !== 'CONSTRUCTING') throw new Error('No provisional construction');
        slot.instance = instance; slot.phase = 'PUBLISHED';
    }
    constructionFailed(name: string, original: unknown): void {
        const slot = this.required(name);
        if (slot.phase !== 'CONSTRUCTING') throw new Error('No provisional construction');
        slot.original = original; slot.phase = 'CONSTRUCTION_FAILED';
    }
    evaluationComplete(name: string): void { this.required(name).complete = true; }
    reconcile(request: ImportRequest, result: PromiseSettledResult<unknown>, synchronousGraphVerified: boolean): void {
        const r = this.requests.get(request);
        if (!r || r.reconciled) throw new Error('Unknown or reconciled original import');
        r.reconciled = true;
        for (const name of r.closure) {
            const slot = this.required(name); slot.active.delete(request);
            if (!synchronousGraphVerified) {
                // Keep any acquired owner, but do not infer quiescence/release.
                this.unknown(name + ':UNVERIFIED_EVALUATION_GRAPH');
                if (slot.phase === 'RESERVED') slot.phase = 'EVALUATION_UNKNOWN';
            } else if (slot.phase === 'CONSTRUCTING') {
                this.unknown(name + ':CONSTRUCTING_AFTER_SYNC_IMPORT_SETTLEMENT'); slot.phase = 'EVALUATION_UNKNOWN';
            } else if (slot.phase === 'RESERVED' && !slot.active.size) {
                if (!slot.entered) slot.phase = 'NOT_EVALUATED';
                else if (result.status === 'rejected' && !slot.complete) { slot.phase = 'NOT_REACHED'; slot.original = result.reason; }
                else { slot.phase = 'EVALUATION_UNKNOWN'; this.unknown(name + ':CONTRADICTORY_EVALUATION'); }
            }
        }
    }
    observe(name: string): Readonly<{ phase: SlotPhase; active: number; instance?: object; original?: unknown }> {
        const s = this.required(name); return Object.freeze({ phase: s.phase, active: s.active.size, instance: s.instance, original: s.original });
    }
    private required(name: string): Slot {
        const state = this.slots.get(name); if (!state) throw new Error('Unknown fixed slot'); return state;
    }
}
