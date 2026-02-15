
import { lancedbService } from '../services/lancedbService';
import { vectorMemory } from '../services/vectorMemoryService';

async function inspectIntegrity() {
    console.log("=== 🕵️ DATA INTEGRITY INSPECTION ===");

    // 1. LanceDB Inspection
    console.log("\n--- LANCEDB ---");
    try {
        const nodes = await lancedbService.getAllNodes();
        console.log(`Total Nodes: ${nodes.length}`);
        if (nodes.length > 0) {
            console.log("Sample Node (First 3):");
            nodes.slice(0, 3).forEach((n, i) => {
                console.log(`[${i}] ID: ${n.id} | Tier: '${n.tier}' (Type: ${typeof n.tier}) | Tags: ${n.tags}`);
            });

            // Count by Tier
            const counts: Record<string, number> = {};
            nodes.forEach(n => {
                const t = n.tier || 'undefined';
                counts[t] = (counts[t] || 0) + 1;
            });
            console.log("Tier Distribution:", counts);
        }
    } catch (e) {
        console.error("LanceDB Error:", e);
    }

    // 2. Qdrant Inspection
    console.log("\n--- QDRANT ---");
    try {
        await vectorMemory.connect();
        const stats = await vectorMemory.getStats();
        console.log("Stats:", stats);

        const recent = await vectorMemory.getRecentMemories(5);
        console.log(`Recent Points Found: ${recent.length}`);
        if (recent.length > 0) {
            console.log("Sample Point:", JSON.stringify(recent[0].payload, null, 2));
        }
    } catch (e) {
        console.error("Qdrant Error:", e);
    }
}

inspectIntegrity();
