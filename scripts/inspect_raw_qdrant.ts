
import { vectorMemory } from '../services/vectorMemoryService';

async function inspectRawQdrant() {
    console.log("Inspecting Raw Qdrant Data...");
    try {
        await vectorMemory.connect();
        // Access the client directly if possible, or use a method that scrolls through points
        // Since vectorMemoryService wraps the client, we might need to use its search or scroll methods if exposed.
        // Looking at vectorMemoryService.ts, it uses `this.client.scroll`.

        // Let's try to use a broad search or just list points if the service exposes it.
        // If not, we'll try to use the `getRecentMemories` with a very loose filter or just debug the service itself.

        // But first, let's try to see what `getRecentMemories` is actually doing.
        // It calls `scroll` with `with_payload: true`.

        const points = await vectorMemory.getRecentMemories(100);
        console.log(`Found ${points.length} points via getRecentMemories.`);

        if (points.length > 0) {
            console.log("Sample Point Payload:", JSON.stringify(points[0].payload, null, 2));
        } else {
            console.log("No points found. Trying to list collections...");
            // We can't easily access the raw client here without modifying the service or using the Qdrant JS client directly.
            // Let's assume the service is working and the data might be in a different collection or format.
        }

    } catch (e) {
        console.error("Error inspecting Qdrant:", e);
    }
}

inspectRawQdrant();
