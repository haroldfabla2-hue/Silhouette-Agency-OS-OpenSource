
import { continuum } from '../services/continuumMemory';
import { lancedbService } from '../services/lancedbService';
import { vectorMemory } from '../services/vectorMemoryService';

async function debugInternals() {
    console.log("=== DEBUGGING CONTINUUM INTERNALS ===");

    // 1. Check LanceDB directly
    console.log("\n1. Checking LanceDB Service...");
    try {
        const dbNodes = await lancedbService.getAllNodes();
        console.log(`[LANCEDB] Nodes found: ${dbNodes.length}`);
        if (dbNodes.length > 0) {
            console.log(`[LANCEDB] Sample Tier: ${dbNodes[0].tier}`);
        }
    } catch (e) {
        console.error("[LANCEDB] Error:", e);
    }

    // 2. Check Vector Memory directly
    console.log("\n2. Checking Vector Memory Service...");
    try {
        await vectorMemory.connect();
        const deepPoints = await vectorMemory.getRecentMemories(50);
        console.log(`[VECTOR] Points found: ${deepPoints.length}`);
    } catch (e) {
        console.error("[VECTOR] Error:", e);
    }

    // 3. Check Continuum Aggregation
    console.log("\n3. Checking Continuum.getAllNodes()...");
    try {
        const all = await continuum.getAllNodes();
        console.log("Continuum Result Keys:", Object.keys(all));
        console.log("Medium Count:", all.MEDIUM?.length);
        console.log("Deep Count:", all.DEEP?.length);
    } catch (e) {
        console.error("[CONTINUUM] Error:", e);
    }
}

debugInternals();
