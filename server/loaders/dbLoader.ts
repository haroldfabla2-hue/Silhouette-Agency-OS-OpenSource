
import fs from 'fs';
import { PATHS } from '../config/paths';
import { sqliteService } from '../../services/sqliteService';

export const initDatabases = async () => {
    console.log('[LOADER] Initializing Databases...');

    // 1. Ensure Directories Exist
    if (!fs.existsSync(PATHS.UPLOADS)) fs.mkdirSync(PATHS.UPLOADS, { recursive: true });
    if (!fs.existsSync(PATHS.DATA)) fs.mkdirSync(PATHS.DATA, { recursive: true });
    if (!fs.existsSync(PATHS.DB)) fs.mkdirSync(PATHS.DB, { recursive: true });

    // 2. Initialize SQLite (constructor handles schema creation)
    console.log('[LOADER] SQLite Service Ready.');

    // 3. Initialize Redis (blocking - must be ready before memory services use it)
    try {
        const { redisClient } = await import('../../services/redisClient');
        await redisClient.connect();
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
        await lancedbService.ensureInitialized();
        console.log('[LOADER] LanceDB Ready.');
    } catch (e: any) {
        console.warn('[LOADER] LanceDB initialization failed:', e.message);
    }

    // 5. Initialize Graph Database (Neo4j) - With timeout and graceful degradation
    const initPromises = [
        // Neo4j with 5s timeout to not block startup
        Promise.race([
            import('../../services/graphService').then(({ graph }) => graph.connect()),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Neo4j timeout (5s)')), 5000))
        ]).catch(e => console.warn("[LOADER] Graph DB optional:", (e as Error).message)),
    ];

    await Promise.allSettled(initPromises);

    // 6. Sync Asset Catalog - DEFERRED to background after server is ready
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
