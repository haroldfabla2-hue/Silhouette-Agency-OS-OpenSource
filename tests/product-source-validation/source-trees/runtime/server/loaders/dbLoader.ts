import { bootTimersAreSealed, holdOriginalGraphStartup } from '../lifecycle/bootTimers';
import { scheduleAssetCatalogSync } from '../lifecycle/bootTimers';

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
        if(bootTimersAreSealed())return;
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
        if(bootTimersAreSealed())return;
        await redisClient.connect();
        if(bootTimersAreSealed())return;
        if (redisClient.isMockMode()) {
            console.warn('[LOADER] Redis running in MOCK mode - data will not persist across restarts');
        } else {
            console.log('[LOADER] Redis Ready.');
        }
    } catch (e: any) {
        console.warn('[LOADER] Redis initialization failed:', e.message);
    }

    // 4. Initialize LanceDB (blocking - must be ready before memory/vector services)
    try {
        const { lancedbService } = await import('../../services/lancedbService');
        if(bootTimersAreSealed())return;
        await lancedbService.ensureInitialized();
        if(bootTimersAreSealed())return;
        console.log('[LOADER] LanceDB Ready.');
    } catch (e: any) {
        console.warn('[LOADER] LanceDB initialization failed:', e.message);
    }

    // 5. Initialize Graph Database (Neo4j) - With timeout and graceful degradation
    if(bootTimersAreSealed())return;
    const originalGraphConnect=holdOriginalGraphStartup(async()=>{
        const { graph }=await import('../../services/graphService');
        if(bootTimersAreSealed())return;
        await graph.connect();
    });
    let graphDeadline:ReturnType<typeof setTimeout>|undefined;
    try {
        await Promise.race([
            originalGraphConnect,
            new Promise((_,reject)=>{graphDeadline=setTimeout(()=>reject(new Error('Neo4j timeout (5s)')),5000);}),
        ]).catch(e=>console.warn('[LOADER] Graph DB optional:',(e as Error).message));
    } finally {if(graphDeadline)clearTimeout(graphDeadline);}
    // Original graph task is STILL retained by its source slot if timeout won.
    // Deadline selection never fabricates cancellation or completed connect.
    if(bootTimersAreSealed())return;

    // 6. Initialize Qdrant Vector Memory (non-blocking, optional)
    try {
        const { vectorMemory } = await import('../../services/vectorMemoryService');
        if(bootTimersAreSealed())return;
        const state = await vectorMemory.connect();
        if(bootTimersAreSealed())return;
        if (state.state === 'ready') console.log('[LOADER] VectorMemory (Qdrant) Ready.');
        else console.warn('[LOADER] VectorMemory (Qdrant): ' + state.state);
    } catch (e: any) {
        console.warn('[LOADER] VectorMemory (Qdrant) optional:', e.message);
    }

    // 7. Initialize Continuous Memory WAL (crash recovery + periodic consolidation)
    try {
        const { continuousMemory } = await import('../../services/memory/continuousMemory');
        if(bootTimersAreSealed())return;
        continuousMemory.initialize();
        console.log('[LOADER] ContinuousMemory WAL Ready.');
    } catch (e: any) {
        console.warn('[LOADER] ContinuousMemory initialization failed:', e.message);
    }

    // 8. Sync Asset Catalog - DEFERRED to background after server is ready
    scheduleAssetCatalogSync(async () => {
        try {
            const { assetCatalog } = await import('../../services/assetCatalog');
            if(bootTimersAreSealed())return;
            await assetCatalog.cleanupOrphans();
            if(bootTimersAreSealed())return;
            const { added } = await assetCatalog.syncExistingFiles();
            if(bootTimersAreSealed())return;
            if (added > 0) {
                console.log(`[LOADER] Asset Catalog: ${added} new files (background sync)`);
            }
        } catch (e) {
            console.warn("[LOADER] Asset Catalog background sync failed");
            throw e;
        }
    });
};
