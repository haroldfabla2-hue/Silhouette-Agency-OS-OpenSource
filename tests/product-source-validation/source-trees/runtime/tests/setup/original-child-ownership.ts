import type { ChildProcess } from 'node:child_process';
/** Per-file original child/poll ownership only. No fixture output or argv logging,
 * spawn changes, retries, timeout extension, exit substitution or test verdicts.
 */
export function createOriginalChildOwner() {
    const records = new Map<ChildProcess, { closed: boolean; done: Promise<void> }>();
    const waits = new Set<() => void>();
    function retain(child: ChildProcess): void {
        if (records.has(child)) throw new Error('Original child already retained');
        let finish!: () => void;
        const record = { closed: false, done: new Promise<void>(resolve => { finish = resolve; }) };
        records.set(child, record);
        child.once('close', () => { record.closed = true; finish(); });
    }
    function waitForLine(child: ChildProcess, lines: () => string[], selected: (values: string[]) => boolean): Promise<void> {
        const record = records.get(child);
        if (!record) return Promise.reject(new Error('Original child was not retained'));
        let cancel!: () => void;
        const original = new Promise<void>((resolve, reject) => {
            let timer: ReturnType<typeof setInterval> | undefined;
            let settled = false;
            const settle = (error?: unknown) => {
                if (settled) return;
                settled = true;
                if (timer) clearInterval(timer);
                child.off('close', onClose); child.off('error', onError); waits.delete(cancel);
                if (error !== undefined) reject(error); else resolve();
            };
            const check = () => {
                try { if (selected(lines())) settle(); }
                catch (error) { settle(error); }
            };
            const onClose = () => {
                check();
                if (!settled) settle(new Error('Original child closed before selected readiness line'));
            };
            const onError = (error: Error) => settle(error);
            cancel = () => settle(new Error('Original readiness wait cancelled by test teardown'));
            waits.add(cancel);
            child.once('close', onClose); child.once('error', onError);
            timer = setInterval(check, 25); // original poll cadence
            check();
            if (!settled && record.closed) onClose();
        });
        // Timeout can detach the test's await. Observe but retain exact rejection.
        void original.catch(() => undefined);
        return original;
    }
    async function boundedJoin(tasks: Promise<void>[], milliseconds: number): Promise<boolean> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                Promise.allSettled(tasks).then(() => true),
                new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })
            ]);
        } finally { if (timer) clearTimeout(timer); }
    }
    async function cleanup(): Promise<void> {
        const pendingWaits = waits.size;
        for (const cancel of [...waits]) cancel();
        const unfinished = [...records].filter(([, record]) => !record.closed);
        const errors: unknown[] = [];
        // Cancel every independent survivor before joining any one child.
        for (const [child] of unfinished) {
            try { child.kill('SIGTERM'); } catch (error) { errors.push(error); }
        }
        if (!await boundedJoin(unfinished.map(([, record]) => record.done), 1000)) {
            for (const [child, record] of unfinished) if (!record.closed) {
                try { child.kill('SIGKILL'); } catch (error) { errors.push(error); }
            }
            if (!await boundedJoin(unfinished.map(([, record]) => record.done), 1000)) {
                errors.push(new Error('Original children remain unjoined after bounded cleanup'));
            }
        }
        // Successful forced cleanup cannot turn a broken test into acceptance.
        if (unfinished.length || pendingWaits) errors.push(new Error('Original test left unfinished children or readiness polls'));
        for (const [child, record] of records) if (record.closed) records.delete(child);
        if (errors.length) throw new AggregateError(errors, 'Original child/poll ownership teardown failed');
    }
    return { retain, waitForLine, cleanup };
}
