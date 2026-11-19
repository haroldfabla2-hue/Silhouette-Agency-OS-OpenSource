import { registerStarted } from '../desktop/startedResources.js';

import fs from 'fs';
import { PATHS } from '../config/paths';
import { getDatabaseAdapter } from '../../services/database/adapterFactory';

export const initDatabases = async () => {
    console.log('[LOADER] Initializing Databases...');

    // 1. Ensure Directories Exist
    if (!fs.existsSync(PATHS.UPLOADS)) fs.mkdirSync(PATHS.UPLOADS, { recursive: true });
    if (!fs.existsSync(PATHS.DATA)) fs.mkdirSync(PATHS.DATA, { recursive: true });
    if (!fs.existsSync(PATHS.DB)) fs.mkdirSync(PATHS.DB, { recursive: true });

    // 1.5 Initialize Database Adapter (auto-selects Postgres or SQLite)
    try {
        await getDatabaseAdapter();
        const mode = process.env.DATABASE_URL ? 'PostgreSQL + pgvector' : 'SQLite + LanceDB (embedded)';
        console.log(`[LOADER] Database Adapter Ready — Mode: ${mode}`);
    } catch (e: any) {
        console.error('[LOADER] Database Adapter initialization failed:', e.message);
        console.warn('[LOADER] Falling back to direct SQLite/LanceDB access');
    }

    // 2. Initialize SQLite (constructor handles schema creation)
    console.log('[LOADER] SQLite Service Ready.');

    // 3. Initialize Redis (blocking - must be ready before memory services use it)
    try {
        const { redisClient } = await import('../../services/redisClient');
        await redisClient.connect();
        if (redisClient.isDisabledByPolicy()) {
            // Voluntary policy disable: NOT ready, NOT an outage, and no
            // handle was acquired - so no ownership is registered either.
            console.log('[LOADER] Redis disabled by policy (acceptance); not started.');
        } else {
            // Ownership registered in EVERY non-disabled outcome, including
            // unavailable: a retained failed-close handle keeps its cleanup
            // route at drain.
            registerStarted('redis', {close: () => redisClient.disconnect()});
            if (redisClient.isReallyConnected()) {
                console.log('[LOADER] Redis Ready.');
            } else if (redisClient.isMockMode()) {
                console.warn('[LOADER] Redis running in MOCK mode - data will not persist across restarts');
            } else {
                // e.g. retained failed-close handle: connect() never throws,
                // so the honest line is "not Ready", never a bare "Redis Ready."
                console.warn('[LOADER] Redis unavailable (no real connection, no in-memory fallback); not Ready.');
            }
        }
    } catch (e: any) {
        console.warn('[LOADER] Redis initialization failed:', e.message);
    }

    // 4. Initialize LanceDB (blocking - must be ready before memory/vector services)
    try {
        const { lancedbService } = await import('../../services/lancedbService');
        await lancedbService.ensureInitialized();
        console.log('[LOADER] LanceDB Ready.');
    } catch (e: any) {
        console.warn('[LOADER] LanceDB initialization failed:', e.message);
    }

    // 5. Initialize Graph Database (Neo4j) - With timeout and graceful degradation
    const initPromises = [
        // Neo4j with 5s timeout to not block startup
        Promise.race([
            import('../../services/graphService').then(async ({ graph }) => { await graph.connect(); registerStarted('graph', {close: () => graph.close()}); }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Neo4j timeout (5s)')), 5000))
        ]).catch(e => console.warn("[LOADER] Graph DB optional:", (e as Error).message)),
    ];

    await Promise.allSettled(initPromises);

    // 6. Initialize Qdrant Vector Memory (non-blocking, optional)
    try {
        const { vectorMemory } = await import('../../services/vectorMemoryService');
        const state = await vectorMemory.connect();
        if (state.state === 'ready') console.log('[LOADER] VectorMemory (Qdrant) Ready.');
        else console.warn('[LOADER] VectorMemory (Qdrant): ' + state.state);
    } catch (e: any) {
        console.warn('[LOADER] VectorMemory (Qdrant) optional:', e.message);
    }

    // 7. Initialize Continuous Memory WAL (crash recovery + periodic consolidation)
    try {
        const { continuousMemory } = await import('../../services/memory/continuousMemory');
        continuousMemory.initialize();
        registerStarted('continuous-memory', {flush: () => continuousMemory.shutdown()});
        console.log('[LOADER] ContinuousMemory WAL Ready.');
    } catch (e: any) {
        console.warn('[LOADER] ContinuousMemory initialization failed:', e.message);
    }

    // 8. Sync Asset Catalog - DEFERRED to background after server is ready
    setImmediate(async () => {
        try {
            const { assetCatalog } = await import('../../services/assetCatalog');
            await assetCatalog.cleanupOrphans();
            const { added } = await assetCatalog.syncExistingFiles();
            if (added > 0) {
                console.log(`[LOADER] Asset Catalog: ${added} new files (background sync)`);
            }
        } catch (e) {
            console.warn("[LOADER] Asset Catalog background sync failed");
        }
    });
};
