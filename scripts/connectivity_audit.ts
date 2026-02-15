
import { lancedbService } from '../services/lancedbService';
import { vectorMemory } from '../services/vectorMemoryService';
// We use a dynamic import for graph service to mimic the lazy loading used in the app
// import { graph } from '../services/graphService'; 
import fs from 'fs';
import path from 'path';

async function audit() {
    console.log("🔍 STARTING FULL STACK CONNECTIVITY AUDIT 🔍");

    // 1. Environment Check
    console.log("\n--- [1] ENVIRONMENT ---");
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        console.log("✅ .env.local found.");
        const content = fs.readFileSync(envPath, 'utf-8');
        if (content.includes("GEMINI_API_KEY")) console.log("✅ GEMINI_API_KEY present.");
        else console.error("❌ GEMINI_API_KEY MISSING.");
    } else {
        console.error("❌ .env.local NOT FOUND.");
    }

    // 2. LanceDB Check (File Based)
    console.log("\n--- [2] LANCE DB (PERSISTENCE) ---");
    try {
        const nodes = await lancedbService.getAllNodes();
        console.log(`✅ LanceDB Connection OK. Nodes found: ${nodes.length}`);
    } catch (e) {
        console.error("❌ LanceDB Connection FAILED", e);
    }

    // 3. Vector DB Check (Qdrant)
    console.log("\n--- [3] VECTOR MEMORY (QDRANT) ---");
    try {
        await vectorMemory.connect();
        const stats = await vectorMemory.getStats();
        if (stats.count >= 0) {
            console.log(`✅ Qdrant Connection OK. Vectors: ${stats.vectorsCount}`);
        } else {
            console.warn("⚠️ Qdrant Connection Unstable (Stats returned -1)");
        }
    } catch (e) {
        console.error("❌ Qdrant Connection FAILED (Is Docker running?)", e);
    }

    // 4. Graph DB Check (Neo4j)
    console.log("\n--- [4] GRAPH MEMORY (NEO4J) ---");
    try {
        const { graph } = await import('../services/graphService');
        await graph.connect();
        // We manually check private property or run a simple query if exposed, 
        // but checking connection completion is enough for audit.
        console.log(`ℹ️ Graph Connection Attempted. check console for specific success/fail logs.`);
    } catch (e) {
        console.error("❌ Graph Service Import/Init Failed", e);
    }

    console.log("\n--- AUDIT COMPLETE ---");
    process.exit(0);
}

audit();
