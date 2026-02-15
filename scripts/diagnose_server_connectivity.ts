
import { vectorMemory } from '../services/vectorMemoryService';
import { lancedbService } from '../services/lancedbService';

async function diagnose() {
    console.log("=== 🏥 SERVER CONNECTIVITY DIAGNOSIS ===");

    // 1. Test Qdrant Connection
    console.log("\n1. Testing Qdrant Connection...");
    const startQ = Date.now();
    try {
        // Race connection against a 5s timeout
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));

        await Promise.race([
            vectorMemory.connect(),
            timeout
        ]);

        const duration = Date.now() - startQ;
        console.log(`✅ Qdrant Connected in ${duration}ms`);

        const stats = await vectorMemory.getStats();
        console.log(`   Stats: ${JSON.stringify(stats)}`);

    } catch (e) {
        console.error(`❌ Qdrant Connection Failed:`, e);
    }

    // 2. Test LanceDB Connection
    console.log("\n2. Testing LanceDB Connection...");
    const startL = Date.now();
    try {
        const nodes = await lancedbService.getAllNodes();
        const duration = Date.now() - startL;
        console.log(`✅ LanceDB Read ${nodes.length} nodes in ${duration}ms`);
    } catch (e) {
        console.error(`❌ LanceDB Connection Failed:`, e);
    }

    console.log("\n=== DIAGNOSIS COMPLETE ===");
    process.exit(0);
}

diagnose();
