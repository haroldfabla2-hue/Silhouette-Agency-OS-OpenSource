
import { lancedbService } from '../services/lancedbService';
import { MemoryTier } from '../types';

async function inspectMemory() {
    console.log("Inspecting LanceDB Memory Nodes...");
    try {
        const nodes = await lancedbService.getAllNodes();
        console.log(`Total Nodes in LanceDB: ${nodes.length}`);

        const tierCounts: Record<string, number> = {};
        const deepNodes: any[] = [];

        nodes.forEach(node => {
            const tier = node.tier || 'UNDEFINED';
            tierCounts[tier] = (tierCounts[tier] || 0) + 1;
            if (tier === MemoryTier.DEEP) {
                deepNodes.push(node);
            }
        });

        console.log("Tier Distribution:");
        console.table(tierCounts);

        if (deepNodes.length > 0) {
            console.log("\nSample DEEP Node:");
            console.log(JSON.stringify(deepNodes[0], null, 2));
        } else {
            console.log("\nNo DEEP nodes found in LanceDB.");
        }

    } catch (e) {
        console.error("Error inspecting memory:", e);
    }
}

inspectMemory();
