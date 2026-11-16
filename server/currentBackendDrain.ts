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
    try {
        const { gateway } = await import('./gateway');
        gateway.shutdown();
        console.log('[SHUTDOWN] WebSocket Gateway closed');
    } catch { /* ignore if not initialized */ }

    // 3. Disconnect Redis
    try {
        const { redisClient } = await import('../services/redisClient');
        await redisClient.disconnect();
        console.log('[SHUTDOWN] Redis disconnected');
    } catch { /* ignore if not initialized */ }

    // 4. Disconnect Neo4j
    try {
        const { graph } = await import('../services/graphService');
        await graph.close();
        console.log('[SHUTDOWN] Neo4j disconnected');
    } catch { /* ignore if not initialized */ }

    // 5. Close SQLite
    try {
        const { sqliteService } = await import('../services/sqliteService');
        sqliteService.close();
        console.log('[SHUTDOWN] SQLite closed');
    } catch { /* ignore if not initialized */ }

    // 6. Stop Unified Daemon
    try {
        const { unifiedDaemon } = await import('../services/daemon/unifiedDaemon');
        unifiedDaemon.stop();
        console.log('[SHUTDOWN] Unified Daemon stopped');
    } catch { /* ignore if not initialized */ }

    return !shutdownFailed;
}
