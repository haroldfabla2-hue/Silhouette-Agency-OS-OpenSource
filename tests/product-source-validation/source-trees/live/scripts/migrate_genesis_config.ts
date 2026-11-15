
import fs from 'fs';
import path from 'path';
import { sqliteService } from '../services/sqliteService';

const GENESIS_DB_PATH = path.join(process.cwd(), 'silhouette_genesis_db.json');

const migrateGenesis = () => {
    console.log("🚀 Starting Genesis Config Migration...");

    if (!fs.existsSync(GENESIS_DB_PATH)) {
        console.log("⚠️ silhouette_genesis_db.json not found. Skipping.");
        return;
    }

    try {
        const raw = fs.readFileSync(GENESIS_DB_PATH, 'utf-8');
        const data = JSON.parse(raw);
        let migratedCount = 0;

        console.log("📄 Found Genesis Data:", Object.keys(data));

        // 1. Migrate genesisConfig (which is 'config' in the JSON)
        if (data.config) {
            console.log("   -> Migrating 'config' as 'genesisConfig'...");
            sqliteService.setConfig('genesisConfig', data.config);
            migratedCount++;

            // 2. Extract systemApiKey
            if (data.config.systemApiKey) {
                console.log("   -> Extracting 'systemApiKey'...");
                sqliteService.setConfig('systemApiKey', data.config.systemApiKey);
                migratedCount++;
            }

            // 3. Extract mediaConfig
            if (data.config.mediaConfig) {
                console.log("   -> Extracting 'mediaConfig'...");
                sqliteService.setConfig('mediaConfig', data.config.mediaConfig);
                migratedCount++;
            }
        }

        // 4. Migrate Projects List
        if (data.projects) {
            console.log(`   -> Migrating ${data.projects.length} Genesis Projects...`);
            sqliteService.setConfig('genesisProjects', data.projects);
            migratedCount++;
        }

        console.log(`✅ Migration Complete. ${migratedCount} keys saved to SQLite.`);

    } catch (e: any) {
        console.error("❌ Migration Failed:", e.message);
    }
};

migrateGenesis();
