/**
 * Observational async-work ledger. NO imports at all.
 *
 * PURELY OBSERVATIONAL: it never suppresses, cancels or closes producer work,
 * and it is NOT a drain integration, a lifecycle contract or a quiescence
 * proof. Producers keep launching exactly what they launched before; this
 * module observes scopes/outcomes so an AUTHORIZED future diagnostic can
 * read partial, frozen evidence.
 *
 * - Root scopes (store roots and observed operations) are created at ENTRY,
 *   before internal awaits, and end when the observed promise settles
 *   (return/throw/early-return all covered by the producer's handlers).
 * - Direct children are registered BEFORE their dynamic import/work starts,
 *   so a slow import is pending time, not a fictitious idle gap.
 * - captureWatermark() returns an IMMUTABLE ordinal token; each
 *   awaitObservedCohort(budget, token) waits on ITS OWN token, immune to
 *   later captures. Roots created after a token keep running and are
 *   observed, but are outside that cohort (counted newRootsAfterWatermark).
 * - awaitObservedCohort returns a FROZEN PARTIAL snapshot: pending entries
 *   carry ordinal + inCohort membership; global counters and the cohort
 *   wait result are clearly separated. It never claims global fixed point,
 *   dream-subgraph closure, transitive coverage or server quiescence.
 *   It cancels nothing.
 * - Sticky counters and identity-carrying incomplete-coverage notes survive
 *   entry eviction; notes are deduplicated per scope and bounded, with
 *   sticky totalIncomplete/droppedNotes counters when bounded.
 */

export type ChildOutcome = 'ok' | 'sync-completed' | 'producer-noop' | 'unverified' | 'failed';
export type RootKind = 'store-root' | 'operation';

export interface WorkScope {
    readonly id: number;
    readonly rootId: number;
    readonly ordinal: number;
    readonly label: string;
    readonly kind: RootKind;
    /** Idempotent: a second call counts a terminal violation, never a second
     *  outcome. Called by the producer when the observed work terminates. */
    end(outcome: 'ok' | 'failed', error?: unknown): void;
    /** Sticky coverage-gap note tied to THIS scope's identity (e.g. an
     *  envelope whose inner store opens its own root outside the cohort). */
    noteCoverageGap(reason: string): void;
}

export interface ChildHandle {
    readonly id: number;
    readonly rootId: number;
    readonly ordinal: number;
    readonly label: string;
    /** Idempotent: a second call counts a terminal violation, never a
     *  second outcome of the same work. */
    settle(outcome: Exclude<ChildOutcome, 'failed'>): void;
    /** Records the REAL outcome BEFORE the producer's historical absorbing
     *  catch; error is serialized opaquely, never inspected. Idempotent. */
    fail(error: unknown): void;
    /** Sticky note WITH this child's identity (childId/rootId/ordinal):
     *  known coverage escapes of this child (e.g. a dream's fire-and-forget
     *  subgraph). A fulfilled promise over known escapes is NOT an absence
     *  of failure. */
    noteIncompleteCoverage(reason: string): void;
}

export interface PendingEntry {
    readonly id: number;
    readonly label: string;
    readonly rootId: number;
    readonly kind: RootKind | 'child' | 'uncovered';
    readonly ordinal: number;
    /** Membership relative to THIS evidence's watermark token. */
    readonly inCohort: boolean;
}

export interface IncompleteNote {
    readonly childId: number | null;
    readonly rootId: number;
    readonly ordinal: number;
    readonly reason: string;
    readonly inCohort: boolean;
}

export interface CohortEvidence {
    /** The immutable ordinal token THIS wait/snapshot used (not the latest
     *  global). */
    readonly watermarkOrdinal: number;
    readonly timedOut: boolean;
    /** GLOBAL counters, sticky, including roots outside the cohort. */
    readonly globalCounters: Readonly<{
        admittedRoots: number;
        admittedOperations: number;
        admittedChildren: number;
        terminatedRoots: number;
        terminatedOperations: number;
        terminatedChildren: number;
        terminatedUncovered: number;
        settledOk: number;
        syncCompleted: number;
        producerNoop: number;
        unverified: number;
        failed: number;
        uncovered: number;
        newRootsAfterWatermark: number;
        terminalViolations: number;
        totalIncomplete: number;
        droppedNotes: number;
    }>;
    readonly firstError: string | null;
    /** Global pending with per-entry cohort membership. */
    readonly pending: readonly PendingEntry[];
    readonly incompleteNotes: readonly IncompleteNote[];
    readonly capturedAt: number;
}

const MAX_STRING = 500;
const MAX_NOTES = 200;

