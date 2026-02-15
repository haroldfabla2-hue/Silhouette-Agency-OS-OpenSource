import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { universalIndexer } from '../services/knowledge/universalIndexer';

async function runIngestion() {
    console.log("🚀 Starting Full Universal Knowledge Ingestion...");
    console.log("This process scans 'universalprompts' and vectorizes all content.");
    console.log("This may take a while depending on the number of files...");

    try {
        await universalIndexer.indexAll();
        console.log("✅ Full Ingestion Complete. Exiting...");
        process.exit(0);
    } catch (e) {
        console.error("❌ Ingestion Failed:", e);
        process.exit(1);
    }
}

runIngestion();
