
import 'dotenv/config'; // Load env vars
import { lancedbService } from './services/lancedbService';
import { vectorMemory } from './services/vectorMemoryService';
import { MemoryTier } from './types';

async function audit() {
    console.log("🔍 STARTING DEEP PERSISTENCE AUDIT...");

    // 1. Audit LanceDB (Medium/Long/Archived)
    console.log("\n--- LANCEDB AUDIT ---");
    try {
        const allDbNodes = await lancedbService.getAllNodes(); // This has a limit of 10000 in service code
        console.log(`Total Records (Hit Limit?): ${allDbNodes.length}`);

        // Search for "Theorem" or "Silhouette" manually in this batch
        const theoremNodes = allDbNodes.filter(n =>
            n.content.toLowerCase().includes('theorem') ||
            n.content.toLowerCase().includes('silhouette')
        );

        if (theoremNodes.length > 0) {
            console.log(`✅ FOUND ${theoremNodes.length} nodes mentioning 'Theorem' or 'Silhouette':`);
            theoremNodes.forEach(n => console.log(`   - [${n.tier}] ${n.id}: ${n.content.substring(0, 80)}...`));
        } else {
            console.log("❌ No trace of 'Theorem' or 'Silhouette' in LanceDB snapshot.");
        }
    } catch (e) {
        console.error("LanceDB Audit Failed:", e);
    }

    // 2. Audit Vector Memory (Deep)
    console.log("\n--- VECTOR MEMORY AUDIT ---");
    try {
        await vectorMemory.connect();
        const stats = await vectorMemory.getStats();
        console.log(`Qdrant Reported Count: ${stats.count} points.`);

        if (stats.count > 0) {
            // Try to fetch ALL (scroll)
            const allVectors = await vectorMemory.getAllNodes(1000); // Try customized limit
            const deepTheorems = allVectors.filter(v =>
                (v.payload?.content || "").toLowerCase().includes('theorem') ||
                (v.payload?.content || "").toLowerCase().includes('silhouette')
            );
            if (deepTheorems.length > 0) {
                console.log(`✅ FOUND ${deepTheorems.length} deep vectors mentioning 'Theorem' or 'Silhouette'.`);
            } else {
                console.log("❌ No trace of 'Theorem' or 'Silhouette' in Deep Memory.");
            }
        }
    } catch (e) {
        console.error("Vector Memory Audit Failed:", e);
    }

    console.log("\n🔍 AUDIT COMPLETE.");
}

audit().catch(console.error);
