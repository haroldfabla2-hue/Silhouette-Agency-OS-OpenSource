
import { lancedbService } from '../services/lancedbService';
import { eureka } from '../services/eurekaService';
import { MemoryNode, MemoryTier } from '../types';

async function verifyEurekaVector() {
    console.log("🔍 Verifying Eureka Vector Search...");

    // 1. Mock Data Setup
    // Use simple 2D vectors for easy similarity calculation (conceptually)
    // Real system uses 768 dims. LanceDB doesn't care about dims matching IF table exists, 
    // BUT if table exists with 768, we must use 768.
    // Assuming table might not exist or we can append.
    // To be safe, let's just generate 768-dim vectors that are "close" and "far".

    const dim = 768;
    const baseVector = Array(dim).fill(0).map((_, i) => i % 2 === 0 ? 0.5 : -0.5);

    // Close Vector (Similar) - slightly modified base
    const closeVector = [...baseVector];
    closeVector[0] += 0.05;

    // Far Vector - inverted
    const farVector = baseVector.map(v => -v);

    const nodeA: MemoryNode = {
        id: 'test_vec_A',
        content: 'Biology: Immune System',
        tags: ['biology', 'health'],
        timestamp: Date.now(),
        tier: MemoryTier.LONG,
        importance: 0.9,
        accessCount: 1,
        lastAccess: Date.now(),
        decayHealth: 1,
        compressionLevel: 0
    };

    const nodeB: MemoryNode = {
        id: 'test_vec_B',
        content: 'Tech: Firewall Security',
        tags: ['tech', 'security'], // Different tags = Cross Domain
        timestamp: Date.now(),
        tier: MemoryTier.LONG,
        importance: 0.8,
        accessCount: 1,
        lastAccess: Date.now(),
        decayHealth: 1,
        compressionLevel: 0
    };

    const nodeC: MemoryNode = {
        id: 'test_vec_C',
        content: 'Biology: White Blood Cell',
        tags: ['biology', 'health'], // Same tags as A
        timestamp: Date.now(),
        tier: MemoryTier.LONG,
        importance: 0.8,
        accessCount: 1,
        lastAccess: Date.now(),
        decayHealth: 1,
        compressionLevel: 0
    };

    console.log("1. Storing Mock Nodes in LanceDB...");
    await lancedbService.store(nodeA, baseVector);
    await lancedbService.store(nodeB, closeVector); // Close but different domain -> Should be GAP
    await lancedbService.store(nodeC, closeVector); // Close but same domain -> Should NOT be gap (filtered)

    console.log("2. Running findSimilarNodes for Node A...");
    const neighbors = await lancedbService.findSimilarNodes(nodeA.id, 5);
    console.log(`- Found ${neighbors.length} neighbors.`);
    neighbors.forEach(n => console.log(`  > ${n.id} (Sim: ${n.similarity?.toFixed(4)})`));

    // Verify Node B is found and is close
    const foundB = neighbors.find(n => n.id === nodeB.id);
    if (!foundB || (foundB.similarity || 0) < 0.9) {
        console.warn("⚠️ Warning: Node B not found or similarity too low.");
    } else {
        console.log("✅ Vector Similarity confirmed.");
    }

    console.log("3. Running Eureka Graph Gap Scan...");
    // This calls getNodesByTier(LONG), which includes our test nodes
    const gaps = await eureka.findGraphGaps(50);

    // We expect A <-> B to be a gap because:
    // - High Vector Similarity
    // - Different Tags (Cross Domain)
    // We expect A <-> C to be IGNORED because:
    // - Same Tags (Not Cross Domain)

    const targetGap = gaps.find(g =>
        (g.nodeA.id === nodeA.id && g.nodeB.id === nodeB.id) ||
        (g.nodeA.id === nodeB.id && g.nodeB.id === nodeA.id)
    );

    if (targetGap) {
        console.log("✅ SUCCESS: Cross-Domain Gap Detected (Biology <-> Tech)");
    } else {
        console.error("❌ FAILED: Cross-Domain Gap NOT detected.");
        console.log("Gaps found:", gaps.map(g => `${g.nodeA.id}-${g.nodeB.id}`));
    }

    // Cleanup
    await lancedbService.deleteNode(nodeA.id);
    await lancedbService.deleteNode(nodeB.id);
    await lancedbService.deleteNode(nodeC.id);
}

verifyEurekaVector().catch(console.error);
