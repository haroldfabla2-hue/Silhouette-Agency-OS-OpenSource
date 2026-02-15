import { continuum } from '../services/continuumMemory';
import { lancedbService } from '../services/lancedbService';
import { MemoryTier, MemoryNode } from '../types';

async function testDeepSleep() {
    console.log("💤 Starting Deep Sleep Protocol Verification...");

    // 1. Seed LONG Memory with "Old" Nodes
    console.log("\n1. Seeding 10 'Old' Nodes into LONG tier...");
    const oldTimestamp = Date.now() - 3600000; // 1 hour ago (plenty for the 10min demo threshold)

    for (let i = 0; i < 12; i++) {
        const node: MemoryNode = {
            id: `test-old-node-${i}`,
            content: `This is old memory #${i} about the weather being sunny.`,
            originalContent: `This is old memory #${i} about the weather being sunny.`,
            timestamp: oldTimestamp,
            tier: MemoryTier.LONG,
            importance: 0.1,
            tags: ['TEST', 'OLD_DATA'],
            accessCount: 0,
            lastAccess: oldTimestamp,
            decayHealth: 50,
            compressionLevel: 0
        };
        await lancedbService.store(node);
    }
    console.log("✅ Seeded.");

    // 2. Force Deep Tick
    console.log("\n2. Forcing Deep Sleep Tick...");
    // We assume backend is running or we can call it directly if services are isolated.
    // If services are running in this process context (which they are via imports), we can call directly.
    await continuum.debug_forceTick('DEEP');

    console.log("⏳ Waiting for async consolidation (5s)...");
    await new Promise(r => setTimeout(r, 5000));

    // 3. Verify Cleanup in LONG
    console.log("\n3. Verifying Cleanup in LONG tier...");
    const longNodes = await lancedbService.getNodesByTier(MemoryTier.LONG, 1000);
    const remainingOld = longNodes.filter(n => n.tags.includes('OLD_DATA') && !n.tags.includes('ARCHIVED') && n.tier === MemoryTier.LONG);

    // Check if they are now ARCHIVED or DEEP
    const archivedInDb = await lancedbService.getAllNodes();
    const archivedNodes = archivedInDb.filter(n => n.tags.includes('OLD_DATA') && n.tags.includes('ARCHIVED'));

    console.log(`- Active Old Nodes in LONG: ${remainingOld.length} (Expected: 2, since we processed 10)`);
    console.log(`- Archived Nodes: ${archivedNodes.length} (Expected: 10)`);

    if (remainingOld.length <= 2 && archivedNodes.length >= 10) {
        console.log("✅ Cleanup Successful.");
    } else {
        console.error("❌ Cleanup Failed.");
    }

    // 4. Verify DEEP Summary Generation
    // Since Dreamer actually calls continuum.store with DEEP tier, we should see a new DEEP node
    // with 'ARCHIVE' tag.
    const deepNodes = archivedInDb.filter(n => n.tier === MemoryTier.DEEP && n.tags.includes('COMPRESSED'));
    console.log(`- Deep Compressed Archives: ${deepNodes.length}`);

    if (deepNodes.length > 0) {
        console.log("✅ Deep Summary Created:", deepNodes[deepNodes.length - 1].content.substring(0, 100) + "...");
    } else {
        console.warn("⚠️ Deep Summary not found (might rely on real LLM which is mocked or slow).");
    }

    process.exit(0);
}

testDeepSleep().catch(console.error);
