import { drainOwnedProducers } from "../services/lifecycle/ownedProducers.js";
// Per-invocation producer receipts of the LATEST drain call (null before
// the first). Supervised tests read them to assert ownership without
// scraping logs; a new drain call overwrites them.
let lastDrainProducerReceipts = null;
export function getLastDrainProducerReceipts() {
    return lastDrainProducerReceipts;
}
export async function drainCurrentBackend() {
    let shutdownFailed = false;
    try {
        const { curiosity } = await import("../services/curiosityService.js");
        await curiosity.shutdown();
        console.log('[SHUTDOWN] Curiosity accepted work drained');
    }
    catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Curiosity drainage failed; do not claim clean persistence:', error);
    }
    // Stop only owners that registered while constructing real producers.
    // No producer imports here: reading this registry cannot start timers or
    // subscriptions. Concurrent calls share producer-stop work; this older
    // component drain itself still has no whole-drain concurrency contract.
    const producerReceipts = await drainOwnedProducers();
    lastDrainProducerReceipts = producerReceipts;
    const n = producerReceipts.narrative;
    const a = producerReceipts.arbiter;
    const p = producerReceipts.power;
    const c = producerReceipts.continuum;
    if (n?.stopFailed || (n && (n.error !== null || n.remainingItems > 0))
        || a?.stopFailed || a?.boundExhausted || p?.stopFailed || c?.stopFailed) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Producer preservation failed; do not claim clean persistence');
        // Never close backing stores under unresolved producer work. The
        // caller receives false and may retry; this is not clean shutdown.
        return false;
    }
    // 1. Flush pending memory entries
    try {
        const { continuousMemory } = await import("../services/memory/continuousMemory.js");
        continuousMemory.shutdown();
        console.log('[SHUTDOWN] Continuous Memory flushed');
    }
    catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Continuous Memory persistence unverified:', error);
    }
    // 2. Shutdown WS Gateway (notify clients)
    // KNOWN UNCLOSED: gateway.shutdown() is fire-and-forget (wss.close()
    // callback unobserved), so a genuine gateway close failure cannot be
    // counted here until that component contract is fixed.
    try {
        const { gateway } = await import("./gateway/index.js");
        gateway.shutdown();
        console.log('[SHUTDOWN] WebSocket Gateway closed');
    }
    catch { /* ignore if not initialized */ }
    // 3. Disconnect Redis. redisClient.disconnect() is a verified no-op
    // when never connected and now PROPAGATES a genuine close failure, so
    // a throw here is real and counts.
    try {
        const { redisClient } = await import("../services/redisClient.js");
        await redisClient.disconnect();
        console.log('[SHUTDOWN] Redis disconnected');
    }
    catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Redis close failed:', error);
    }
    // 4. Disconnect Neo4j.
    // KNOWN UNCLOSED: graph.close() has no failure/ownership receipt yet
    // (the graph lifecycle contract is a rejected candidate, not in this
    // unit), so this step keeps the original swallow.
    try {
        const { graph } = await import("../services/graphService.js");
        await graph.close();
        console.log('[SHUTDOWN] Neo4j disconnected');
    }
    catch { /* ignore if not initialized */ }
    // 5. Close SQLite. sqliteService.close() PROPAGATES genuine close
    // failures (busy query or live statement iterators), so a throw here -
    // import, initialization or close - is real and counts; it is NOT
    // classified as 'never initialized'. The handle stays owned after a
    // failed close, so a later drain can retry once the work settles.
    // KNOWN GAP (preexisting, deferred): importing the singleton during the
    // drain ACQUIRES and migrates a DB that may never have been opened
    // before shutdown; that acquisition is not proof of prior ownership.
    try {
        const { sqliteService } = await import("../services/sqliteService.js");
        sqliteService.close();
        // JS driver close completed; native close status is unobservable,
        // so this is not a persistence/durability receipt.
        console.log('[SHUTDOWN] SQLite closed (driver close completed; not a persistence receipt)');
    }
    catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] SQLite close failed:', error);
    }
    // 6. Stop Unified Daemon.
    // KNOWN UNCLOSED: in the unbound (native CLI) path stop() fires
    // saveState() without awaiting it, so persistence is not receipted
    // here; the desktop path (stopAdmission/flushStoppedState) is covered
    // by the started-resources registry when bound.
    try {
        const { unifiedDaemon } = await import("../services/daemon/unifiedDaemon.js");
        unifiedDaemon.stop();
        console.log('[SHUTDOWN] Unified Daemon stopped');
    }
    catch { /* ignore if not initialized */ }
    return !shutdownFailed;
}
