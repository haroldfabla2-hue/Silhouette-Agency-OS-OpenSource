// Preserve synchronous invocation order and legacy stop-on-synchronous-throw.
// Already-started returned work is ALWAYS awaited before reporting failure.
export async function orderedFanout(tasks) {
    const started = [];
    let syncFailed = false;
    for (const task of tasks) {
        try { started.push(Promise.resolve(task())); }
        catch { syncFailed = true; break; }
    }
    const results = await Promise.allSettled(started);
    if (syncFailed || results.some(result => result.status === 'rejected')) throw new Error('PERSISTENCE_FANOUT_FAILED');
}
