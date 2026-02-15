
import fs from 'fs';
import { PATHS } from '../config/paths';
import { sqliteService } from '../../services/sqliteService';

export const initDatabases = async () => {
    console.log('[LOADER] 💾 Initializing Databases...');

    // 1. Ensure Directories Exist
    if (!fs.existsSync(PATHS.UPLOADS)) fs.mkdirSync(PATHS.UPLOADS, { recursive: true });
    if (!fs.existsSync(PATHS.DATA)) fs.mkdirSync(PATHS.DATA, { recursive: true });
    if (!fs.existsSync(PATHS.DB)) fs.mkdirSync(PATHS.DB, { recursive: true });

    // 2. Initialize SQLite (Automatically happens on import instantation, but we log it)
    // The sqliteService constructor handles schema creation.
    console.log('[LOADER] ✅ SQLite Service Ready.');

    // 3. Initialize Graph Database (Neo4j) - With timeout and graceful degradation
    const initPromises = [
        // Neo4j con timeout de 5s para no bloquear el inicio
        Promise.race([
            import('../../services/graphService').then(({ graph }) => graph.connect()),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Neo4j timeout (5s)')), 5000))
        ]).catch(e => console.warn("[LOADER] ⚠️ Graph DB optional:", (e as Error).message)),
    ];

    await Promise.allSettled(initPromises);

    // 4. Sync Asset Catalog - DEFERRED to background after server is ready
    setImmediate(async () => {
        try {
            const { assetCatalog } = await import('../../services/assetCatalog');
            await assetCatalog.cleanupOrphans();
            const { added } = await assetCatalog.syncExistingFiles();
            if (added > 0) {
                console.log(`[LOADER] 📦 Asset Catalog: ${added} new files (background sync)`);
            }
        } catch (e) {
            console.warn("[LOADER] ⚠️ Asset Catalog background sync failed");
        }
    });
};

