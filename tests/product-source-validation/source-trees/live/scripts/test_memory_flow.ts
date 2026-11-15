import { continuum } from '../services/continuumMemory';
import { MemoryTier } from '../types';

async function testMemoryFlow() {
    console.log("--- STARTING MEMORY FLOW TEST ---");

    const content = `[USER]: Test Message ${Date.now()}`;
    const tags = ['user-input', 'test'];

    console.log(`1. Storing: "${content}"`);
    await continuum.store(content, MemoryTier.WORKING, tags);

    let nodes = await continuum.getAllNodes();
    console.log(`[WORKING]: ${nodes[MemoryTier.WORKING]?.length || 0} (Expected >= 1)`);
    const storedNode = nodes[MemoryTier.WORKING]?.find((n: any) => n.content === content);

    if (!storedNode) {
        console.error("❌ FAILED: Node not found in WORKING immediately after store.");
        return;
    }
    console.log(`✅ Node found in WORKING. Importance: ${storedNode.importance}`);

    console.log("2. Forcing Tick (Fast) -> Promote to MEDIUM");
    continuum.debug_forceTick();

    nodes = await continuum.getAllNodes();
    const inMedium = nodes[MemoryTier.MEDIUM]?.find((n: any) => n.content === content);
    const inWorking = nodes[MemoryTier.WORKING]?.find((n: any) => n.content === content);

    if (inMedium) {
        console.log("✅ Node promoted to MEDIUM.");
    } else if (inWorking) {
        console.log("⚠️ Node still in WORKING. (Importance might be too low?)");
    } else {
        console.error("❌ Node LOST from RAM.");
    }

    console.log("3. Forcing Tick (Medium) -> Promote to LONG (LanceDB)");
    // We need to simulate time passing or force the condition.
    // tickMedium checks for accessCount > 3 or importance >= 0.85.
    // User input importance is 0.9, so it SHOULD promote.

    continuum.debug_forceTick(); // Run again to trigger medium tick if logic allows

    // Wait a bit for async LanceDB store
    await new Promise(resolve => setTimeout(resolve, 1000));

    nodes = await continuum.getAllNodes();
    console.log(`[LONG]: ${nodes[MemoryTier.LONG]?.length || 0} nodes found.`);
    if (nodes[MemoryTier.LONG]?.length > 0) {
        console.log(`[LONG Sample]: ${nodes[MemoryTier.LONG][0].content}`);
    }

    const inLong = nodes[MemoryTier.LONG]?.find((n: any) => n.content === content);
    const inMediumAfter = nodes[MemoryTier.MEDIUM]?.find((n: any) => n.content === content);

    if (inLong) {
        console.log("✅ Node promoted to LONG (LanceDB).");
    } else if (inMediumAfter) {
        console.log("⚠️ Node still in MEDIUM. (LanceDB store might be slow or failed)");
    } else {
        // It might be in transition or lost if store failed
        console.log("❓ Node not in MEDIUM. Checking LONG again...");
    }

    console.log("--- TEST COMPLETE ---");
}

testMemoryFlow();
