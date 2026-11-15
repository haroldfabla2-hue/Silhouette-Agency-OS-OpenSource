
import { lancedbService } from '../services/lancedbService';
import { vectorMemory } from '../services/vectorMemoryService';
import { MemoryTier } from '../types';
import { geminiService } from '../services/geminiService';

async function migrateDeepMemory() {
    console.log("=== 🧠 MIGRATING LEGACY DEEP MEMORY TO QDRANT ===");

    // 1. Fetch all nodes from LanceDB
    console.log("1. Fetching nodes from LanceDB...");
    const allNodes = await lancedbService.getAllNodes();
    console.log(`   Found ${allNodes.length} total nodes.`);

    // 2. Filter for DEEP or MEDIUM nodes (User considers MEDIUM as important/deep for this migration)
    const deepNodes = allNodes.filter(n => n.tier === MemoryTier.DEEP || n.tier === MemoryTier.MEDIUM);
    console.log(`   Found ${deepNodes.length} nodes (DEEP + MEDIUM) to migrate.`);

    if (deepNodes.length === 0) {
        console.log("   No nodes to migrate. Exiting.");
        return;
    }

    // 3. Connect to Qdrant
    console.log("2. Connecting to Qdrant...");
    await vectorMemory.connect();

    // 4. Migrate each node
    console.log("3. Starting migration...");
    let successCount = 0;
    let failCount = 0;

    for (const node of deepNodes) {
        try {
            console.log(`   Migrating node ${node.id.substring(0, 8)}...`);

            // Generate embedding if missing (critical for Vector DB)
            let vector = Array(768).fill(0);
            try {
                const embedding = await geminiService.generateEmbedding(node.content);
                if (embedding) vector = embedding;
            } catch (e) {
                console.warn(`   ⚠️ Failed to generate embedding for ${node.id}, using zero vector.`);
            }

            // Store in Qdrant
            await vectorMemory.storeMemory(node.id, vector, {
                ...node,
                tier: MemoryTier.DEEP, // FORCE PROMOTION: All migrated nodes become DEEP
                migrated: true,
                migrationDate: Date.now()
            });
            successCount++;
        } catch (e) {
            console.error(`   ❌ Failed to migrate node ${node.id}`, e);
            failCount++;
        }
    }

    console.log("\n=== MIGRATION COMPLETE ===");
    console.log(`✅ Successfully migrated: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log("You can now safely remove the legacy merge logic from continuumMemory.ts");
}

migrateDeepMemory();
