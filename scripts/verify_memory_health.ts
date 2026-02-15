
import { continuum } from '../services/continuumMemory';
import { lancedbService } from '../services/lancedbService';
import { vectorMemory } from '../services/vectorMemoryService';
import { MemoryTier } from '../types';

async function verifyMemoryHealth() {
    console.log("🏥 STARTING MEMORY HEALTH CHECK...");

    // 1. TEST VOLATILE (RAM) - ULTRA SHORT
    console.log("\n🧪 1. Testing ULTRA_SHORT (RAM)...");
    try {
        await continuum.store("Test Volatile Node", MemoryTier.ULTRA_SHORT, ["test", "volatile"]);
        const nodes = await continuum.getAllNodes();
        const us = nodes[MemoryTier.ULTRA_SHORT];
        if (us.find(n => n.content === "Test Volatile Node")) {
            console.log(`✅ ULTRA_SHORT: Working (${us.length} nodes active)`);
        } else {
            console.error("❌ ULTRA_SHORT: Failed to retrieve injected node.");
        }
    } catch (e: any) {
        console.error("❌ ULTRA_SHORT Error:", e.message);
    }

    // 2. TEST PERSISTENT (LANCEDB) - MEDIUM
    console.log("\n🧪 2. Testing MEDIUM (LanceDB)...");
    try {
        await continuum.store("Test Medium Persistence", MemoryTier.MEDIUM, ["test", "medium"]);
        // Allow async write
        await new Promise(r => setTimeout(r, 1000));

        const dbNodes = await lancedbService.getNodesByTier(MemoryTier.MEDIUM);
        if (dbNodes.find(n => n.content === "Test Medium Persistence")) {
            console.log(`✅ MEDIUM: Working (${dbNodes.length} nodes persisted)`);
        } else {
            console.error("❌ MEDIUM: Failed to retrieve injected node from LanceDB.");
        }
    } catch (e: any) {
        console.error("❌ MEDIUM Error:", e.message);
    }

    // 3. TEST DEEP (QDRANT)
    console.log("\n🧪 3. Testing DEEP (Qdrant)...");
    try {
        // Find a known instruction or just generic search
        const stats = await vectorMemory.getStats();
        if (stats.count >= 0) {
            console.log(`✅ DEEP: Connected to Qdrant. Total Vectors: ${stats.count}`);
        } else {
            console.error("❌ DEEP: Qdrant connection failed (Stats returned -1).");
        }
    } catch (e: any) {
        console.error("❌ DEEP Error:", e.message);
    }

    console.log("\n🏥 HEALTH CHECK COMPLETE.");
    process.exit(0);
}

verifyMemoryHealth();