/** Finite, never executes foreign code (same discipline as the O1 leaf). */
function describeErrorValue(value: unknown): string {
    switch (typeof value) {
        case 'string':
            return value.length <= MAX_STRING ? value : `${value.slice(0, MAX_STRING)}…[truncated ${value.length}]`;
        case 'number':
        case 'boolean':
            return String(value);
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

interface Entry {
    id: number;
    label: string;
    rootId: number;
    ordinal: number;
    kind: RootKind | 'child' | 'uncovered';
    terminal: boolean;
    terminalPromise: Promise<void>;
    resolveTerminal: () => void;
}

let nextId = 1;
let nextOrdinal = 1;
/** Latest captured watermark (global). Each awaitObservedCohort call uses the
 *  immutable token passed to it, never this mutable value. */
let latestWatermark: number | null = null;

const entries = new Map<number, Entry>();

// Sticky counters: never reset, never evicted.
const counters = {
    admittedRoots: 0,
    admittedOperations: 0,
    admittedChildren: 0,
    terminatedRoots: 0,
    terminatedOperations: 0,
    terminatedChildren: 0,
    terminatedUncovered: 0,
    settledOk: 0,
    syncCompleted: 0,
    producerNoop: 0,
    unverified: 0,
    failed: 0,
    uncovered: 0,
    newRootsAfterWatermark: 0,
    terminalViolations: 0,
    totalIncomplete: 0,
    droppedNotes: 0,
};
let firstError: string | null = null;

// Identity-carrying notes, deduplicated per scope+reason, bounded; the
// bounds are themselves reported via sticky counters.
const incompleteNotes: IncompleteNote[] = [];
const seenNoteKeys = new Set<string>();

function newEntry(label: string, rootId: number, ordinal: number, kind: Entry['kind']): Entry {
    let resolveTerminal!: () => void;
    const terminalPromise = new Promise<void>(resolve => { resolveTerminal = resolve; });
    const entry: Entry = { id: nextId++, label, rootId, ordinal, kind, terminal: false, terminalPromise, resolveTerminal };
    entries.set(entry.id, entry);
    return entry;
}

/** Guarded terminal mark + resolve. Counter increments are the caller's
 *  job, AFTER its own idempotence guard. */
function closeEntry(entry: Entry): void {
    if (entry.terminal) return;
    entry.terminal = true;
    entry.resolveTerminal();
    // Completed entries are evicted from the active map; counters and notes
    // are sticky and survive.
    entries.delete(entry.id);
}

function recordError(error: unknown): string {
    const text = describeErrorValue(error);
    if (firstError === null) firstError = text;
    return text;
}

function noteIncomplete(childId: number | null, rootId: number, ordinal: number, reason: string): void {
    counters.totalIncomplete++;
    // Dedupe per EXACT scope + reason: the child's own id when present,
    // otherwise the root's. Two children of one root never collapse.
    const key = `${childId ?? rootId}:${reason}`;
    if (seenNoteKeys.has(key) || incompleteNotes.length >= MAX_NOTES) {
        counters.droppedNotes++;
        return;
    }
    seenNoteKeys.add(key);
    incompleteNotes.push({
        childId,
        rootId,
        ordinal,
        reason: reason.length <= MAX_STRING ? reason : `${reason.slice(0, MAX_STRING)}…[truncated]`,
        inCohort: false // computed per snapshot, set at build time
    });
}

function beginRoot(label: string, kind: RootKind): WorkScope {
    const ordinal = nextOrdinal++;
    if (latestWatermark !== null && ordinal > latestWatermark) {
        counters.newRootsAfterWatermark++;
    }
    if (kind === 'store-root') counters.admittedRoots++; else counters.admittedOperations++;
    const entry = newEntry(label, 0, ordinal, kind);
    entry.rootId = entry.id;
    const scope: WorkScope = {
        id: entry.id,
        rootId: entry.id,
        ordinal,
        label,
        kind,
        end(outcome: 'ok' | 'failed', error?: unknown): void {
            if (entry.terminal) { counters.terminalViolations++; return; }
            if (outcome === 'failed') { counters.failed++; recordError(error); }
            if (kind === 'store-root') counters.terminatedRoots++; else counters.terminatedOperations++;
            closeEntry(entry);
        },
        noteCoverageGap(reason: string): void {
            noteIncomplete(null, entry.rootId, entry.ordinal, reason);
        }
    };
    return scope;
}

/** Root scope for a physical continuum.store (non-internal). Always
 *  succeeds: observation never suppresses producer work. */
export function beginStoreRootScope(label: string): WorkScope {
    return beginRoot(label, 'store-root');
}

/** Root scope for an observed OPERATION that is not itself a physical store
 *  (its inner store, when it runs, opens its own store-root; the two are
 *  counted separately and no physical store is double-counted). */
export function beginObservedOperation(label: string): WorkScope {
    return beginRoot(label, 'operation');
}

/** Registers a DIRECT child BEFORE its dynamic import/work starts: a slow
 *  import is observed pending time, not a fictitious idle gap. */
export function beginChild(scope: WorkScope, label: string): ChildHandle {
    counters.admittedChildren++;
    const entry = newEntry(label, scope.rootId, scope.ordinal, 'child');
    const handle: ChildHandle = {
        id: entry.id,
        rootId: scope.rootId,
        ordinal: scope.ordinal,
        label,
        settle(outcome: Exclude<ChildOutcome, 'failed'>): void {
            if (entry.terminal) { counters.terminalViolations++; return; }
            if (outcome === 'ok') counters.settledOk++;
            else if (outcome === 'sync-completed') counters.syncCompleted++;
            else if (outcome === 'producer-noop') counters.producerNoop++;
            else counters.unverified++;
            counters.terminatedChildren++;
            closeEntry(entry);
        },
        fail(error: unknown): void {
            if (entry.terminal) { counters.terminalViolations++; return; }
            counters.failed++;
            recordError(error);
            counters.terminatedChildren++;
            closeEntry(entry);
        },
        noteIncompleteCoverage(reason: string): void {
            noteIncomplete(entry.id, entry.rootId, entry.ordinal, reason);
        }
    };
    return handle;
}

/** Defensive observation of work ALREADY STARTED outside the ledger: owned
 *  by no cohort, counted sticky as uncovered, never dropped-as-success. */
export function markUncovered(label: string, work: Promise<unknown>): void {
    counters.uncovered++;
    const entry = newEntry(label, 0, Number.MAX_SAFE_INTEGER, 'uncovered');
    work.then(
        () => { if (!entry.terminal) { counters.terminatedUncovered++; closeEntry(entry); } },
        (err: unknown) => { if (!entry.terminal) { counters.failed++; recordError(err); counters.terminatedUncovered++; closeEntry(entry); } }
    );
}

/** Captures and returns an IMMUTABLE ordinal token for one cohort query.
 *  Observation-only: suppresses nothing. */
export function captureWatermark(): number {
    latestWatermark = nextOrdinal - 1;
    return latestWatermark;
}

function buildEvidence(token: number, timedOut: boolean): CohortEvidence {
    const pending: PendingEntry[] = [];
    for (const entry of entries.values()) {
        pending.push(Object.freeze({
            id: entry.id,
            label: entry.label,
            rootId: entry.rootId,
            kind: entry.kind,
            ordinal: entry.ordinal,
            inCohort: entry.ordinal <= token
        }));
    }
    const notes: IncompleteNote[] = incompleteNotes.map(n => Object.freeze({ ...n, inCohort: n.ordinal <= token }));
    return Object.freeze({
        watermarkOrdinal: token,
        timedOut,
        globalCounters: Object.freeze({ ...counters }),
        firstError,
        pending: Object.freeze(pending),
        incompleteNotes: Object.freeze(notes),
        capturedAt: Date.now()
    });
}

/** Frozen PARTIAL evidence of the cohort fixed by the immutable `cohortToken`
 *  (roots with ordinal <= token, plus their direct registered children),
 *  awaited until terminal or budget exhaustion. The wait re-reads the pending
 *  set each round, so children of cohort scopes registered while waiting are
 *  included; the token itself never changes mid-wait. Every race timer is
 *  always cleared. Never cancels work, never closes stores, never claims
 *  global fixed point, dream-subgraph closure, transitive coverage or server
 *  quiescence. */
export async function awaitObservedCohort(budgetMs: number, cohortToken: number): Promise<CohortEvidence> {
    const deadline = Date.now() + budgetMs;
    let timedOut = false;
    for (;;) {
        const pending = [...entries.values()].filter(e => e.ordinal <= cohortToken && !e.terminal);
        if (pending.length === 0) break;
        const remaining = deadline - Date.now();
        if (remaining <= 0) { timedOut = true; break; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const winner = await Promise.race([
                Promise.allSettled(pending.map(e => e.terminalPromise)).then(() => 'batch' as const),
                new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), remaining); })
            ]);
            if (winner === 'timeout') { timedOut = true; break; }
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }
    return buildEvidence(cohortToken, timedOut);
}

/** Current frozen partial snapshot without waiting, against an explicit
 *  immutable token (use captureWatermark() to obtain one). Same limits as
 *  awaitObservedCohort: partial, never a quiescence proof. */
export function getEvidenceSnapshot(cohortToken: number): CohortEvidence {
    return buildEvidence(cohortToken, false);
}
