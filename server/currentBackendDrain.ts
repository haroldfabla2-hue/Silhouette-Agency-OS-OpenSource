// EXACT existing component drain, not complete producer/admission ownership.
// Desktop must NOT interpret success as all background writers stopped.
export async function drainCurrentBackend(): Promise<boolean> {
    let shutdownFailed = false;
    try {
        const { curiosity } = await import('../services/curiosityService');
        await curiosity.shutdown();
        console.log('[SHUTDOWN] Curiosity accepted work drained');
    } catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Curiosity drainage failed; do not claim clean persistence:', error);
    }

    // 1. Flush pending memory entries
    try {
        const { continuousMemory } = await import('../services/memory/continuousMemory');
        continuousMemory.shutdown();
        console.log('[SHUTDOWN] Continuous Memory flushed');
    } catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Continuous Memory persistence unverified:', error);
    }

    // 2. Shutdown WS Gateway (notify clients)
    // KNOWN UNCLOSED: gateway.shutdown() is fire-and-forget (wss.close()
    // callback unobserved), so a genuine gateway close failure cannot be
    // counted here until that component contract is fixed.
    try {
        const { gateway } = await import('./gateway');
        gateway.shutdown();
        console.log('[SHUTDOWN] WebSocket Gateway closed');
    } catch { /* ignore if not initialized */ }

    // 3. Disconnect Redis. redisClient.disconnect() is a verified no-op
    // when never connected and now PROPAGATES a genuine close failure, so
    // a throw here is real and counts.
    try {
        const { redisClient } = await import('../services/redisClient');
        await redisClient.disconnect();
        console.log('[SHUTDOWN] Redis disconnected');
    } catch (error) {
        shutdownFailed = true;
        console.error('[SHUTDOWN] Redis close failed:', error);
    }

    // 4. Disconnect Neo4j.
    // KNOWN UNCLOSED: graph.close() has no failure/ownership receipt yet
    // (the graph lifecycle contract is a rejected candidate, not in this
    // unit), so this step keeps the original swallow.
    try {
        const { graph } = await import('../services/graphService');
        await graph.close();
        console.log('[SHUTDOWN] Neo4j disconnected');
    } catch { /* ignore if not initialized */ }

    // 5. Close SQLite.
    // KNOWN UNCLOSED: sqliteService.close() swallows all errors internally,
    // so a genuine SQLite close failure cannot be counted here until that
    // component contract is fixed.
    try {
        const { sqliteService } = await import('../services/sqliteService');
        sqliteService.close();
        console.log('[SHUTDOWN] SQLite closed');
    } catch { /* ignore if not initialized */ }

    // 6. Stop Unified Daemon.
    // KNOWN UNCLOSED: in the unbound (native CLI) path stop() fires
    // saveState() without awaiting it, so persistence is not receipted
    // here; the desktop path (stopAdmission/flushStoppedState) is covered
    // by the started-resources registry when bound.
    try {
        const { unifiedDaemon } = await import('../services/daemon/unifiedDaemon');
        unifiedDaemon.stop();
        console.log('[SHUTDOWN] Unified Daemon stopped');
    } catch { /* ignore if not initialized */ }

    return !shutdownFailed;
}
