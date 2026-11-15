
import { vectorMemory } from '../services/vectorMemoryService';

async function checkQdrant() {
    console.log("Checking Qdrant Connectivity...");
    try {
        await vectorMemory.connect();
        const stats = await vectorMemory.getStats();
        console.log("Qdrant Stats:", stats);

        if (stats.count >= 0) {
            console.log("✅ Qdrant is ONLINE and accessible.");
        } else {
            console.error("❌ Qdrant seems OFFLINE or unreachable.");
        }
    } catch (e) {
        console.error("❌ Error checking Qdrant:", e);
    }
}

checkQdrant();
