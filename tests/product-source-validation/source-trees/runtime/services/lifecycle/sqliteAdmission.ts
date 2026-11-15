import { AsyncLocalStorage } from 'node:async_hooks';
import { AdmissionClosed, OwnershipConflict, type Scope } from './host';
import { sqliteOwner } from './preparationBindings';

type Original = {
    owner: SqliteAdmission; live: boolean; bodySettled: boolean; complete: boolean;
    children: Set<Original>; parent?: Original; maybeFinish: () => void;
    done: Promise<void>; finish: () => void; observedFailures: WeakSet<object>;
};
/** Local SQLite admission and original joins only. Never release authority.
 * ALS preserves existing signatures and actual dynamic-import continuations.
 * No Database, Statement, Host controller or reusable token is put in context.
 */
export class SqliteAdmission {
    #phase: 'OPEN' | 'SEALED' = 'OPEN';
    #context = new AsyncLocalStorage<Original>();
    #pending = new Set<Promise<void>>();
    #join?: Promise<void>;
    #producerStops: (() => void)[] = [];
    constructor(private readonly scope: Scope) {
        scope.onSeal(() => this.sealAndJoin());
    }

    run<T>(source: string, body: () => T): T {
        let parent = this.#context.getStore();
        if (parent && (parent.owner !== this || !parent.live)) {
            if (this.#phase !== 'OPEN') throw new AdmissionClosed('Settled SQLite original operation');
            parent = undefined; // A later independent original entry while OPEN.
        }
        if (this.#phase !== 'OPEN' && !parent) throw new AdmissionClosed('SQLite admission sealed');
        if (parent) return this.enter(source, body, parent).value();
        let original!: { value: () => T };
        // Host retains a real original-completion join, including detached
        // children admitted while the body was live. A joined failed task is
        // not a successful task: taskFailed below retains its original cause.
        this.scope.invoke(source + ':join-originals', () => {
            const admitted = this.enter(source, body);
            original = admitted;
            return admitted.complete() ? undefined : admitted.done;
        });
        return original.value();
    }

    private enter<T>(source: string, body: () => T, parent?: Original): { value: () => T; done: Promise<void>; complete: () => boolean } {
        let finish!: () => void;
        const done = new Promise<void>(resolve => { finish = resolve; });
        const state: Original = {
            owner: this, live: true, bodySettled: false, complete: false,
            children: new Set(), parent, done, finish, maybeFinish: () => undefined,
            observedFailures: parent?.observedFailures ?? new WeakSet<object>(),
        };
        this.#pending.add(done);
        if (parent) parent.children.add(state);
        state.maybeFinish = () => {
            if (state.complete || !state.bodySettled || state.children.size) return;
            state.complete = true;
            this.#pending.delete(done);
            if (parent) parent.children.delete(state);
            state.finish();
            if (parent) parent.maybeFinish();
        };
        const settled = () => {
            state.live = false; state.bodySettled = true;
            // Completion is synchronous ONLY when this actual body settled
            // synchronously and no original child remains. Already-admitted
            // children have their own live state and retain their descendants.
            state.maybeFinish();
        };
        const failed = (original: unknown) => {
            // Avoid multiplying the same propagated object at every nested
            // wrapper. This is retained-cause deduplication, not attempt count.
            if (original !== null && (typeof original === 'object' || typeof original === 'function')) {
                if (!state.observedFailures.has(original)) {
                    state.observedFailures.add(original); this.scope.taskFailed(source, original);
                }
            } else this.scope.taskFailed(source, original);
            settled();
        };
        let result!: T, threw = false, error: unknown;
        try { result = this.#context.run(state, body); }
        catch (original) { threw = true; error = original; failed(original); }
        if (!threw) {
            // Preserve original return/Promise identity. No arbitrary thenable
            // assimilation or foreign then getter. Reviewed native Promises.
            if (result instanceof Promise) void result.then(settled, failed);
            else settled();
        }
        return { value: () => { if (threw) throw error; return result; }, done, complete: () => state.complete };
    }

    /** Fixed synchronous timer cancellation only, never a final flush/new task.
     * Stop callbacks cannot import services or grant global release authority.
     */
    onSealStopProducer(stop: () => void): void {
        if (this.#phase !== 'OPEN') throw new AdmissionClosed('SQLite producer registration sealed');
        this.#producerStops.push(stop);
    }
    /** Callback boundary with no floating rejection. run retains the SAME
     * original Promise; the final handler observes only that retained outcome.
     * Rejections before body admission are retained as failed entry attempts.
     */
    background(source: string, body: () => Promise<unknown>): void {
        let entered = false;
        try {
            const original = this.run(source, () => { entered = true; return body(); });
            void original.then(() => undefined, () => undefined);
        } catch (error) {
            if (!entered) this.scope.taskFailed(source + ':entry-rejected', error);
            // An entered body failure was already retained by enter().
        }
    }

    sealAndJoin(): Promise<void> {
        if (this.#context.getStore()?.live) throw new OwnershipConflict('SQLite original cannot join itself');
        if (this.#join) return this.#join;
        this.#phase = 'SEALED';
        this.#join = (async () => {
            const stopFailures: unknown[] = [];
            for (const stop of this.#producerStops.splice(0)) {
                try { stop(); } catch (error) {
                    stopFailures.push(error); this.scope.taskFailed('sqlite-producer-stop', error);
                }
            }
            // These completion receipts cannot reject. Original failures stay
            // in Host.taskFailed and in the unchanged caller result/rejection.
            while (this.#pending.size) await Promise.all([...this.#pending]);
            if (stopFailures.length) throw new AggregateError(stopFailures, 'SQLite producer cancellation failed');
        })();
        return this.#join;
    }
    snapshot(): Readonly<{ admission: 'OPEN' | 'SEALED'; pendingOriginals: number }> {
        return Object.freeze({ admission: this.#phase, pendingOriginals: this.#pending.size });
    }
}

// Lazy fixed-source admission, no SQLite import or database construction.
let runtimeAdmission: SqliteAdmission | undefined;
export function runtimeSqliteAdmission(): SqliteAdmission {
    return runtimeAdmission ??= new SqliteAdmission(sqliteOwner());
}
export function runSqliteOperation<T>(source: string, body: () => T): T {
    return runtimeSqliteAdmission().run(source, body);
}
