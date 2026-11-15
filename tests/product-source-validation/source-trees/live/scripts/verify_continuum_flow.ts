import { continuum } from '../services/continuumMemory';
import { lancedbService } from '../services/lancedbService';
import { MemoryTier } from '../types';

async function verifyContinuum() {
    console.log("🔍 Starting Continuum Memory Flow Verification...");

    const testId = `test-verify-${Date.now()}`;
    const testContent = `Verification Node ${testId}`;

    // 1. Ingestion (RAM)
    console.log("\n1. Testing Ingestion (RAM)...");
    await continuum.store(testContent, MemoryTier.ULTRA_SHORT, ['TEST', 'VERIFICATION']);

    // Check RAM
    const shortTerm = continuum.getShortTermMemory();
    const foundInRam = shortTerm.find(n => n.content === testContent);

    if (foundInRam) {
        console.log("✅ 1. Ingestion Successful (Found in RAM)");
    } else {
        console.error("❌ 1. Ingestion Failed (Not found in RAM)");
    }

    // 2. Persistence (LanceDB)
    // Force promote to MEDIUM to test DB
    console.log("\n2. Testing Persistence (LanceDB)...");
    const nodeToPromote = foundInRam || {
        id: testId, content: testContent, tier: MemoryTier.MEDIUM,
        tags: ['TEST'], importance: 1, timestamp: Date.now(),
        accessCount: 1, lastAccess: Date.now(), originalContent: testContent,
        decayHealth: 100, compressionLevel: 0
    };

    // Manually store in LanceDB to verify connection
    await lancedbService.store(nodeToPromote);

    // Verify retrieval
    const dbNodes = await lancedbService.getAllNodes();
    const foundInDb = dbNodes.find(n => n.content === testContent);

    if (foundInDb) {
        console.log("✅ 2. LanceDB Success (Item persisted and retrieved)");
    } else {
        console.error("❌ 2. LanceDB Failed (Item not found in DB)");
    }

    // 3. API Simulation
    console.log("\n3. Testing API Link...");
    const allNodes = await continuum.getAllNodes();
    // API effectively calls this
    const foundInUnified = (allNodes[MemoryTier.ULTRA_SHORT] || []).find((n: any) => n.content === testContent) ||
        (allNodes[MemoryTier.MEDIUM] || []).find((n: any) => n.content === testContent);

    if (foundInUnified) {
        console.log("✅ 3. Unified Accessor Success (Visible to API)");
    } else {
        console.error("❌ 3. Unified Accessor Failed");
    }

    console.log("\n🏁 Verification Complete.");
    process.exit(0);
}

verifyContinuum().catch(console.error);
