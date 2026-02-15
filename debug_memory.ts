
import { lancedbService } from './services/lancedbService';
import { vectorMemory } from './services/vectorMemoryService';
import { MemoryTier } from './types';

async function checkMemory() {
    console.log("Checking LanceDB...");
    try {
        const dbNodes = await lancedbService.getAllNodes();
        console.log("LanceDB Total:", dbNodes.length);
        console.log("Medium:", dbNodes.filter(n => n.tier === MemoryTier.MEDIUM).length);
        console.log("Long:", dbNodes.filter(n => n.tier === MemoryTier.LONG).length);
        console.log("Other:", dbNodes.filter(n => n.tier !== MemoryTier.MEDIUM && n.tier !== MemoryTier.LONG).length);
    } catch (e) {
        console.error("LanceDB Fail:", e);
    }

    console.log("Checking Vector Memory...");
    try {
        await vectorMemory.connect();
        const stats = await vectorMemory.getStats();
        console.log("Vector Stats:", stats);
        const nodes = await vectorMemory.getAllNodes(10);
        console.log("Vector Sample:", nodes.length);
    } catch (e) {
        console.error("Vector Fail:", e);
    }
}

checkMemory();
